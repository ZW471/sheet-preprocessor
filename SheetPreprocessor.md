# SheetPreprocessor

A reference document for coding agents (Claude Code, Codex, etc.) that turns messy real-world spreadsheets into clean, model-ready PyTorch tensors through a **human-in-the-loop** workflow.

> **How to use this file.** This is not an installable skill. The user invokes it by passing it into your context, e.g. *"please read `SheetPreprocessor.md` and process the sheets under `./data/`"*. Only follow this document when the user's request explicitly mentions **"sheet preprocessor"** (or names this file). Do not auto-trigger on generic data-cleaning requests.

> **Default stack: Polars.** Use `polars` for all reads, stats, groupby, and joins unless the user explicitly asks for pandas. Polars' lazy API (`pl.scan_csv`, `pl.scan_parquet`, `LazyFrame.collect(streaming=True)`) is the right tool for the large sheets this document targets. Fall back to `openpyxl` read-only streaming only when you need per-cell control on an xlsx that polars cannot express.

---

## When to follow this document

Trigger only when the user's request contains **"sheet preprocessor"** (case-insensitive) AND asks for one of:
- "preprocess … xlsx / csv"
- "clean … and turn it into .pt / tensors"
- "analyze missing values / outliers and build a pipeline"
- "build a data pipeline for this spreadsheet"

Do **not** follow this document for: one-off data questions, ad-hoc plots, or bug fixes in an existing pipeline.

---

## Hard rules

1. **Never load a full sheet into your context.** Drive Polars / openpyxl inside a Python subprocess and return summaries only. See Protocol A.
2. **Never finalize preprocessing without user approval of Phase 1.** The analysis report is reviewed and explicitly approved before any code generation.
3. **Never silently drop rows or impute values.** Every cleaning decision appears in the report and is cross-referenced from the generated code.
4. **The generated codebase must run standalone.** No agent, no skill, just `python preprocess.py --input <file> --output <dir>`.
5. **Confirm the `.pt` schema with the user** before writing the tensor generator. Default: a dictionary of tensors (see Protocol E).
6. **Polars first.** Reach for pandas only if polars truly cannot express the operation, and explain why in a code comment.

---

## Workflow

Three phases. Track them with TodoWrite.

### Phase 1 — Analyze (interactive)

**Goal:** produce a per-sheet analysis report, then get explicit user sign-off.

1. **Inventory the workbook.** List sheet names, shapes, and candidate join keys between sheets (Protocol A). For xlsx, use `openpyxl` read-only to fetch shapes without touching the data; for csv, use `pl.scan_csv(path).collect_schema()` to read headers only.
2. **Detect sheet *kind*.** Classify each sheet as one of:
   - `wide_snapshot` — one row per entity, many columns
   - `long_timeseries` — one row per (entity, timestamp), few columns
   - `lookup_table` — small reference / dimension sheet
   - `id_list` — single-column list of entity IDs
   Use the rule in Protocol F to spot long-format sheets.
3. **Classify every column** into `continuous / ordered_categorical / unordered_categorical / multi_label / text / id / datetime`. Use **unique-value count** as the primary signal (Protocol B). Show the classification table and ask the user to correct ambiguous cases before running expensive diagnostics.
4. **Run per-column diagnostics** (Protocol C) using polars lazy expressions so you only scan the sheet once per stat group.
5. **Run time-series diagnostics** on every `long_timeseries` sheet (Protocol F): adherence, missingness decay, informative missingness, per-entity max change rate, duplicate / copy-paste detection.
6. **Propose fixes.** One concrete proposal per issue, with a confidence level. Don't list five options — pick the best and justify it in one sentence.
7. **Write reports** to:
   - `analysis/<sheet_name>_analysis.md` — per-sheet diagnostics + proposals
   - `analysis/summary.md` — cross-sheet relationships, join keys, sheet-kind table
   - `analysis/config.draft.yaml` — a draft of the config the pipeline will consume in Phase 2
8. **Optional: relationship viewer.** If the workbook has ≥3 sheets with non-trivial join keys, emit `analysis/relationships.html` as a single-file visualization (vanilla HTML + vis-network or d3 via CDN, <500 lines, no build step). Nodes = sheets, edges = shared keys, node size = row count, edge thickness = join coverage. Skip this for single-CSV inputs.
9. **Stop and wait for approval.** Show the user the summary file path and ask: *"Please review `analysis/summary.md` and the per-sheet files. Tell me what to change, or say 'approved' to continue to Phase 2."* Do not proceed until the user explicitly approves.

### Phase 2 — Generate preprocessing codebase

