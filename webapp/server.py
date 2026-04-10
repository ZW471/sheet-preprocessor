"""
SheetPreprocessor Review Webapp — FastAPI server.

Launch:
    cd webapp
    python server.py --analysis-dir ../runs/4/analysis/

Then open http://localhost:8787
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from ruamel.yaml import YAML
import uvicorn

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
parser = argparse.ArgumentParser(description="SheetPreprocessor review webapp")
parser.add_argument("--analysis-dir", type=str, default=None,
                    help="Path to the analysis/ output folder (auto-detected if not set)")
parser.add_argument("--port", type=int, default=8787)
parser.add_argument("--host", type=str, default="127.0.0.1")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="SheetPreprocessor Review")
yaml = YAML()
yaml.preserve_quotes = True

ANALYSIS_DIR: Path = Path(".")  # set in main()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def read_json(path: Path) -> Any:
    if not path.exists():
        raise HTTPException(404, f"File not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _to_plain(obj: Any) -> Any:
    """Recursively convert ruamel CommentedMap/Seq to plain dict/list."""
    if isinstance(obj, dict):
        return {k: _to_plain(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_plain(v) for v in obj]
    return obj


def read_yaml_as_dict(path: Path) -> dict:
    if not path.exists():
        raise HTTPException(404, f"File not found: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.load(f)
        return _to_plain(data) if data else {}
    except Exception as e:
        # Malformed YAML — fall back to safe loader (more lenient)
        try:
            safe_yaml = YAML(typ='safe')
            with open(path, encoding="utf-8") as f:
                data = safe_yaml.load(f)
            return _to_plain(data) if data else {}
        except Exception:
            # Return minimal dict with parse error info
            return {"_parse_error": str(e), "_file": str(path)}


def write_yaml(path: Path, data: dict) -> None:
    """Write YAML, falling back to safe dumper if ruamel chokes on AI-generated content."""
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            yaml.dump(data, f)
    except Exception:
        # ruamel can crash on dicts originating from malformed YAML (AI-generated).
        # Fall back to safe YAML — we lose comments but at least the data persists.
        safe_yaml = YAML(typ='safe')
        safe_yaml.default_flow_style = False
        with open(tmp, "w", encoding="utf-8") as f:
            safe_yaml.dump(data, f)
    tmp.replace(path)

# ---------------------------------------------------------------------------
# Stats normalization — convert variant stats.json formats to the canonical
# type-grouped structure the frontend expects:
#   { "continuous": { col: {...} }, "ordered_categorical": { col: {...} }, ... }
# ---------------------------------------------------------------------------

# The canonical type group keys the frontend iterates over:
_TYPE_GROUPS = ("continuous", "ordered_categorical", "unordered_categorical",
                "multi_label", "datetime", "id", "text")


def normalize_stats(raw: dict, sheet_name: str) -> dict:
    """Normalize any of the known stats.json variants into the frontend-expected
    type-grouped format.  The function is purely additive — it copies the
    canonical groups into the top-level dict alongside whatever else is there,
    so metadata fields (sheet, kind, rows, ...) are preserved.

    Known input variants handled:
      1. Already type-grouped (e.g. 建档, 体成分, 运动):
         top-level keys include 'continuous', 'ordered_categorical', etc.
      2. 'columns' dict with per-column 'type' field (腰围, 饮食, 血压, 限能量, 患者清单)
      3. 'classifications' dict with per-column 'type' field (高蛋白)
      4. 'continuous_stats' dict (体重) + separate 'outlier_entity_ids'
      5. 'per_col_stats' flat dict with 'col__stat' keys (血糖) + 'tukey_outliers'
      6. 'per_column' dict with basic null/nunique (轻断食) — no type field
      7. Nested under sheet_name key (rare but supported by Protocol H)
    """
    # If nested under sheet name, unwrap first
    if sheet_name in raw and isinstance(raw[sheet_name], dict):
        # Check it's the stats payload (has columns or type groups), not just a metadata field
        inner = raw[sheet_name]
        if any(k in inner for k in (*_TYPE_GROUPS, "columns", "classifications",
                                      "continuous_stats", "per_col_stats", "per_column")):
            raw = {**raw, **inner}
            del raw[sheet_name]

    # Already normalized?  If at least one type group key exists with dict values, return.
    has_groups = any(isinstance(raw.get(tg), dict) and raw[tg] for tg in _TYPE_GROUPS)

    if has_groups:
        # Variant 1 — ensure all type group keys exist (may be missing some).
        for tg in _TYPE_GROUPS:
            raw.setdefault(tg, {})
        return _ensure_row_count(raw)

    # Try to build type groups from a dict-of-columns with per-column 'type' field.
    cols_dict = (raw.get("columns")
                 or raw.get("classifications")
                 or None)

    if isinstance(cols_dict, dict) and cols_dict:
        return _ensure_row_count(_group_by_type(raw, cols_dict))

    # Variant 4: continuous_stats (体重 format)
    if isinstance(raw.get("continuous_stats"), dict):
        return _ensure_row_count(_normalize_continuous_stats(raw))

    # Variant 5: per_col_stats with flat 'col__stat' keys (血糖 format)
    if isinstance(raw.get("per_col_stats"), dict):
        return _ensure_row_count(_normalize_per_col_stats(raw))

    # Variant 6: per_column with basic counts only (轻断食 format)
    if isinstance(raw.get("per_column"), dict):
        return _ensure_row_count(_normalize_per_column(raw))

    # Fallback: return as-is with empty groups so frontend doesn't crash
    for tg in _TYPE_GROUPS:
        raw.setdefault(tg, {})
    return _ensure_row_count(raw)


def _ensure_row_count(raw: dict) -> dict:
    """Make sure top-level 'rows' is set for the frontend header."""
    if raw.get("rows"):
        return raw
    if raw.get("n_rows"):
        raw["rows"] = raw["n_rows"]
    elif isinstance(raw.get("shape"), (list, tuple)) and len(raw["shape"]) >= 1:
        raw["rows"] = raw["shape"][0]
    else:
        # Try to infer from any continuous column's 'n' value
        for tg in _TYPE_GROUPS:
            for _, col_data in (raw.get(tg) or {}).items():
                if isinstance(col_data, dict) and col_data.get("n"):
                    raw["rows"] = col_data["n"]
                    return raw
    return raw


def _group_by_type(raw: dict, cols_dict: dict) -> dict:
    """Group a columns/classifications dict into type-group buckets."""
    groups: dict[str, dict] = {tg: {} for tg in _TYPE_GROUPS}
    for col_name, col_data in cols_dict.items():
        if not isinstance(col_data, dict):
            continue
        col_type = col_data.get("type", "text")  # default to text if missing
        # Map to canonical group name
        if col_type in groups:
            groups[col_type][col_name] = col_data
        else:
            groups.setdefault(col_type, {})[col_name] = col_data
    raw.update(groups)
    return raw


def _normalize_continuous_stats(raw: dict) -> dict:
    """Handle 体重-style format: continuous_stats dict + outlier_entity_ids map."""
    groups: dict[str, dict] = {tg: {} for tg in _TYPE_GROUPS}
    cont = raw.get("continuous_stats", {})
    outlier_ids_map = raw.get("outlier_entity_ids", {})

    for col_name, col_data in cont.items():
        if not isinstance(col_data, dict):
            continue
        # Merge outlier_entity_ids from the sibling dict
        if col_name in outlier_ids_map:
            col_data["outlier_entity_ids"] = outlier_ids_map[col_name]
        # Remap field names to canonical: q25->Q1, q75->Q3, miss->missing_count
        _remap_stat_fields(col_data)
        groups["continuous"][col_name] = col_data

    raw.update(groups)
    return raw


def _normalize_per_col_stats(raw: dict) -> dict:
    """Handle 血糖-style format: flat per_col_stats with 'col__stat' keys."""
    groups: dict[str, dict] = {tg: {} for tg in _TYPE_GROUPS}
    flat = raw.get("per_col_stats", {})
    tukey = raw.get("tukey_outliers", {})

    # Collect column names from the flat keys
    col_names: set[str] = set()
    for key in flat:
        if "__" in key:
            col_names.add(key.rsplit("__", 1)[0])

    for col_name in col_names:
        prefix = f"{col_name}__"
        col_data: dict[str, Any] = {}
        for key, val in flat.items():
            if key.startswith(prefix):
                stat_name = key[len(prefix):]
                col_data[stat_name] = val
        # Merge tukey outlier data
        if col_name in tukey and isinstance(tukey[col_name], dict):
            for k, v in tukey[col_name].items():
                col_data.setdefault(k, v)
        _remap_stat_fields(col_data)
        # Infer type: if it has mean/std/min/max it's continuous
        if any(k in col_data for k in ("mean", "std", "min", "max")):
            groups["continuous"][col_name] = col_data
        else:
            groups["text"][col_name] = col_data

    raw.update(groups)
    return raw


def _normalize_per_column(raw: dict) -> dict:
    """Handle 轻断食-style format: per_column with null/nunique only (no type field)."""
    groups: dict[str, dict] = {tg: {} for tg in _TYPE_GROUPS}
    per_col = raw.get("per_column", {})

    for col_name, col_data in per_col.items():
        if not isinstance(col_data, dict):
            continue
        # Best-effort type inference from basic stats
        n = col_data.get("n") or col_data.get("null", 0) + col_data.get("nunique", 0)
        col_data.setdefault("n", n)
        col_data.setdefault("missing_count", col_data.get("null", 0))
        if n and col_data.get("null") is not None:
            col_data.setdefault("missing_rate", col_data["null"] / n if n > 0 else 0)
        # Put into 'text' as a fallback — at least they'll show up in the table
        groups["text"][col_name] = col_data

    raw.update(groups)
    return raw


def _remap_stat_fields(d: dict) -> None:
    """Remap common field-name variants to the canonical names the frontend reads."""
    _MAP = {
        "q25": "Q1", "q1": "Q1",
        "q75": "Q3", "q3": "Q3",
        "miss": "missing_count",
        "missing": "missing_count",
        "nunique": "n_unique",
    }
    for old_key, new_key in _MAP.items():
        if old_key in d and new_key not in d:
            d[new_key] = d[old_key]
    # Derive IQR if missing
    if "IQR" not in d and "iqr" not in d and d.get("Q1") is not None and d.get("Q3") is not None:
        try:
            d["IQR"] = d["Q3"] - d["Q1"]
        except (TypeError, ValueError):
            pass
    # Copy iqr -> IQR for frontend
    if "iqr" in d and "IQR" not in d:
        d["IQR"] = d["iqr"]
    # Derive missing_rate if possible
    if "missing_rate" not in d and d.get("missing_count") is not None and d.get("n"):
        try:
            d["missing_rate"] = d["missing_count"] / d["n"] if d["n"] > 0 else 0
        except (TypeError, ValueError):
            pass


# ---------------------------------------------------------------------------
# GET routes — read-only analysis data
# ---------------------------------------------------------------------------
@app.get("/api/manifest")
def get_manifest():
    return read_json(ANALYSIS_DIR / "manifest.json")


@app.get("/api/relationships")
def get_relationships():
    return read_json(ANALYSIS_DIR / "relationships.json")


@app.get("/api/config-draft")
def get_config_draft():
    return read_yaml_as_dict(ANALYSIS_DIR / "config.draft.yaml")


@app.get("/api/sheet/{sheet_name}/stats")
def get_sheet_stats(sheet_name: str):
    raw = read_json(ANALYSIS_DIR / sheet_name / "stats.json")
    return normalize_stats(raw, sheet_name)


@app.get("/api/sheet/{sheet_name}/config")
def get_sheet_config(sheet_name: str):
    config = read_yaml_as_dict(ANALYSIS_DIR / sheet_name / "config.yaml")
    # Merge legacy escalations into issues so the frontend only sees issues
    _merge_escalations_into_issues(config, sheet_name)
    return config


def _merge_escalations_into_issues(config: dict, sheet_name: str) -> None:
    """Convert legacy 'escalations' entries into 'issues' format in-place."""
    root = _resolve_config_root(config, sheet_name)
    if not isinstance(root, dict):
        return
    escalations = root.get("escalations", [])
    if not escalations:
        return
    issues = root.setdefault("issues", [])
    existing_ids = {i.get("id") for i in issues if isinstance(i, dict)}
    for i, esc in enumerate(escalations):
        if not isinstance(esc, dict):
            continue
        esc_id = f"esc_{esc.get('issue', esc.get('protocol', 'unknown'))}_{i}"
        if esc_id in existing_ids:
            continue  # already merged
        issue_entry = {
            "id": esc_id,
            "type": "info",
            "title": (esc.get("issue", "escalation")).replace("_", " ").title(),
            "description": esc.get("proposal") or esc.get("description") or "",
            "action": esc.get("proposal") or "",
            "cols": [esc["column"]] if esc.get("column") else esc.get("columns", []),
            "confidence": "high",
            "resolved": bool(esc.get("user_action") or esc.get("user_confirmed")),
        }
        if esc.get("user_action"):
            issue_entry["user_action"] = "accepted" if esc["user_action"] in ("confirmed", "modified") else "commented"
            issue_entry["user_response"] = esc.get("user_note") or esc.get("user_override") or esc["user_action"]
        if esc.get("user_note") or esc.get("user_override"):
            issue_entry["user_comment"] = esc.get("user_note") or esc.get("user_override")
        if esc.get("decided_at"):
            issue_entry["decided_at"] = esc["decided_at"]
        issues.append(issue_entry)

# ---------------------------------------------------------------------------
# POST routes — write-back for user decisions
# ---------------------------------------------------------------------------
from typing import Optional

class OutlierDecision(BaseModel):
    column: str
    action: str  # keep | clip_to_domain | clip_to_custom | flag_only | remove | custom
    custom_note: Optional[str] = None
    clip_bounds: Optional[dict] = None  # {"min": float, "max": float}


@app.post("/api/sheet/{sheet_name}/outlier-decision")
def post_outlier_decision(sheet_name: str, decision: OutlierDecision):
    config_path = ANALYSIS_DIR / sheet_name / "config.yaml"
    if not config_path.exists():
        raise HTTPException(404, f"Config not found for sheet: {sheet_name}")

    try:
        config = read_yaml_as_dict(config_path)
    except Exception as e:
        raise HTTPException(422, f"Cannot read config for {sheet_name}: {e}")

    if config.get("_parse_error"):
        raise HTTPException(422, f"Config YAML for {sheet_name} is malformed: {config['_parse_error']}")

    # Navigate into the sheet's config (may be nested under sheet name or flat)
    root = _resolve_config_root(config, sheet_name)
    columns = root.get("columns", {})
    if not isinstance(columns, dict):
        columns = {}
        root["columns"] = columns
    # Create column entry if missing — never fail a save
    if decision.column not in columns:
        columns[decision.column] = {"type": "continuous"}
    col_config = columns[decision.column]
    if not isinstance(col_config, dict):
        col_config = {"type": "continuous"}
        columns[decision.column] = col_config

    col_config["outlier_decisions"] = {
        "action": decision.action,
        "custom_note": decision.custom_note,
        "clip_bounds": decision.clip_bounds,
        "decided_at": datetime.now(timezone.utc).isoformat(),
    }

    print(f"[SAVE] Outlier decision: {sheet_name}/{decision.column} -> {decision.action}")

    try:
        write_yaml(config_path, config)
    except Exception:
        # Last resort: write as JSON so data is never lost
        try:
            fallback = config_path.with_suffix(".decisions.json")
            import json as _json
            with open(fallback, "w", encoding="utf-8") as fb:
                _json.dump(config, fb, ensure_ascii=False, indent=2)
            print(f"[WARN] YAML write failed for {sheet_name}, saved to {fallback}")
        except Exception as e2:
            raise HTTPException(422, f"Failed to write config for {sheet_name}: {e2}")

    # Also update manifest.json outlier counts (best-effort, never block the save response)
    try:
        _update_manifest_counts()
    except Exception:
        pass  # manifest update is informational; don't fail the decision save

    return {"status": "ok", "sheet": sheet_name, "column": decision.column,
            "action": decision.action}


class EscalationResponse(BaseModel):
    index: int
    action: str = "confirmed"  # confirmed | modified | dismissed | deferred
    user_note: Optional[str] = None
    # Legacy fields for backward compat
    confirmed: Optional[bool] = None
    override_note: Optional[str] = None


@app.post("/api/sheet/{sheet_name}/escalation-response")
def post_escalation_response(sheet_name: str, response: EscalationResponse):
    config_path = ANALYSIS_DIR / sheet_name / "config.yaml"
    if not config_path.exists():
        raise HTTPException(404, f"Config not found for sheet: {sheet_name}")

    try:
        config = read_yaml_as_dict(config_path)
    except Exception as e:
        raise HTTPException(422, f"Cannot read config for {sheet_name}: {e}")

    if config.get("_parse_error"):
        raise HTTPException(422, f"Config YAML for {sheet_name} is malformed: {config['_parse_error']}")

    root = _resolve_config_root(config, sheet_name)
    escalations = root.get("escalations", [])

    if response.index >= len(escalations):
        raise HTTPException(400, f"Escalation index {response.index} out of range")

    # Resolve action from new or legacy fields
    action = response.action
    if action == "confirmed" and response.confirmed is not None:
        action = "confirmed" if response.confirmed else "dismissed"

    esc_entry = escalations[response.index]
    esc_entry["user_action"] = action
    esc_entry["user_confirmed"] = action in ("confirmed", "modified")
    esc_entry["user_dismissed"] = action == "dismissed"
    esc_entry["decided_at"] = datetime.now(timezone.utc).isoformat()

    note = response.user_note or response.override_note
    if note:
        esc_entry["user_note"] = note
        esc_entry["user_override"] = note

    print(f"[SAVE] Escalation: {sheet_name}/#{response.index} -> {action}")

    try:
        write_yaml(config_path, config)
    except Exception as e:
        raise HTTPException(422, f"Failed to write config for {sheet_name}: {e}")

    try:
        _update_manifest_counts()
    except Exception:
        pass

    return {"status": "ok", "sheet": sheet_name, "index": response.index, "action": action}


class IssueResponse(BaseModel):
    issue_id: str
    response: Optional[str] = None
    resolved: bool = True
    user_action: Optional[str] = None  # accepted | rejected | commented
    user_comment: Optional[str] = None


@app.post("/api/sheet/{sheet_name}/issue-response")
def post_issue_response(sheet_name: str, resp: IssueResponse):
    config_path = ANALYSIS_DIR / sheet_name / "config.yaml"
    if not config_path.exists():
        raise HTTPException(404, f"Config not found for sheet: {sheet_name}")

    try:
        config = read_yaml_as_dict(config_path)
    except Exception as e:
        raise HTTPException(422, f"Cannot read config for {sheet_name}: {e}")

    if config.get("_parse_error"):
        raise HTTPException(422, f"Config YAML for {sheet_name} is malformed: {config['_parse_error']}")

    root = _resolve_config_root(config, sheet_name)
    issues = root.get("issues", [])

    # Find the issue by id
    found = False
    for issue in issues:
        if isinstance(issue, dict) and issue.get("id") == resp.issue_id:
            issue["user_response"] = resp.response
            issue["resolved"] = resp.resolved
            issue["decided_at"] = datetime.now(timezone.utc).isoformat()
            if resp.user_action:
                issue["user_action"] = resp.user_action
            if resp.user_comment:
                issue["user_comment"] = resp.user_comment
            found = True
            break

    if not found:
        raise HTTPException(400, f"Issue {resp.issue_id} not found in {sheet_name}")

    action_label = resp.user_action or "resolved"
    print(f"[SAVE] Issue: {sheet_name}/{resp.issue_id} -> {action_label}")

    try:
        write_yaml(config_path, config)
    except Exception as e:
        raise HTTPException(422, f"Failed to write config for {sheet_name}: {e}")

    try:
        _update_manifest_counts()
    except Exception:
        pass

    return {"status": "ok", "sheet": sheet_name, "issue_id": resp.issue_id}


@app.get("/api/export-plan")
def get_export_plan():
    """Generate a text plan summarizing all user decisions."""
    if not (ANALYSIS_DIR / "manifest.json").exists():
        raise HTTPException(404, "Manifest not found")

    manifest = json.loads((ANALYSIS_DIR / "manifest.json").read_text(encoding="utf-8"))
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("SheetPreprocessor — Export Plan")
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat()}")
    lines.append(f"Analysis dir: {ANALYSIS_DIR}")
    lines.append("=" * 60)
    lines.append("")

    total_outlier_decided = 0
    total_escalation_decided = 0
    total_issues_resolved = 0

    for sheet_info in manifest.get("sheets", []):
        name = sheet_info.get("name") or sheet_info.get("sheet")
        if not name:
            continue
        config_path = ANALYSIS_DIR / name / "config.yaml"
        if not config_path.exists():
            continue
        try:
            cfg = read_yaml_as_dict(config_path)
            if not cfg or cfg.get("_parse_error"):
                continue
            root = _resolve_config_root(cfg, name)
            if not isinstance(root, dict):
                continue

            sheet_lines: list[str] = []

            # Outlier decisions
            cols = root.get("columns", {})
            if isinstance(cols, dict):
                for col_name, col_data in cols.items():
                    if isinstance(col_data, dict) and col_data.get("outlier_decisions"):
                        d = col_data["outlier_decisions"]
                        action = d.get("action", "?")
                        note = d.get("custom_note") or ""
                        clip = d.get("clip_bounds") or ""
                        detail = f" ({note})" if note else (f" {clip}" if clip else "")
                        sheet_lines.append(f"  [Outlier] {col_name}: {action}{detail}")
                        total_outlier_decided += 1

            # Escalation decisions
            esc = root.get("escalations", [])
            if isinstance(esc, list):
                for i, e in enumerate(esc):
                    if isinstance(e, dict) and (e.get("user_action") or e.get("user_confirmed") is not None):
                        action = e.get("user_action") or ("confirmed" if e.get("user_confirmed") else "dismissed")
                        note = e.get("user_note") or e.get("user_override") or ""
                        detail = f" — {note}" if note else ""
                        issue_label = e.get("issue", f"#{i}")
                        sheet_lines.append(f"  [Escalation] {issue_label}: {action}{detail}")
                        total_escalation_decided += 1

            # Issue decisions
            issues = root.get("issues", [])
            if isinstance(issues, list):
                for issue in issues:
                    if isinstance(issue, dict) and issue.get("resolved"):
                        resp = issue.get("user_response") or ""
                        detail = f" — {resp}" if resp else ""
                        sheet_lines.append(f"  [Issue] {issue.get('id', '?')}: resolved{detail}")
                        total_issues_resolved += 1

            if sheet_lines:
                lines.append(f"--- {name} ---")
                lines.extend(sheet_lines)
                lines.append("")

        except Exception:
            continue

    lines.append("=" * 60)
    lines.append("Summary:")
    lines.append(f"  Outlier decisions made: {total_outlier_decided}")
    lines.append(f"  Escalations decided: {total_escalation_decided}")
    lines.append(f"  Issues resolved: {total_issues_resolved}")
    lines.append("")

    run_num = str(ANALYSIS_DIR).split("runs/")[-1].split("/")[0] if "runs/" in str(ANALYSIS_DIR) else "N"
    lines.append("To proceed to Phase 2, use this prompt:")
    lines.append(f"  'Run Phase 2 of SheetPreprocessor using the approved plan at runs/{run_num}/analysis/export_plan.txt'")
    lines.append("")

    plan_text = "\n".join(lines)

    # Also save to file
    plan_path = ANALYSIS_DIR / "export_plan.txt"
    plan_path.write_text(plan_text, encoding="utf-8")
    print(f"[EXPORT] Plan saved to {plan_path}")

    return {"plan": plan_text, "path": str(plan_path)}


def _resolve_config_root(cfg: dict, sheet_name: str) -> dict:
    """Resolve the sheet config root regardless of nesting pattern.

    Known patterns:
      1. Flat: top-level has 'columns', 'escalations', etc.
      2. Nested under sheet name: cfg[sheet_name] is the root
      3. Nested under 'sheets': cfg['sheets'][sheet_name] is the root
    """
    # Pattern 2: directly under sheet name
    if sheet_name in cfg and isinstance(cfg[sheet_name], dict):
        inner = cfg[sheet_name]
        if any(k in inner for k in ("columns", "escalations", "issues", "kind")):
            return inner
    # Pattern 3: nested under 'sheets' key
    if "sheets" in cfg and isinstance(cfg["sheets"], dict):
        inner = cfg["sheets"].get(sheet_name)
        if isinstance(inner, dict):
            return inner
    # Pattern 1: flat
    return cfg


def _update_manifest_counts():
    """Recount pending outlier decisions and escalations across all sheets."""
    manifest_path = ANALYSIS_DIR / "manifest.json"
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    total_outlier_pending = 0
    total_escalation_pending = 0
    total_issues_pending = 0
    for sheet_info in manifest.get("sheets", []):
        name = sheet_info.get("name") or sheet_info.get("sheet")
        if not name:
            continue
        config_path = ANALYSIS_DIR / name / "config.yaml"
        if not config_path.exists():
            continue
        try:
            cfg = read_yaml_as_dict(config_path)
            if not cfg or cfg.get("_parse_error"):
                continue
            # Merge legacy escalations into issues
            _merge_escalations_into_issues(cfg, name)
            root = _resolve_config_root(cfg, name)
            if not isinstance(root, dict):
                continue
            # Count outlier groups without decisions
            cols = root.get("columns", {})
            if not isinstance(cols, dict):
                cols = {}
            pending = 0
            for col_name, col_data in cols.items():
                if isinstance(col_data, dict) and col_data.get("type") == "continuous":
                    if "outlier_decisions" not in col_data:
                        pending += 1
            sheet_info["outlier_groups_pending"] = pending
            total_outlier_pending += pending
            # Escalations are now merged into issues — set to 0 for legacy compat
            sheet_info["escalations_pending"] = 0
            # Count unresolved issues (includes merged escalations)
            issues = root.get("issues", [])
            if not isinstance(issues, list):
                issues = []
            issues_pend = sum(1 for iss in issues if isinstance(iss, dict) and not iss.get("resolved", False))
            sheet_info["issues_pending"] = issues_pend
            total_issues_pending += issues_pend
        except Exception:
            # Never let one broken sheet block manifest updates for other sheets
            continue

    manifest["outlier_groups_pending"] = total_outlier_pending
    manifest["escalation_count"] = 0  # Legacy — escalations are now merged into issues
    manifest["issues_pending"] = total_issues_pending
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------------------------------------------------------------------------
# Static files + SPA fallback
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


# Mount static AFTER specific routes so API routes take precedence
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    global ANALYSIS_DIR
    args = parser.parse_args()
    if args.analysis_dir:
        ANALYSIS_DIR = Path(args.analysis_dir).resolve()
    else:
        # Auto-detect: try ./analysis/ (per-run), then ../analysis/ (from webapp/)
        for candidate in [Path("analysis"), Path("../analysis"), Path(".")]:
            if (candidate / "manifest.json").exists():
                ANALYSIS_DIR = candidate.resolve()
                break
        else:
            print("Error: cannot find analysis/ folder. Use --analysis-dir.", file=sys.stderr)
            sys.exit(1)
    if not ANALYSIS_DIR.exists():
        print(f"Error: analysis directory not found: {ANALYSIS_DIR}", file=sys.stderr)
        sys.exit(1)
    print(f"\n  SheetPreprocessor Review Webapp")
    print(f"  Analysis dir: {ANALYSIS_DIR}")
    print(f"  Open: http://{args.host}:{args.port}\n")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
