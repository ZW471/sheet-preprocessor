# Protocol I — Output Formatter (canonical schemas for webapp consumption)

**Lazy-loaded by:** Phase 1 step 7 (writing analysis outputs) and any validation pass.

This protocol defines the **canonical JSON/YAML schemas** that the review webapp expects. All per-sheet workers MUST produce outputs conforming to these schemas. The webapp reads these files directly — non-conforming output will cause render failures or silent data loss.

---

## 1. `stats.json` — per-sheet statistics

**Path:** `analysis/<sheet_name>/stats.json`

### Top-level keys

| Key | Type | Required | Description |
|---|---|---|---|
| `sheet` | string | yes | `<workbook_stem>::<sheet_name>` |
| `kind` | string | yes | One of: `wide_snapshot`, `long_timeseries`, `long_timeseries_borderline`, `wide_snapshot_repeated`, `lookup_table`, `id_list` |
| `rows` | integer | yes | Total row count |
| `entity_key` | string | yes | Name of the primary key / entity identifier column |
| `time_key` | string or null | yes | Name of the time column (null for non-timeseries sheets) |

### Type-grouped columns

Columns MUST be organized into type groups at the top level. Each group is a dict keyed by column name:

```json
{
  "sheet": "<workbook>::<sheet_name>",
  "kind": "wide_snapshot",
  "rows": 5096,
  "entity_key": "<entity_key>",
  "time_key": null,
  "continuous": { ... },
  "ordered_categorical": { ... },
  "unordered_categorical": { ... },
  "multi_label": { ... },
  "datetime": { ... },
  "id": { ... },
  "text": { ... }
}
```

### Continuous column schema

Every column in the `continuous` group MUST have these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `n` | integer | yes | Non-null count |
| `missing_count` | integer | yes | Null count |
| `missing_rate` | float | yes | `missing_count / (n + missing_count)` |
| `mean` | float | yes | Arithmetic mean |
| `median` | float | yes | 50th percentile |
| `std` | float | yes | Standard deviation |
| `min` | float | yes | Minimum value |
| `max` | float | yes | Maximum value |
| `Q1` | float | yes | 25th percentile |
| `Q3` | float | yes | 75th percentile |
| `IQR` | float | yes | `Q3 - Q1` |
| `skew` | float | yes | Skewness |
| `n_unique` | integer | yes | Distinct value count |
| `outlier_count` | integer or null | yes | Count outside Tukey fence (null if suppressed) |
| `outlier_rate` | float or null | yes | `outlier_count / n` (null if suppressed) |
| `outlier_lower` | float or null | yes | `Q1 - 1.5 * IQR` (null if suppressed) |
| `outlier_upper` | float or null | yes | `Q3 + 1.5 * IQR` (null if suppressed) |
| `outlier_entity_ids` | array or null | yes | Up to 250 entity IDs outside fence (null if suppressed) |
| `typical_outliers` | array | no | Up to 5 representative outlier values |
| `units` | string | no | Measurement unit (e.g., `"kg"`, `"mmHg"`) |
| `domain_limits` | object | no | `{ "min": <float>, "max": <float> }` |
| `tukey_suppressed` | boolean | no | True if Tukey fence is suppressed (discrete/skewed) |
| `tukey_note` | string or null | no | Reason for suppression |
| `domain_violation_entity_ids` | array | no | IDs outside domain limits (up to 250) |

### Categorical column schema (ordered and unordered)

| Field | Type | Required | Description |
|---|---|---|---|
| `n` | integer | yes | Non-null count |
| `missing_count` | integer | yes | Null count |
| `missing_rate` | float | yes | `missing_count / (n + missing_count)` |
| `n_unique` | integer | yes | Cardinality (distinct value count) |
| `top_values` | object | yes | Dict of `value -> count` for the most frequent values |
| `rare_count` | integer | no | Count of values appearing in <1% of rows |
| `proposed_encoding` | string | no | `label`, `onehot`, or `none` |

For `ordered_categorical`, additionally:

| Field | Type | Required | Description |
|---|---|---|---|
| `levels` | array | yes | Ordered list of category levels |

### Multi-label column schema

| Field | Type | Required | Description |
|---|---|---|---|
| `n` | integer | yes | Non-null count |
| `missing_count` | integer | yes | Null count |
| `missing_rate` | float | yes | `missing_count / (n + missing_count)` |
| `token_set_size` | integer | yes | Total distinct tokens across all rows |
| `avg_tokens_per_row` | float | yes | Mean number of tokens per non-null row |
| `separator` | string | yes | Detected or declared separator (e.g., `,`, `;`, `/`) |
| `top_tokens` | object | yes | Dict of `token -> count` for the most frequent tokens |
| `proposed_encoding` | string | no | Typically `multihot` |

