# Protocol H — `config.draft.yaml` schema

**Lazy-loaded by:** Phase 1 step 7 (when writing the draft) and Phase 2 (when consuming it).

This is the single source of truth that connects Phase 1 analysis to Phase 2 code generation. Every column name, type, threshold, and fix rule lives here. Phase 2 code must NEVER hard-code any of these — it loads from `config.yaml` (the user-approved version of `config.draft.yaml`).

## Top-level schema

```yaml
version: 1
source_file: "example_sheets/visit.xlsx"   # workbook stem used in <stem>::<sheet> indexing

defaults:
  implausible_delta:                         # per Protocol F
    weight_kg:    3.0
    sbp_mmhg:    40.0
    glucose_mmol: 5.0
  bucket_days: 7
  copy_paste_run_len: 3

sheets:
  <sheet_name>:
    kind: wide_snapshot | wide_snapshot_repeated | long_timeseries | long_timeseries_borderline | lookup_table | id_list
    entity_key: <col>
    time_key:   <col>          # required for long_timeseries; optional for wide_snapshot_repeated
    value_cols: [<col>, ...]   # for long_timeseries — which columns are the measured values
    cadence_per_day: 1.0       # adherence denominator for long_timeseries (1/d, 7/d, …)
    inband_null_tokens: ["", "N/A", "-", "无", "未知"]   # pre-scrub before classification
    domain_limits:
      <col>: { min: <float>, max: <float>, units: "kg" }
    columns:
      <col>:
        type: continuous | ordered_categorical | unordered_categorical | multi_label | text | id | datetime
        encoding: label | onehot | multihot | none
        units: "kg"            # first-class unit tag (promoted from domain_limits in round 2)
        levels: [...]          # for ordered_categorical
        separator: ","         # for multi_label
        fix_rules: [<rule_id>, ...]  # references clean.py functions
        notes: "..."
    header_dedup_log: [...]    # original header → renamed header

    # Per-entity constants promoted out of this sheet (Protocol B / F).
    # Each fragment is a column set whose values are constant per entity_key and can be
    # joined back from the wide_snapshot sheet rather than tiled across time-series rows.
    fragments:
      <fragment_name>:
        kind: wide_snapshot_fragment
        source_sheet: <the wide_snapshot sheet that owns these columns>
        columns: [年龄, 性别]

    # Escalations that the user must confirm before Phase 2. Structured so the
    # assembler can enforce them. free-form notes go in `notes:` only.
    escalations:
      - protocol: F
        column: 运动耗能
        issue: implausible_delta_default_missing
        proposal: "escalate exercise_kcal threshold to user"
        user_confirmed: false

join_keys:
  - key: 患者id
    sheets: [建档, 体重, 体成分, ...]
    coverage: 0.97             # min coverage across sheets
    role: primary              # primary | foreign | demographic
```

## Per-sheet fragment format

Each per-sheet worker writes its own fragment to `analysis/<sheet>_config.yaml` with just the `sheets.<sheet_name>` subtree (no `version`, no `source_file`, no top-level keys). The assembler merges fragments + adds top-level metadata + computes `join_keys` from cross-sheet column intersections.

This split enables parallel workers — each worker only writes its own file, and the assembler runs once at the end.

## Validation rules (assembler must enforce)

- Every `entity_key` must appear in `columns` for that sheet.
- Every `long_timeseries` sheet must declare a `time_key` and at least one `value_col`.
- `domain_limits` keys must be a subset of `columns`.
- `join_keys[*].sheets` must all exist in `sheets`.
- Fragments missing required fields fail the assembly step with a clear error pointing to the responsible worker.
