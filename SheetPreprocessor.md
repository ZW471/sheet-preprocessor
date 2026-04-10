# SheetPreprocessor

A reference document for coding agents (Claude Code, Codex, etc.) that turns messy real-world spreadsheets into clean, model-ready PyTorch tensors through a **human-in-the-loop** workflow.

> **How to use this file.** This is not an installable skill. The user invokes it by passing it into your context, e.g. *"please read `SheetPreprocessor.md` and process the sheets under `./data/`"*. Only follow this document when the user's request explicitly mentions **"sheet preprocessor"** (or names this file). Do not auto-trigger on generic data-cleaning requests.

> **This file is an index, not a manual.** Each protocol below lives in its own file under `protocols/` and is **lazy-loaded only when its phase / step actually runs**. Do not preload them all. Reading every protocol up front wastes context — read what you need, when you need it.

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

1. **Never load a full sheet into your context.** Drive Polars / openpyxl inside a Python subprocess and return summaries only. → Protocol A.
2. **Never finalize preprocessing without user approval of Phase 1.** The analysis report is reviewed and explicitly approved before any code generation.
3. **Never silently drop rows or impute values.** Every cleaning decision appears in the report and is cross-referenced from the generated code. → Protocol D.
4. **The generated codebase must run standalone.** No agent, no skill, just `python preprocess.py --input <file> --output <dir>`.
5. **Confirm the `.pt` schema with the user** before writing the tensor generator. → Protocol E.
6. **Polars first.** Reach for pandas only if polars truly cannot express the operation, and explain why in a code comment.
7. **The relationship data file is mandatory** when ≥3 sheets share a non-trivial join key. → Protocol G.
8. **Never auto-decide outlier handling.** Present outliers to the user via the review webapp. Being outside 1.5×IQR does NOT mean a value is invalid. The user decides what to do.

---

## Protocol index

Read each protocol file only when you reach its trigger step.

| ID | File | Trigger |
|----|------|---------|
| A | [`protocols/A_reading.md`](protocols/A_reading.md) | Phase 1 step 1 (inventory), step 4 (any data access) |
| B | [`protocols/B_classification.md`](protocols/B_classification.md) | Phase 1 step 3 (column type classification) |
| C | [`protocols/C_diagnostics.md`](protocols/C_diagnostics.md) | Phase 1 step 4 (per-column stats) |
| D | [`protocols/D_proposals.md`](protocols/D_proposals.md) | Phase 1 step 6 (writing fix proposals) |
| E | [`protocols/E_pt_contract.md`](protocols/E_pt_contract.md) | Phase 2 (before writing `tensorize.py`) |
| F | [`protocols/F_timeseries.md`](protocols/F_timeseries.md) | Phase 1 step 5 + Phase 2 `timeseries.py` (any `long_timeseries` sheet) |
| G | [`protocols/G_relationships_view.md`](protocols/G_relationships_view.md) | Phase 1 step 8 (relationship viewer — mandatory when triggered) |
| H | [`protocols/H_config_schema.md`](protocols/H_config_schema.md) | Phase 1 step 7 (writing draft config) + Phase 2 (consuming it) |
| I | [`protocols/I_formatter.md`](protocols/I_formatter.md) | Phase 1 step 7 (output format validation — canonical schemas for webapp) |
| J | [`protocols/J_semi_structured.md`](protocols/J_semi_structured.md) | Phase 1 step 3 (when a sheet has 20+ patterned columns) |
| K | [`protocols/K_issues.md`](protocols/K_issues.md) | Phase 1 steps 3–7 (flagging uncertainties for user input) |

---

## Workflow

Three phases. Track them with TodoWrite.

### Phase 1 — Analyze (interactive)

**Goal:** produce a per-sheet analysis report, then get explicit user sign-off.

1. **Inventory the workbook.** List sheet names, shapes, and candidate join keys between sheets. → **Read Protocol A.**
2. **Detect sheet *kind*.** Classify each sheet as one of:
   - `wide_snapshot` — one row per entity, many columns
   - `long_timeseries` — one row per (entity, timestamp), few columns
   - `lookup_table` — small reference / dimension sheet
   - `id_list` — single-column list of entity IDs
   The single permitted data access in Step 1 (streaming the entity-key column to compute `rows / n_unique`) is documented in Protocol A. Use the rule in Protocol F to spot long-format sheets.
3. **Classify every column** into `continuous / ordered_categorical / unordered_categorical / multi_label / text / id / datetime`. → **Read Protocol B.** If a sheet has 20+ columns following a naming pattern (e.g., `section#subsection`), also **read Protocol J** for semi-structured data handling. For any ambiguous classifications, **read Protocol K** and create issues for user input. Show the classification table and ask the user to correct ambiguous cases before running expensive diagnostics.
4. **Run per-column diagnostics.** → **Read Protocol C.** Use polars lazy expressions so you only scan the sheet once per stat group.
5. **Run time-series diagnostics** on every `long_timeseries` sheet. → **Read Protocol F.** Cover adherence, missingness decay, informative missingness, per-entity max change rate, duplicate / copy-paste detection.
6. **Propose fixes.** → **Read Protocol D.** Present issues to the user — do NOT auto-decide how to handle outliers. The user decides via the review webapp.
7. **Write analysis outputs** to per-sheet subfolders. → **Read Protocol I** for canonical output schemas that the webapp expects.
   - `analysis/<sheet_name>/stats.json` — full-precision per-column statistics
   - `analysis/<sheet_name>/config.yaml` — per-sheet config fragment (Protocol H)
   - `analysis/<sheet_name>/timing.json` — worker timing metrics
   - `analysis/config.draft.yaml` — assembled draft config (Protocol H)
   - `analysis/manifest.json` — lightweight index of all sheets, paths, and metadata for the webapp
   - `analysis/relationships.json` — structured relationship data (Protocol G)
   Do NOT emit markdown analysis files (`_analysis.md`, `summary.md`). The review webapp renders everything from JSON/YAML.
