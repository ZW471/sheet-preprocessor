# Protocol A — Reading large sheets without blowing up context

**Lazy-loaded by:** Phase 1 step 1 (inventory) and step 4 (diagnostics).

**Hard rule:** never paste sheet contents into your reply. Always drive a Python subprocess that returns summaries only.

---

## Step 1 — inventory (no row data)

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

**Permitted exception for sheet-kind detection.** To compute `rows / n_unique(entity_key)` for Phase 1 step 2, you MAY stream the single `entity_key` column without loading the rest of the sheet. Use openpyxl `iter_cols(min_col=k, max_col=k, values_only=True)` for xlsx, or `pl.scan_csv(path).select(entity_key).collect(streaming=True)` for csv. This is the only data access permitted in step 1.

## Step 2 — headers only

```python
# xlsx
ws     = wb[sheet]
header = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))

# csv
cols = pl.scan_csv(path).collect_schema().names()
```

**Header hygiene.** Before any classification:
- **De-duplicate** header cells that surface as blank or repeated (common when merged cells bleed across rows). Suffix with `#2`, `#3`, … and record the original span in a `header_dedup_log` written into the per-sheet analysis file.
- **Strip whitespace** and normalize fullwidth/halfwidth punctuation.
- **Detect title rows.** If row 1 looks like a descriptive title (single non-empty cell, or cells that don't match a tabular pattern), escalate to the user before renaming — **with one carve-out:** if the sheet has a single data column AND ≥99% of the values below row 1 match an id shape (UUID v4, or all values share a regex like `^\d{8,}$`), the worker MAY auto-rename to `<id_shape>_id` (e.g., `entity_id`) and record the rename in `header_dedup_log`.
- **In-band null tokens.** When computing `n_unique` and when classifying values, treat these tokens as null: `""`, `N/A`, `na`, `-`, `--`, and any dataset-specific placeholders (e.g., `unknown`, `none`, `missing`). The config schema allows a per-column `inband_null_tokens` override. Record per-column null-token counts in the per-sheet analysis so the Phase 2 cleaner can reproduce them.
- **Two-level `section#question` headers.** Columns like `section#measurement` or `meal#food_category` use `#` as a section namespace separator. Preserve them intact in `columns:`; config consumers may group by prefix. Do NOT split on `#`.

## Step 3 — streaming column stats with Polars lazy

For xlsx, convert a sheet to a `LazyFrame` via `pl.read_excel(..., sheet_name=s).lazy()` when the sheet fits comfortably in memory (≲2M cells). For larger sheets, dump the sheet to parquet **once** via openpyxl streaming, then `pl.scan_parquet` for all subsequent work:

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

**Cache reuse.** The `cache/<sheet>.parquet` files are reusable across re-runs. Always check for an existing cache before re-dumping. The cache directory should be sibling to `analysis/`.

## Rules

- Prefer `.collect(streaming=True)` on large frames.
- Never call `.to_pandas()` on a frame you haven't bounded.
- Never `print(df)` — print `df.head(5)` or `df.describe()` only.
- **Sheet indexing convention:** `<workbook_stem>::<sheet_name>`. Always include this prefix in reports and config so multi-file runs don't collide.
- **Datetime parsing:** openpyxl can return dates as raw strings on cached xlsx. After dumping to parquet, run `pl.col(c).str.to_date(strict=False)` on suspected datetime columns and check the success rate before classifying.
