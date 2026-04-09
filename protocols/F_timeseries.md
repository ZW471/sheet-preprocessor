# Protocol F — Time series handling

**Lazy-loaded by:** Phase 1 step 5 and Phase 2 `timeseries.py`.

Time-series sheets are the most failure-prone part of this workflow.

## Sheet-kind rule

Treat any sheet where `row_count / n_unique(entity_id) ≥ 10` as `long_timeseries`. Also check that the sheet contains a datetime-typed column — a long sheet without a timestamp is probably a join / event log, not a time series.

**Borderline ratios `5 ≤ ratio < 10`** (e.g., 7.93): run the time-series diagnostics, but tag the kind as `long_timeseries_borderline` and surface the ratio in the per-sheet report. The user must confirm before Phase 2.

## Defaults (override in `config.yaml` under `domain_limits`)

```python
# Implausible per-day change thresholds — flag any value above as a copy-paste / data-entry error.
IMPLAUSIBLE_DELTA_DEFAULTS = {
    "weight_kg":      3.0,
    "sbp_mmhg":      40.0,
    "dbp_mmhg":      30.0,
    "glucose_mmol":   5.0,
    "waist_cm":       5.0,
    "hr_bpm":        40.0,
}

BUCKET_DAYS = 7         # weekly buckets for adherence-decay curves
COPY_PASTE_RUN_LEN = 3  # ≥3 consecutive identical values flagged as copy-paste
```

If the value column is not in the defaults dict, escalate to the user for the threshold instead of guessing.

## Diagnostics (Phase 1)

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

## Required findings in the per-sheet report

0. **Sentinel-date scrub.** Drop or mask rows where `year < 2000` or the date equals a known placeholder (`0001-01-01`, `1900-01-01`, `1970-01-01`). These inflate `span_days` for a handful of entities and destroy decay metrics. Log counts.
1. **Adherence distribution** (overall and by any user-specified subgroup). Use **11 buckets**: `0-10%, 10-20%, …, 90-100%, >100%`. The `>100%` bucket captures same-day multi-readings and must NOT be merged into `90-100%`.
2. **Missingness decay** — active entities vs time-since-start; does adherence fall off?
3. **Informative missingness** — does gap length correlate with the observed value? Compute the correlation **per-entity** (then summarize: median, IQR), not pooled. Pooled correlations are dominated by between-entity variance and miss the within-entity signal.
4. **Physiological / domain limits** — hard upper/lower bounds the user confirms.
5. **Change-rate limits** — per-entity `max_abs_delta`; flag values above the implausible-delta threshold for the value column.
6. **Duplicate / copy-paste** — runs of `≥ COPY_PASTE_RUN_LEN` identical consecutive values, or stretches where `delta == 0` over multiple weeks.
7. **Per-entity-constant columns** in a long sheet (e.g., age, sex inside a weight-log sheet) — promote to wide_snapshot fragment, do not tile across rows.

## Processing (Phase 2)

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

## Padding and masking rules

- Pad with `0.0` and mark masked positions with `False` — **never pad with `NaN`**.
- Persist the per-entity `first_date` / `baseline_event` in `meta["timeseries"][<sheet>]["anchor"]` so inference-time preprocessing can align new data identically.

## Smoke test

```python
ts = out["timeseries"][SHEET_NAME]
assert ts["values"].shape[0] == N
assert (ts["mask"].sum(dim=1) > 0).all()
assert torch.isfinite(ts["values"][ts["mask"]]).all()
```
