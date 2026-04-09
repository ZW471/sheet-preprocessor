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

Derive IQR, outlier bounds (`q1 - 1.5*iqr`, `q3 + 1.5*iqr`), outlier count, and a few typical outlier values from the stats frame. Override with domain limits when obvious (ask the user for plausible physical ranges).

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

## Precision rule (CRITICAL)

Store continuous stats at **full float precision** in `analysis/<sheet>_stats.json`. The Markdown report may display 3 significant figures for readability, but downstream computations — especially outlier-bound fences — MUST use the unrounded values. Rounding Q1/Q3 before computing `q1 - 1.5*iqr` introduces false outliers; in one production run this caused a 62% inflation of outlier count on a height column.

Rule: **stats files are computed once and read for both display and downstream math.** Never recompute fences from rounded display values.

## Outlier entity list

For every continuous column with `outlier_count > 0`, write the affected entity ids (up to 250) into the per-sheet analysis as `outlier_entity_ids`. Use the sheet's id column. This list is the input for the human-in-the-loop review step and feeds the per-patient outlier roster downstream consumers may need.