8. **Relationship data (mandatory when triggered).** → **Read Protocol G.** If ≥3 sheets share a non-trivial join key, emit `analysis/relationships.json`. Skipping this is a Phase 1 failure.
9. **Launch the review webapp.** Run the webapp directly from the `webapp/` folder, pointing it at this run's analysis:
   ```
   cd webapp && .venv/bin/python server.py --analysis-dir ../runs/<N>/analysis/
   ```
   Then tell the user: *"Analysis complete. Review your data in the webapp at http://localhost:8787. Use it to review outliers, confirm escalations, resolve issues (Questions/Issues tab), and approve the analysis before Phase 2."* Do not proceed to Phase 2 until the user explicitly approves and all non-info issues (Protocol K) are resolved.

### Phase 2 — Generate preprocessing codebase

**Goal:** emit a standalone, maintainable Python package that faithfully reproduces the approved plan.

Before writing code, **confirm the `.pt` schema** with the user. → **Read Protocol E.**

Then scaffold:
```
preprocess/
├── preprocess.py                 # CLI entry
├── config.yaml                   # all decisions from Phase 1 (Protocol H, single source of truth)
├── sheet_preprocessor/
│   ├── __init__.py
│   ├── io.py                     # polars streaming readers (Protocol A)
│   ├── classify.py               # reads config.yaml, exposes typed column groups
│   ├── clean.py                  # one function per fix rule, each returns (df, mask)
│   ├── encode.py                 # categorical + multi-label encoders, persists mapper.json
│   ├── timeseries.py             # groupby-based aggregation for long sheets (Protocol F)
│   ├── tensorize.py              # builds the .pt dict (Protocol E)
│   └── validate.py               # post-condition assertions
├── tests/
│   └── test_smoke.py             # runs on a 100-row sample
└── requirements.txt              # polars, pyarrow, openpyxl, torch, pyyaml
```

**Code-quality requirements:**
- Every clean function docstring cites the analysis file + issue that motivated it (Protocol D).
- `config.yaml` holds every column name, type, threshold, and fix rule. Never hard-code them in `.py`. (Protocol H.)
- `mapper.json` is **bidirectional**: `{"<column>": {"label_to_id": {...}, "id_to_label": {...}}}`. Predictions must be decodable with just this file.
- Pipeline is deterministic: set seeds, sort by ID, pin polars to a single-threaded read where ordering matters.
- Emit `preprocess_report.json` with row counts before/after each step and imputation counts per column.

Smoke-test with `python preprocess.py --input <sample> --output /tmp/smoke --sample 100` before handing back.

### Phase 3 — Document

Write at project root:

**`README.md`** (user-facing):
- Dataset description and provenance
- Quick-start command
- Output schema with shapes / dtypes (Protocol E)
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

## Anti-patterns to avoid

- ❌ Reading a full xlsx or csv into memory in your first action.
- ❌ Pasting sheet contents into your reply "for inspection".
- ❌ Preloading every protocol file at the start. Lazy-load per the index above.
- ❌ Using pandas by default. Polars first; document any pandas fallback.
- ❌ Generating code before Phase 1 is approved.
- ❌ Treating numeric-encoded categoricals as continuous because their dtype is numeric.
- ❌ Auto-deciding outlier handling. Present outliers to the user; they decide via the webapp what is invalid vs legitimate.
- ❌ Treating statistical outliers (outside 1.5×IQR) as data errors. Age=78 in a weight-loss cohort is legitimate, not an error.
- ❌ Emitting markdown analysis files. The review webapp is the primary interface; output JSON/YAML only.
- ❌ Writing analysis outputs as flat files. Use per-sheet subfolders: `analysis/<sheet>/stats.json`.
- ❌ Hard-coding column names or thresholds in `.py` files instead of `config.yaml`.
- ❌ Forgetting the `id_to_label` direction in `mapper.json` — predictions become undecodable.
- ❌ Storing time series as a Python list of per-entity frames in the `.pt`. Always emit dense `[N, T, D]` + mask.
- ❌ Padding time series with `NaN`. Pad with `0`, mask with `False`.
- ❌ Skipping the relationship data (Protocol G) when its trigger fires.
- ❌ Rounding stats before computing outlier fences. Store full precision in `<sheet>_stats.json`. (Protocol C.)
- ❌ Auto-triggering on generic requests. Only act when the user mentions **sheet preprocessor** or names this file.
- ❌ Using dataset-specific examples in protocols. Protocols must be generic and work for ANY dataset — use placeholders like `<sheet_name>`, `<entity_key>`, `<column_name>` instead of concrete sheet or column names from a particular workbook.
- ❌ Treating semi-structured columns (patterned names with low-cardinality values) as independent continuous variables. Use Protocol J to detect and handle these.
- ❌ Proceeding to Phase 2 with unresolved issues. All `question` and `multichoice` issues (Protocol K) must be resolved before code generation.

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