### Datetime column schema

| Field | Type | Required | Description |
|---|---|---|---|
| `n` | integer | yes | Non-null count |
| `missing_count` | integer | yes | Null count |
| `missing_rate` | float | yes | `missing_count / (n + missing_count)` |
| `min` | string | yes | Earliest date (ISO 8601) |
| `max` | string | yes | Latest date (ISO 8601) |
| `future_dated_count` | integer | yes | Rows with dates beyond today |
| `sentinel_date_count` | integer | yes | Rows with dates before year 2000 |
| `gap_histogram` | object | no | Distribution of gaps between consecutive dates |
| `proposed_handling` | string | no | `keep`, `days_since_baseline`, etc. |

### ID column schema

| Field | Type | Required | Description |
|---|---|---|---|
| `n` | integer | yes | Non-null count |
| `n_unique` | integer | yes | Distinct ID count |
| `duplicates` | integer | yes | `n - n_unique` |
| `proposed_role` | string | no | `primary_key`, `foreign_key`, or `drop` |

### Text column schema

| Field | Type | Required | Description |
|---|---|---|---|
| `n` | integer | yes | Non-null count |
| `missing_count` | integer | yes | Null count |
| `missing_rate` | float | yes | `missing_count / (n + missing_count)` |
| `length_min` | integer | yes | Shortest text length |
| `length_median` | float | yes | Median text length |
| `length_max` | integer | yes | Longest text length |
| `samples` | array | no | Up to 5 sample values |
| `proposed_handling` | string | no | `keep_raw`, `tokenize_later`, `drop` |

### Field naming requirements

Use exactly these canonical names. The webapp reads them directly:

| Canonical name | Do NOT use |
|---|---|
| `Q1` | `q1`, `q25`, `p25` |
| `Q3` | `q3`, `q75`, `p75` |
| `IQR` | `iqr` |
| `missing_count` | `miss`, `missing`, `null_count` |
| `missing_rate` | `miss_rate`, `null_rate` |
| `n_unique` | `nunique`, `cardinality` (use `n_unique` everywhere) |
| `outlier_entity_ids` | `outlier_ids` |
| `top_values` | `value_counts`, `top_5`, `freq` |

---

## 2. `config.yaml` — per-sheet configuration

**Path:** `analysis/<sheet_name>/config.yaml`

Each per-sheet worker writes a fragment containing just the sheet subtree. The assembler merges these into `analysis/config.draft.yaml`.

### Required structure

```yaml
kind: wide_snapshot          # sheet kind
entity_key: <entity_key>     # primary key column
time_key: null               # or column name for timeseries
n_rows: 5096
n_cols: 34

columns:
  <column_name>:
    type: continuous          # continuous | ordered_categorical | unordered_categorical | multi_label | text | id | datetime
    encoding: none            # label | onehot | multihot | none
    units: "kg"               # optional
    domain_limits:            # optional
      min: 0
      max: 300
    levels: [...]             # for ordered_categorical
    separator: ","            # for multi_label
    fix_rules: [rule_id]      # references clean.py functions
    notes: "..."              # free-text notes

escalations:
  - protocol: C
    column: <column_name>
    issue: "description of the issue"
    proposal: "suggested resolution"
    user_confirmed: false

proposals:
  - column: <column_name>
    issue: "description"
    suggestions:
      - action: keep
        label: "Keep as-is"
      - action: clip_to_domain
        label: "Clip to domain limits"
        params: { min: 0, max: 300 }
    default_action: keep
    confidence: low

issues:                       # See Protocol K for full schema
  - id: issue_001
    type: multichoice
    title: "Column interpretation"
    description: "..."
    options: [...]
    resolved: false
    user_response: null
```

---

## 3. `relationships.json` — cross-sheet join graph

**Path:** `analysis/relationships.json`

```json
{
  "join_keys": [
    {
      "key": "<entity_key>",
      "sheet_count": 12,
      "role": "primary"
    }
  ],
  "sheets": {
    "<sheet_name>": {
      "kind": "wide_snapshot",
      "n_rows": 5096,
      "n_unique": 5096,
      "entity_key": "<entity_key>",
      "time_key": null,
      "n_cols": 34,
      "keys": {
        "<entity_key>": {
          "role": "primary",
          "unique": true,
          "n_unique": 5096
        }
      }
    }
  },
  "edges": [
    {
      "a": "<sheet_A>",
      "b": "<sheet_B>",
      "key": "<entity_key>",
      "intersection": 5096,
      "coverage": 1.0,
      "type": "1:N"
    }
  ]
}
```

