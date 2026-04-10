# Protocol G — Relationship data (`analysis/relationships.json`)

**Lazy-loaded by:** Phase 1 step 8.

## When required (MANDATORY)

If the workbook has **≥3 sheets sharing at least one non-trivial join key**, you MUST emit `analysis/relationships.json`. This is not optional — the review webapp relies on it to render the relationships view. Skip ONLY for single-CSV inputs or workbooks with <3 sheets.

A "non-trivial" join key is any column shared across ≥2 sheets that is NOT a generic per-row constant like `gender` / `age` (those are demographic columns, not relational keys). Prefer keys whose name contains `id`, `_id`, `uuid`, `code`, or locale-specific id tokens, or that achieve ≥50% cross-sheet coverage.

## Output: `analysis/relationships.json`

```json
{
  "sheets": {
    "<sheet_name>": {
      "kind": "wide_snapshot",
      "n_rows": 5096,
      "n_unique": 5096,
      "entity_key": "<entity_key>",
      "time_key": null,
      "n_cols": 34,
      "keys": {
        "<entity_key>": { "role": "primary", "unique": true, "n_unique": 5096 }
      }
    }
  },
  "edges": [
    {
      "a": "demographics_sheet",
      "b": "measurements_sheet",
      "key": "<entity_key>",
      "intersection": 5096,
      "coverage": 1.0,
      "type": "1:N"
    }
  ],
  "join_keys": [
    { "key": "<entity_key>", "sheet_count": 12, "role": "primary" }
  ]
}
```

## Relationship type classification

Derive the relationship type from the sheet `kind`:

| Sheet A kind | Sheet B kind | Relationship |
|---|---|---|
| `wide_snapshot` or `id_list` | `wide_snapshot` or `id_list` | **1:1** |
| `wide_snapshot` or `id_list` | `long_timeseries` or `wide_snapshot_repeated` | **1:N** |
| `long_timeseries` or `wide_snapshot_repeated` | `long_timeseries` or `wide_snapshot_repeated` | **N:M** |
| `lookup_table` | any | **lookup** |

For composite keys (e.g., `(<entity_key>, <time_key>)` on `wide_snapshot_repeated` sheets), note the composite key in the sheet's `keys` block.

## Per-sheet key summary

Each sheet's entry in `relationships.json` MUST include a `keys` block listing every column that participates in a join, with:
- `role`: `primary` (unique identifier), `foreign` (references another sheet's primary), or `composite` (part of a multi-column key)
- `unique`: whether the key is unique per row in this sheet
- `n_unique`: count of distinct values

## Coverage formula

`coverage(A, B, key) = |A ∩ B| / min(|A.key.unique|, |B.key.unique|)`

This is a **containment ratio** (what fraction of the smaller key set is matched by the larger), NOT a Jaccard index. The webapp renders this formula prominently.

## Smoke test

After writing the file:
1. The file parses as valid JSON.
2. Every sheet in the workbook appears in `sheets`.
3. Every edge has `type` ∈ {`1:1`, `1:N`, `N:M`, `lookup`}.
4. Coverage values are in [0.0, 1.0].

If any check fails, regenerate before completing Phase 1.