**Goal:** emit a standalone, maintainable Python package that faithfully reproduces the approved plan.

Before writing code, **confirm the `.pt` schema** with the user. Default proposal (Protocol E):
```python
{
    "continuous":    FloatTensor[N, C_cont],
    "ordered_cat":   LongTensor[N, C_ord],
    "unordered_cat": LongTensor[N, C_unord],
    "multi_label":   FloatTensor[N, C_multi],          # multi-hot
    "text":          List[str],
    "mask":          BoolTensor[N, C_cont + C_ord + C_unord + C_multi],
    "timeseries": {                                     # one entry per long-format sheet
        "<sheet>": {
            "values": FloatTensor[N, T, D],
            "time":   FloatTensor[N, T],                # days since baseline
            "mask":   BoolTensor[N, T],
        },
    },
    "id":   List[str],                                  # row → entity ID
    "meta": {
        "feature_names":    {...},
        "split":            {"train": LongTensor, "val": LongTensor, "test": LongTensor},
        "continuous_stats": {...},                      # mean / std for inference-time z-scoring
        "schema_version":   1,
        "source_file":      "...",
    },
}
```
Ask specifically:
- Merge long-format sheets as **summary features** (mean / slope / last) or keep as **`[N, T, D]` tensors**?
- Alignment strategy for time series (fixed grid? event-time? pad + mask?)
- Train/val/test split: random, by entity, or by time?

Then scaffold:
```
preprocess/
├── preprocess.py                 # CLI entry
├── config.yaml                   # all decisions from Phase 1 (single source of truth)
├── sheet_preprocessor/
│   ├── __init__.py
│   ├── io.py                     # polars streaming readers (Protocol A)
│   ├── classify.py               # reads config.yaml, exposes typed column groups
│   ├── clean.py                  # one function per fix rule, each returns (df, mask)
│   ├── encode.py                 # categorical + multi-label encoders, persists mapper.json
│   ├── timeseries.py             # groupby-based aggregation for long sheets (Protocol F)
│   ├── tensorize.py              # builds the .pt dict
│   └── validate.py               # post-condition assertions
├── tests/
│   └── test_smoke.py             # runs on a 100-row sample
└── requirements.txt              # polars, pyarrow, openpyxl, torch, pyyaml
```

**Code-quality requirements:**
- Every clean function docstring cites the analysis file + issue that motivated it.
- `config.yaml` holds every column name, type, threshold, and fix rule. Never hard-code them in `.py`.
- `mapper.json` is **bidirectional**: `{"<column>": {"label_to_id": {...}, "id_to_label": {...}}}`. Predictions must be decodable with just this file.
- Pipeline is deterministic: set seeds, sort by ID, pin polars to a single-threaded read where ordering matters.
- Emit `preprocess_report.json` with row counts before/after each step and imputation counts per column.

Smoke-test with `python preprocess.py --input <sample> --output /tmp/smoke --sample 100` before handing back.

### Phase 3 — Document

Write at project root:

**`README.md`** (user-facing):
- Dataset description and provenance
- Quick-start command
- Output schema with shapes / dtypes
- How to decode categorical predictions using `mapper.json`
- Known caveats from Phase 1 analysis
- Link to `analysis/` for full diagnostics

**`AGENT.md`** (maintainer-facing, for future coding agents):
- Decision map: analysis file → `config.yaml` entry → `clean.py` function
- How to add a new column (edit `config.yaml` only, unless a new fix function is needed)
- How to change the `.pt` schema (edit `tensorize.py`, bump `meta["schema_version"]`)
- How to re-run diagnostics on new raw data (`python preprocess.py --analyze-only`)
- Polars idioms used here (lazy scans, streaming collect, groupby-agg patterns)

---

## Protocol A — Reading large sheets without blowing up context

**Never** paste sheet contents into your reply. Always drive a Python subprocess that returns summaries.

### Step 1 — inventory (no row data)

**xlsx (multi-sheet):**
```python
import openpyxl
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
for s in wb.sheetnames:
    ws = wb[s]
    print(s, ws.max_row, ws.max_column)
wb.close()
```

**csv:**
```python
import polars as pl, os
size   = os.path.getsize(path)
schema = pl.scan_csv(path, n_rows=0).collect_schema()   # headers + inferred dtypes, no rows
```

### Step 2 — headers only

```python
# xlsx
ws     = wb[sheet]
header = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))

# csv
cols = pl.scan_csv(path).collect_schema().names()
```

### Step 3 — streaming column stats with Polars lazy

