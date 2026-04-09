# Protocol H — `config.draft.yaml` schema

**Lazy-loaded by:** Phase 1 step 7 (when writing the draft) and Phase 2 (when consuming it).

This is the single source of truth that connects Phase 1 analysis to Phase 2 code generation. Every column name, type, threshold, and fix rule lives here. Phase 2 code must NEVER hard-code any of these — it loads from `config.yaml` (the user-approved version of `config.draft.yaml`).

## Top-level schema

```yaml
version: 1
source_file: "example_sheets/visit.xlsx"   # workbook stem used in <stem>::<sheet> indexing

defaults:
  implausible_delta:                         # per Protocol F — MUST enumerate every key from IMPLAUSIBLE_DELTA_DEFAULTS
    weight_kg:     3.0
    sbp_mmhg:     40.0
    glucose_mmol:  5.0
    exercise_kcal: 2000
    diet_kcal:     2000
    protein_g:     100
    fat_g:         100
    carb_g:        300
  bucket_days: 7
  copy_paste_run_len:                        # per-domain dict, NOT a scalar (Round 2 H-1 fix)
    default:   3
    weight_kg: 7
  min_pairs_for_per_entity_corr: 3           # pinned; Protocol F §MIN_PAIRS_FOR_PER_ENTITY_CORR
  inband_null_tokens: ["", "N/A", "-", "无", "未知", "记不清", "不详"]

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
    sheets: [建档, 体重, 体成分, ...]   # MUST list EVERY sheet whose entity_key equals this join key
    unique_per_sheet:                 # populated by each per-sheet worker; null only allowed for id_list
      建档: 5096
      体重: 5098
      体成分: 2415
    coverage: 0.97             # min coverage across sheets
    role: primary              # primary | foreign | demographic
```

## Per-sheet fragment format

Each per-sheet worker writes its own fragment to `analysis/<sheet>_config.yaml` with just the `sheets.<sheet_name>` subtree (no `version`, no `source_file`, no top-level keys). The assembler merges fragments + adds top-level metadata + computes `join_keys` from cross-sheet column intersections.

This split enables parallel workers — each worker only writes its own file, and the assembler runs once at the end.

## Validation rules (assembler must enforce)

- Every `entity_key` must appear in `columns` for that sheet.
- Every `long_timeseries` sheet must declare a `time_key` and at least one `value_col`.
- Every `wide_snapshot_repeated` sheet must declare a `time_key` (Round 2 M-10 fix).
- `domain_limits` keys must be a subset of `columns`.
- `join_keys[*].sheets` must contain EVERY sheet whose `entity_key` equals the join key — no silent omissions (Round 2 M-4 fix).
- `join_keys[*].unique_per_sheet` must be populated for every listed sheet; null only allowed for `id_list` kind (Round 2 M-8 fix).
- `defaults.implausible_delta` must enumerate every key from Protocol F §IMPLAUSIBLE_DELTA_DEFAULTS; assembler fails if any are missing (Round 2 H-2 fix).
- `defaults.copy_paste_run_len` must be a dict with `default:` and per-domain overrides, not a scalar (Round 2 H-1 fix).
- `defaults.min_pairs_for_per_entity_corr` must equal 3 and must match whatever the per-sheet time-series workers use (Round 2 H-3 fix).
- Fragments missing required fields fail the assembly step with a clear error pointing to the responsible worker.

## Optional column schema: `empty_string_split` (Round 2 M-7)

Some categorical columns encode "not applicable" as an empty string gated by a sibling column (e.g., `运动#每次运动时间` is empty iff `是否运动 == 无`). To make this machine-readable:

```yaml
columns:
  运动#每次运动时间:
    type: ordered_categorical
    empty_string_split:
      gate_column: 是否运动
      gate_value:  "无"
      bool_col:    运动#每次运动时间_not_applicable
```

Phase 2 `clean.py` reads this block and emits the derived boolean + nulls the original.
