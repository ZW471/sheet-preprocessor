# Protocol C — Per-column diagnostics

**Lazy-loaded by:** Phase 1 step 4.

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

Derive IQR, outlier bounds (`q1 - 1.5*iqr`, `q3 + 1.5*iqr`), outlier count, and typical outlier values. These are **informational** — being outside the Tukey fence does NOT mean a value is invalid. The review webapp presents these stats to the user, who decides what (if anything) to do about them. Do NOT auto-propose outlier removal or clipping based solely on Tukey fences.

## Required stats per type

**Continuous** —
`N, missing_count, missing_rate, mean, median, std, min, Q1, Q3, max, IQR, skew, outlier_count, outlier_rate, outlier_lower, outlier_upper, typical_outliers(5), outlier_entity_ids (up to 250 ids keyed to the sheet's id column), proposed_fix`

**Categorical / ordered / unordered** —
`N, missing, cardinality, top_5_value_counts, rare_count(<1%), proposed_encoding`

**Multi-label** —
`N, missing, token_set_size, top_10_tokens_with_counts, avg_tokens_per_row, proposed_separator, proposed_encoding`

**Text** —
`N, missing, length_min / median / max, 5_samples, proposed_handling (keep raw / tokenize later / drop)`

**ID** —
`N, unique, duplicates, referential_integrity_vs_<parent_sheet>, proposed_role (primary_key / foreign_key / drop)`

**Datetime** —
`N, missing, min, max, future_dated_count, sentinel_date_count (year < 2000), gap_histogram, proposed_handling`

## Canonical `stats.json` output schema

Each per-sheet worker writes `analysis/<sheet>/stats.json`. The review webapp consumes this file and expects columns to be organized into **type groups** at the top level. This is the canonical format; all workers MUST target it.

```json
{
  "sheet": "<workbook>::<sheet_name>",
  "kind": "wide_snapshot | long_timeseries | ...",
  "rows": 5096,
  "entity_key": "<entity_key>",
  "time_key": null,

  "continuous": {
    "<col_name>": {
      "n": 5096,
      "missing_count": 0,
      "missing_rate": 0.0,
      "mean": 37.21,
      "median": 36.0,
      "std": 9.57,
      "min": 4.0,
      "max": 78.0,
      "Q1": 31.0,
      "Q3": 42.0,
      "IQR": 11.0,
      "skew": 0.545,
      "n_unique": 72,
      "units": "years",
      "domain_limits": { "min": 4, "max": 90 },
      "outlier_lower": 14.5,
      "outlier_upper": 58.5,
      "outlier_count": 204,
      "outlier_rate": 0.04,
      "outlier_entity_ids": ["uuid1", "..."],
      "tukey_suppressed": false,
      "tukey_note": null,
      "typical_outliers": [4.0, 5.0, 62.0, 70.0, 78.0],
      "domain_violation_entity_ids": []
    }
  },
  "ordered_categorical": { "<col>": { "n": ..., "missing_count": ..., ... } },
  "unordered_categorical": { "<col>": { ... } },
  "multi_label": { "<col>": { ... } },
  "datetime": { "<col>": { ... } },
  "id": { "<col>": { ... } },
  "text": { "<col>": { ... } }
}
```

### Field naming requirements

Use exactly these canonical field names. The webapp reads them directly:

| Canonical name | Meaning | Do NOT use |
|---|---|---|
| `Q1` | 25th percentile | `q1`, `q25` |
| `Q3` | 75th percentile | `q3`, `q75` |
| `IQR` | Q3 - Q1 | `iqr` |
| `missing_count` | number of nulls | `miss`, `missing` |
| `missing_rate` | missing_count / n | — |
| `n_unique` | distinct value count | `nunique` |
| `outlier_entity_ids` | up to 250 affected ids | `outlier_ids` |

### Backward compatibility note (Round 4)

Earlier runs produced several non-canonical structures (`continuous_stats`, `per_col_stats`, `columns` with per-column `type` field, `classifications`, `per_column`). The webapp server includes a `normalize_stats()` layer that converts these on the fly. New workers MUST use the canonical format above; the normalization layer exists only for pre-Round-4 data.

## Precision rule (CRITICAL)

Store continuous stats at **full float precision** in `analysis/<sheet>_stats.json`. The Markdown report may display 3 significant figures for readability, but downstream computations — especially outlier-bound fences — MUST use the unrounded values. Rounding Q1/Q3 before computing `q1 - 1.5*iqr` introduces false outliers; in one production run this caused a 62% inflation of outlier count on a height column.

Rule: **stats files are computed once and read for both display and downstream math.** Never recompute fences from rounded display values.

## Outlier entity list (MANDATORY)

For every continuous column with `outlier_count > 0`, write the affected entity ids (up to 250) into **both** the per-sheet `<sheet>_stats.json` AND the per-sheet `<sheet>_analysis.md` under a field named `outlier_entity_ids`. Use the sheet's declared id column. This list is the input for the human-in-the-loop review step and feeds any downstream per-entity outlier roster.

**Schema-level requirement.** `outlier_entity_ids` is NOT optional. A worker that emits `outlier_count > 0` on a continuous column without a corresponding `outlier_entity_ids` list FAILS Phase 1 validation.

## Tukey-fence suppression for discrete and highly-skewed distributions

IQR fences are meaningless on discrete-low-cardinality or extremely skewed data. Before reporting outliers on a continuous column:

```python
if n_unique <= 8 or abs(skew) > 5:
    # Tukey not applicable — do not emit outlier_count / fences.
    notes.append("discrete_or_skewed — Tukey N/A")
    outlier_count = None
```

Examples:
- A "target completion time" column has 4 unique integer values (3/6/12/24 months). Tukey fires on 1,149 rows that are not outliers.
- Highly right-skewed counts (skew > 5) put the Q3+1.5·IQR fence below the mode.

When suppressed, use domain limits (if provided) or escalate to the user for a clipping rule instead.

**Suppressed-column schema (Round 2 M-5 fix).** When Tukey is suppressed, you MUST still emit the `outlier_entity_ids` field (as explicit `null`) so downstream schema validation passes. If `domain_limits` is declared for the column, ALSO emit a sibling field `domain_violation_entity_ids: [...]` listing (up to 250) entity ids whose values fall outside `[min, max]`. Both fields coexist; neither replaces the other.

```json
"<col_name>": {
  "tukey_suppressed": true,
  "tukey_note": "skew=6.06 > 5 — Tukey N/A",
  "outlier_entity_ids": null,
  "domain_violation_entity_ids": ["<uuid>", "..."]
}
```