For xlsx, convert a sheet to a `LazyFrame` via `pl.read_excel(..., sheet_name=s).lazy()` when the sheet fits comfortably in memory (≲2M cells). For larger sheets, dump the sheet to parquet once via openpyxl streaming, then `pl.scan_parquet` for all subsequent work:
```python
import openpyxl, polars as pl
ws     = wb[sheet]
rows   = ws.iter_rows(values_only=True)
header = next(rows)
pl.LazyFrame(
    (dict(zip(header, r)) for r in rows),
    schema=header,
).sink_parquet(f"cache/{sheet}.parquet")
```
Then:
```python
lf    = pl.scan_parquet(f"cache/{sheet}.parquet")
stats = lf.select(
    [pl.col(c).null_count().alias(f"{c}__null") for c in cols]
  + [pl.col(c).n_unique().alias(f"{c}__nunique") for c in cols]
).collect(streaming=True)
```

**Rules:**
- Prefer `.collect(streaming=True)` on large frames.
- Never call `.to_pandas()` on a frame you haven't bounded.
- Never `print(df)` — print `df.head(5)` or `df.describe()` only.

**Sheet indexing convention:** `<workbook_stem>::<sheet_name>`. Always include this prefix in reports and config so multi-file runs don't collide.

---

## Protocol B — Column type classification (unique-value first)

The primary signal is **unique-value count**, cheap to compute via `pl.col(c).n_unique()` in a single lazy pass. Apply rules in order; first match wins. Show the full table to the user for confirmation.

Let `n = row_count`, `u = n_unique(col)`, `r = u / n` (uniqueness ratio).

| Rule | Classification |
|---|---|
| dtype is date/datetime, or column name matches a date-like token (`date`, `time`, `日期`, `时间`, …), or ≥90% of sampled values parse as dates | `datetime` |
| Column name ends in an id-like token (`id`, `_id`, `uuid`, `编号`, …), OR `r ≥ 0.95` AND dtype is string AND avg length ≥ 8 | `id` |
| String dtype AND mean length > 30, OR values contain sentence punctuation | `text` |
| String dtype AND values contain a separator (`,`  `;`  `、`  `/`) AND the split-out token set is small | `multi_label` |
| `u ≤ 20` AND column name hints order (`score`, `level`, `grade`, `stage`, `severity`, `评分`, `等级`, `级别`, `程度`, …) | `ordered_categorical` |
| `u ≤ 20` AND no ordering hint | `unordered_categorical` *(escalate to user — could be nominal or ordinal without the hint)* |
| `u > 20` AND `u ≤ 50` AND string dtype | `unordered_categorical` |
| Numeric dtype AND `u > 50` | `continuous` |
| Numeric dtype AND `20 < u ≤ 50` | **escalate** — could be a binned scale or a low-resolution continuous variable. Ask the user. |
| Fallback | `text` *(escalate)* |

**Why unique-value first:** cheap to compute in one pass, dtype-agnostic (catches numeric-encoded categoricals like `1=low, 2=mid, 3=high`), and directly informs the encoder choice later. Dtype is only a tiebreaker.

**Tune thresholds to the sheet size.** The fixed cutoffs above (20, 50, 0.95) are defaults for sheets with `n ≥ 1000`. For small sheets (`n < 1000`), use `u ≤ 0.02 * n` as the categorical cutoff. For very large sheets (`n > 10^6`), raise the "continuous" cutoff to `u > 200` so low-resolution sensor readouts are not misread as continuous.

**Always escalate to the user:**
- Integer columns with 3–20 unique values (ordinal scale vs nominal code vs low-res continuous)
- Small-integer-range columns that are physically continuous (bounded counts, rounded measurements)
- Free-text fields that collapse to a category after normalization
- Multi-label columns — must become `multi_label`, not `unordered_categorical`

Record the final classification in `config.yaml`:
```yaml
columns:
  <col_name>:
    type: continuous | ordered_categorical | unordered_categorical | multi_label | text | id | datetime
    encoding: label | onehot | multihot | none
    levels: [...]          # for ordered_categorical
    separator: ","         # for multi_label
    notes: "…"
```

---

## Protocol C — Diagnostics per type

