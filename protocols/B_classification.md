# Protocol B — Column type classification (unique-value first)

**Lazy-loaded by:** Phase 1 step 3.

The primary signal is **unique-value count**, cheap to compute via `pl.col(c).n_unique()` in a single lazy pass. Apply rules in order; first match wins. Show the full table to the user for confirmation before running expensive diagnostics.

Let `n = row_count`, `u = n_unique(col)`, `r = u / n` (uniqueness ratio).

## Header hygiene (pre-classification)

Apply these normalizations to the raw header list before running the rule table:

- **De-duplicate** header cells (see Protocol A — header hygiene).
- **Normalize string-encoded numeric ranges** in values before counting uniques: `"500~800"`, `"≥2500"`, `"100-200"` should be parsed to a midpoint plus a sentinel (`≥`/`≤` flag). Classify the resulting column as `continuous`; store the original string token in `notes: "range-normalized"` and persist the parser in `clean.py`.
- **Numeric values in a `时间` / `time` / `date` -named column** with ≤20 unique integers are `continuous` (months / weeks counts), NOT `datetime`. The dtype check overrides the name-based rule: only classify as `datetime` if the values actually parse as dates with ≥90% success.
- **Patient name / 姓名 columns**: when a column name matches a name token (`name`, `姓名`, `名字`, `full_name`, …) AND values are short strings AND uniqueness is high, escalate to user — could be `id` (privacy), `text`, or a join key.
- **Score-named columns with high cardinality.** If the column name contains a score token (`score`, `评分`, `rating`, `scale`) AND `u > 20` AND the values are a dense integer sequence (no gaps > 1 in the observed range), override any `ordered_categorical` classification to `continuous`. Example: 饮食评分 has 34 integer values in 15–100 — it is continuous, not ordinal.
- **Mixed numeric + free-text columns.** If ≥90% of non-null tokens in a column parse as numeric (after range-string normalization), classify as `continuous` and null out the remaining text tokens. Record the per-token kept/nulled count in `notes`. Example: 高蛋白 has ~30 columns where `"500~800"`, `"大于300"`, and bare numbers coexist.
- **Low-cardinality numeric (8 ≤ u ≤ 20).** If values are evenly-spaced integers (sorted diffs all equal), classify as `ordered_categorical(low_res_numeric)`. Otherwise default to `continuous` and escalate. Run 1 hit this on supplement-dose columns.
- **In-band null tokens.** Before counting uniques, treat these as nulls: `""`, `N/A`, `na`, `-`, `--`, `无`, `未知`, `记不清`, `不详`. Users may add overrides via `inband_null_tokens:` in `config.yaml`. Store per-column null-token counts in `notes`.
- **Empty-string gated categories.** If a categorical column has an empty-string level whose rows correlate 1:1 with another gate column's "no"/"0" value (e.g., `运动#每次运动时间` = "" iff `运动#是否运动` = "无"), split into a derived `_not_applicable` boolean + null out the empty strings.
- **Multi-label free-text tail collapse.** If a `multi_label` column has one token dominating (>95% of rows) AND remaining tokens all share a `<prefix>:<tail>` shape, collapse to a binary indicator + a side text column (`<col>_free_text`). Run 1 hit this on `疾病#目前有无服用减肥药物？` (78 "tokens" that were all `有:<drug name>`).

## Rule table

| Rule | Classification |
|---|---|
| dtype is date/datetime, OR (column name matches a date-like token AND ≥90% of sampled values parse as dates) | `datetime` |
| Column name ends in an id-like token (`id`, `_id`, `uuid`, `编号`, …), OR `r ≥ 0.95` AND dtype is string AND avg length ≥ 8 | `id` |
| String dtype AND mean length > 30, OR values contain sentence punctuation | `text` |
| String dtype AND values contain a separator (`,` `;` `、` `/`) AND the split-out token set is small | `multi_label` |
| `u ≤ 20` AND column name hints order (`score`, `level`, `grade`, `stage`, `severity`, `评分`, `等级`, `级别`, `程度`, …) | `ordered_categorical` |
| `u ≤ 20` AND no ordering hint | `unordered_categorical` *(escalate — could be nominal or ordinal without the hint)* |
| `u > 20` AND `u ≤ 50` AND string dtype | `unordered_categorical` |
| Numeric dtype AND `u > 50` | `continuous` |
| Numeric dtype AND `20 < u ≤ 50` | **escalate** — could be a binned scale or a low-resolution continuous variable |
| Fallback | `text` *(escalate)* |

**Why unique-value first:** cheap to compute in one pass, dtype-agnostic (catches numeric-encoded categoricals like `1=low, 2=mid, 3=high`), and directly informs the encoder choice later. Dtype is only a tiebreaker.

## Threshold tuning by sheet size

The fixed cutoffs above (20, 50, 0.95) are defaults for sheets with `n ≥ 1000`.
- Small sheets (`n < 1000`): use `u ≤ 0.02 * n` as the categorical cutoff (floor 5).
- Very large sheets (`n > 10^6`): raise the "continuous" cutoff to `u > 200` so low-resolution sensor readouts are not misread as continuous.

## Always escalate to the user

- Integer columns with 3–20 unique values (ordinal scale vs nominal code vs low-res continuous)
- Small-integer-range columns that are physically continuous (bounded counts, rounded measurements)
- Free-text fields that collapse to a category after normalization
- Multi-label columns — must become `multi_label`, not `unordered_categorical`
- Per-entity-constant columns inside a `long_timeseries` sheet (e.g., age, sex) — should be **promoted to a wide_snapshot fragment** and joined back rather than tiled across rows.

## Config record

Record the final classification in `analysis/<sheet>_config.yaml`:
```yaml
columns:
  <col_name>:
    type: continuous | ordered_categorical | unordered_categorical | multi_label | text | id | datetime
    encoding: label | onehot | multihot | none
    levels: [...]          # for ordered_categorical
    separator: ","         # for multi_label
    notes: "…"
```