### Per-sheet key fields

| Field | Type | Required | Description |
|---|---|---|---|
| `entity_key` | string | yes | Primary key column name |
| `role` | string | yes | `primary`, `foreign`, or `composite` |
| `unique` | boolean | yes | Whether key is unique per row |
| `n_unique` | integer | yes | Distinct key values |

### Per-edge fields

| Field | Type | Required | Description |
|---|---|---|---|
| `a` | string | yes | First sheet name |
| `b` | string | yes | Second sheet name |
| `key` | string | yes | Join key column |
| `intersection` | integer | yes | Count of shared key values |
| `coverage` | float | yes | Containment ratio: `|A intersect B| / min(|A.unique|, |B.unique|)` |
| `type` | string | yes | One of: `1:1`, `1:N`, `N:M`, `lookup` |

---

## 4. `manifest.json` — workbook-level index

**Path:** `analysis/manifest.json`

The webapp loads this first as an entry point.

```json
{
  "version": 1,
  "source_file": "<path_to_workbook>",
  "generated": "2026-04-10T03:02:00",
  "sheets": [
    {
      "sheet": "<sheet_name>",
      "kind": "wide_snapshot",
      "entity_key": "<entity_key>",
      "time_key": null,
      "n_rows": 5096,
      "n_unique": 5096,
      "n_cols": 34,
      "outlier_groups_pending": 12,
      "escalations_pending": 3,
      "issues_pending": 2
    }
  ],
  "join_keys": [
    {
      "key": "<entity_key>",
      "sheets": ["Sheet_A", "Sheet_B"],
      "coverage_min": 0.95
    }
  ],
  "escalation_count": 43,
  "outlier_groups_pending": 28,
  "issues_pending": 5
}
```

### Per-sheet manifest fields

| Field | Type | Required | Description |
|---|---|---|---|
| `sheet` | string | yes | Sheet name |
| `kind` | string | yes | Sheet kind classification |
| `entity_key` | string | yes | Primary key column |
| `time_key` | string or null | yes | Time column (null if not timeseries) |
| `n_rows` | integer | yes | Row count |
| `n_unique` | integer | yes | Unique entity count |
| `n_cols` | integer | yes | Column count |
| `outlier_groups_pending` | integer | yes | Continuous columns with unreviewed outliers |
| `escalations_pending` | integer | yes | Escalations awaiting user confirmation |
| `issues_pending` | integer | yes | Issues awaiting user response |

### Top-level manifest fields

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | integer | yes | Schema version (currently 1) |
| `source_file` | string | yes | Path to the source workbook |
| `generated` | string | yes | ISO 8601 timestamp |
| `sheets` | array | yes | Per-sheet summaries |
| `join_keys` | array | yes | Cross-sheet join key summaries |
| `escalation_count` | integer | yes | Total unconfirmed escalations |
| `outlier_groups_pending` | integer | yes | Total unreviewed outlier groups |
| `issues_pending` | integer | yes | Total unresolved issues |

---

## Validation checklist

Before completing Phase 1, verify that every output file passes these checks:

1. **stats.json** — parses as valid JSON; every column appears in exactly one type group; all required fields present for each type; `Q1`/`Q3`/`IQR` naming (not `q25`/`q75`); `outlier_entity_ids` present (even if null) for every continuous column with `outlier_count > 0`.
2. **config.yaml** — parses as valid YAML; `entity_key` appears in `columns`; `kind` is a recognized value; `escalations` and `proposals` arrays present (may be empty).
3. **relationships.json** — parses as valid JSON; every sheet in the workbook appears in `sheets`; every edge has `type` in {`1:1`, `1:N`, `N:M`, `lookup`}; coverage values in [0.0, 1.0].
4. **manifest.json** — parses as valid JSON; every sheet has all required fields; `version` >= 1; `generated` is a valid ISO 8601 timestamp.

## Backward compatibility

Earlier runs may have produced non-canonical structures (e.g., `continuous_stats`, `per_col_stats`, `columns` with inline `type` fields). The webapp includes a `normalize_stats()` layer that converts these on the fly. New workers MUST use the canonical formats defined above; the normalization layer exists only as a safety net for legacy data.