Compute every stat through a single lazy polars query per sheet. Example for continuous columns:
```python
cont_cols = [...]
stats = lf.select(
    [pl.col(c).count().alias(f"{c}__n")              for c in cont_cols]
  + [pl.col(c).null_count().alias(f"{c}__miss")      for c in cont_cols]
  + [pl.col(c).mean().alias(f"{c}__mean")            for c in cont_cols]
  + [pl.col(c).median().alias(f"{c}__median")        for c in cont_cols]
  + [pl.col(c).std().alias(f"{c}__std")              for c in cont_cols]
  + [pl.col(c).quantile(q).alias(f"{c}__q{int(q*100)}")
        for c in cont_cols for q in (0.25, 0.75)]
  + [pl.col(c).min().alias(f"{c}__min")              for c in cont_cols]
  + [pl.col(c).max().alias(f"{c}__max")              for c in cont_cols]
  + [pl.col(c).skew().alias(f"{c}__skew")            for c in cont_cols]
).collect(streaming=True)
```
Derive IQR, outlier bounds (`q1 - 1.5*iqr`, `q3 + 1.5*iqr`), outlier count, and a few typical outlier values from the stats frame. Override with domain limits when obvious (ask the user for plausible physical ranges).

**Continuous** —
`N, missing_count, missing_rate, mean, median, std, min, Q1, Q3, max, IQR, skew, outlier_count, outlier_rate, outlier_lower, outlier_upper, typical_outliers(5), proposed_fix`

**Categorical / ordered / unordered** —
`N, missing, cardinality, top_5_value_counts, rare_count(<1%), proposed_encoding`

**Multi-label** —
`N, missing, token_set_size, top_10_tokens_with_counts, avg_tokens_per_row, proposed_separator, proposed_encoding`

**Text** —
`N, missing, length_min / median / max, 5_samples, proposed_handling (keep raw / tokenize later / drop)`

**ID** —
`N, unique, duplicates, referential_integrity_vs_<parent_sheet>, proposed_role (primary_key / foreign_key / drop)`

**Datetime** —
`N, missing, min, max, future_dated_count, gap_histogram, proposed_handling`

---

## Protocol D — Missing values and outliers: proposal format

One row per issue:

```
Issue:      <column> has <count> <pattern> (<rate>)
Diagnosis:  <what the pattern really means>
Proposal:   <single concrete fix>
Code rule:  clean.py::<function_name>
Confidence: high | medium | low
```

Three confidence levels:
- **high** — apply automatically, log in `preprocess_report.json`
- **medium** — apply, but show the decision in the Phase 1 report for review
- **low** — do not apply; re-ask the user before Phase 2

---

## Protocol E — `.pt` output contract

The generated `tensorize.py` must produce a dict that round-trips through `torch.save` / `torch.load` and passes these assertions:

```python
out = torch.load("processed.pt", weights_only=False)
assert set(out) >= {"continuous", "unordered_cat", "ordered_cat", "mask", "id", "meta"}
N = len(out["id"])
for k in ("continuous", "unordered_cat", "ordered_cat", "mask"):
    assert out[k].shape[0] == N
assert not torch.isnan(out["continuous"]).any()           # all NaNs resolved + masked
assert (out["unordered_cat"] >= 0).all()                  # no -1 sentinels
assert out["meta"]["schema_version"] >= 1
for ts_name, ts in out.get("timeseries", {}).items():
    assert ts["values"].shape[:2] == ts["mask"].shape
    assert ts["time"].shape == ts["mask"].shape
```

Z-score parameters go in `meta["continuous_stats"]` so inference code can normalize new rows identically. Splits go in `meta["split"]` as index tensors, not separate files.

---

## Protocol F — Time series handling

Time-series sheets are the most failure-prone part of this workflow. Treat any sheet where `row_count / n_unique(entity_id) ≥ 10` as `long_timeseries`. Also check that the sheet contains a datetime-typed column — a long sheet without a timestamp is probably a join / event log, not a time series.

### Diagnostics (Phase 1)

All computed with polars `group_by` / `.over(entity_key)` so the full sheet is never collected at once.

```python
lf = pl.scan_parquet("cache/<sheet>.parquet")

# Per-entity record counts, time span, adherence
per_entity = (
    lf.group_by(ENTITY_KEY)
      .agg([
          pl.len().alias("n_records"),
          pl.col(TIME_KEY).min().alias("first"),
          pl.col(TIME_KEY).max().alias("last"),
          (pl.col(TIME_KEY).max() - pl.col(TIME_KEY).min())
              .dt.total_days().alias("span_days"),
          pl.col(VALUE_COL).mean().alias("mean_value"),
          pl.col(VALUE_COL).std().alias("std_value"),
      ])
      .with_columns(
          (pl.col("n_records") / pl.col("span_days").clip(1)).alias("adherence")
      )
      .collect(streaming=True)
)

# Per-entity max change rate (copy-paste / implausible-change detection)
sorted_lf = lf.sort([ENTITY_KEY, TIME_KEY])
deltas = (
    sorted_lf
      .with_columns(
          pl.col(VALUE_COL).diff().over(ENTITY_KEY).alias("delta"),
          pl.col(TIME_KEY).diff().over(ENTITY_KEY)
              .dt.total_days().alias("gap_days"),
      )
      .group_by(ENTITY_KEY)
      .agg([
          pl.col("delta").abs().max().alias("max_abs_delta"),
          (pl.col("delta").abs() > IMPLAUSIBLE_DELTA).sum()
              .alias("n_implausible_jumps"),
      ])
      .collect(streaming=True)
)

# Adherence decay — active entities vs time-since-start bucket
by_bucket = (
    sorted_lf
      .with_columns(
          ((pl.col(TIME_KEY) - pl.col(TIME_KEY).min().over(ENTITY_KEY))
              .dt.total_days() // BUCKET_DAYS).alias("bucket")
      )
      .group_by("bucket")
      .agg(pl.col(ENTITY_KEY).n_unique().alias("active_entities"))
      .sort("bucket")
      .collect(streaming=True)
)
```

Report these findings in the per-sheet analysis file:
1. **Adherence distribution** (overall and by any user-specified subgroup)
2. **Missingness decay** — active entities vs time-since-start; does adherence fall off?
3. **Informative missingness** — does gap length correlate with the observed value? (Compute the correlation between `gap_days` and `value` within each entity.)
4. **Physiological / domain limits** — hard upper/lower bounds the user confirms
5. **Change-rate limits** — per-entity `max_abs_delta`; flag values above a domain threshold
6. **Duplicate / copy-paste** — runs of identical consecutive values, or long stretches where `delta == 0`

### Processing (Phase 2)

Expose a `timeseries.py` module with these building blocks, each operating on a `LazyFrame`:

```python
def per_entity_summary(lf, entity_key, time_key, value_col):
    """mean / std / slope / last / first / count — one row per entity."""

def resample_fixed_grid(lf, entity_key, time_key, value_col, freq="1d", max_gap_days=7):
    """Forward-fill within a max-gap window, emit [N, T] + mask."""

def event_aligned_window(lf, entity_key, time_key, value_col, event_time, window_days):
    """Align each entity's series to its baseline event, return [N, T] + mask."""
```

Ask the user which representation to store in the `.pt`:
- **Summary features** → merge into the main `continuous` tensor (one extra column per stat)
- **Fixed-grid tensors** → `timeseries[<sheet>]["values"]: [N, T, D]` with a mask
- **Event-aligned tensors** → same shape, but time is relative to a per-entity event

**Padding and masking rules:**
- Pad with `0.0` and mark masked positions with `False` — **never pad with `NaN`**.
- Persist the per-entity `first_date` / `baseline_event` in `meta["timeseries"][<sheet>]["anchor"]` so inference-time preprocessing can align new data identically.

### Testing

The smoke test must verify time-series shapes for at least one entity:
```python
ts = out["timeseries"][SHEET_NAME]
assert ts["values"].shape[0] == N
assert (ts["mask"].sum(dim=1) > 0).all()                  # every entity has ≥1 observation
assert torch.isfinite(ts["values"][ts["mask"]]).all()
```

---

## Anti-patterns to avoid

- ❌ Reading a full xlsx or csv into memory in your first action.
- ❌ Pasting sheet contents into your reply "for inspection".
- ❌ Using pandas by default. Polars first; document any pandas fallback.
- ❌ Generating code before Phase 1 is approved.
- ❌ Treating numeric-encoded categoricals as continuous because their dtype is numeric.
- ❌ Silently dropping outliers — always impute with a mask, or escalate.
- ❌ Hard-coding column names or thresholds in `.py` files instead of `config.yaml`.
- ❌ Forgetting the `id_to_label` direction in `mapper.json` — predictions become undecodable.
- ❌ Storing time series as a Python list of per-entity frames in the `.pt`. Always emit dense `[N, T, D]` + mask.
- ❌ Padding time series with `NaN`. Pad with `0`, mask with `False`.
- ❌ Making the relationship viewer a heavy SPA. One HTML file, CDN deps, <500 lines.
- ❌ Auto-triggering on generic requests. Only act when the user mentions **sheet preprocessor** or names this file.

---

## Quick reference: default commands

```bash
# Phase 1: inventory + analyze (no full loads)
python -m sheet_preprocessor.io inventory <input>
python -m sheet_preprocessor.io analyze   <input> --out analysis/

# Phase 2: run pipeline
python preprocess.py --input <input> --output out/

# Phase 2 sanity check
python preprocess.py --input <input> --output /tmp/smoke --sample 100

# Re-analyze without touching code
python preprocess.py --analyze-only --input <new_input>
```
