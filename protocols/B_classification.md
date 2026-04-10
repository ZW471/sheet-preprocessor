# Protocol B — Column type classification (unique-value first)

**Lazy-loaded by:** Phase 1 step 3.

The primary signal is **unique-value count**, cheap to compute via `pl.col(c).n_unique()` in a single lazy pass. Apply rules in order; first match wins. Show the full table to the user for confirmation before running expensive diagnostics.

Let `n = row_count`, `u = n_unique(col)`, `r = u / n` (uniqueness ratio).

## Header hygiene (pre-classification)

Apply these normalizations to the raw header list before running the rule table:

- **De-duplicate** header cells (see Protocol A — header hygiene).
- **Normalize string-encoded numeric ranges** in values before counting uniques: `"500~800"`, `"≥2500"`, `"100-200"` should be parsed to a midpoint plus a sentinel (`≥`/`≤` flag). Classify the resulting column as `continuous`; store the original string token in `notes: "range-normalized"` and persist the parser in `clean.py`.
- **Numeric values in a time/date-named column** with ≤20 unique integers are `continuous` (months / weeks counts), NOT `datetime`. The dtype check overrides the name-based rule: only classify as `datetime` if the values actually parse as dates with ≥90% success.
- **Person name columns**: when a column name matches a name token (`name`, `full_name`, `patient_name`, or locale-specific equivalents) AND values are short strings AND uniqueness is high, escalate to user — could be `id` (privacy), `text`, or a join key.
- **Score-named columns with high cardinality.** If the column name contains a score token (`score`, `rating`, `scale`, or locale-specific equivalents) AND `u > 20` AND the values are a dense integer sequence (no gaps > 1 in the observed range), override any `ordered_categorical` classification to `continuous`. Example: a diet score column has 34 integer values in 15–100 — it is continuous, not ordinal.
- **Mixed numeric + free-text columns.** If ≥90% of non-null tokens in a column parse as numeric (after range-string normalization), classify as `continuous` and null out the remaining text tokens. Record the per-token kept/nulled count in `notes`. Example: a supplement dosage sheet may have ~30 columns where `"500~800"`, `">300"`, and bare numbers coexist.
- **Low-cardinality numeric (8 ≤ u ≤ 20).** If values are evenly-spaced integers (sorted diffs all equal), classify as `ordered_categorical(low_res_numeric)`. Otherwise default to `continuous` and escalate. Run 1 hit this on supplement-dose columns.
- **In-band null tokens.** Before counting uniques, treat these as nulls: `""`, `N/A`, `na`, `-`, `--`, and any dataset-specific placeholders (e.g., `unknown`, `none`, `missing`). Users may add overrides via `inband_null_tokens:` in `config.yaml`. Store per-column null-token counts in `notes`.
- **Empty-string gated categories.** If a categorical column has an empty-string level whose rows correlate 1:1 with another gate column's "no"/"0" value (e.g., `activity#duration` = "" iff `activity#is_active` = "no"), split into a derived `_not_applicable` boolean + null out the empty strings.
- **Multi-label free-text tail collapse.** If a `multi_label` column has one token dominating (>95% of rows) AND remaining tokens all share a `<prefix>:<tail>` shape, collapse to a binary indicator + a side text column (`<col>_free_text`). Example: a medication column where 78 "tokens" are all `yes:<drug_name>` — collapse to a boolean + free-text side column.

## Rule table

| Rule | Classification |
|---|---|
| dtype is date/datetime, OR (column name matches a date-like token AND ≥90% of sampled values parse as dates) | `datetime` |
| Column name ends in an id-like token (`id`, `_id`, `uuid`, `code`, or locale-specific equivalents), OR `r ≥ 0.95` AND dtype is string AND avg length ≥ 8 | `id` |
| String dtype AND mean length > 30, OR values contain sentence punctuation | `text` |
| String dtype AND values contain a separator (`,` `;` `、` `/`) AND the split-out token set is small | `multi_label` |
| `u ≤ 20` AND column name hints order (`score`, `level`, `grade`, `stage`, `severity`, or locale-specific equivalents) | `ordered_categorical` |
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

## Prefer ordered_categorical over unordered_categorical

When a column has 2–15 unique values, check if they can be ordered before defaulting to `unordered_categorical`:

- **Semantically orderable** — frequency words (几乎不/偶尔/经常 = never/sometimes/often), severity (轻/中/重 = mild/moderate/severe), size (小/中/大 = small/medium/large), willingness (无所谓/一般/比较强烈/非常强烈), time spans (<15分钟, 15-30分钟, >30分钟), frequency (几乎没有运动, 平均1-2次/周, 平均3-5次/周, 几乎天天运动): classify as `ordered_categorical` and generate a `level_order` mapping in config.yaml.
- **Numerically orderable** — the values are numbers stored as strings (e.g., `"0"`, `"1"`, `"2"`, `"3"`): classify as `continuous` or `ordered_categorical` depending on context (see numeric-dominant rule below).

## Numeric-dominant columns are continuous

If **>70% of non-null values** in a column parse as numeric (int or float), classify as `continuous` even if some values are text. Text values should be handled as follows:

- **Range strings** like `"150-200"`, `"100~200"`, `"50-100"` → parse to midpoint (e.g., 175.0). Record in `notes: "range-normalized"`.
- **Non-numeric strings** (e.g., `"根据说明书"`, `"自行购买"`, `"适量"`) → treat as missing/outlier. Flag in an issue entry describing the non-numeric tokens and their counts.
- **Numeric-with-unit strings** (e.g., `"200g"`, `"250ml"`, `"200克"`) → strip the unit suffix, parse the number. Record the unit in `notes`.
- **Dash/sentinel strings** (`"-"`, `"—"`, `""`) → treat as null (in-band null tokens).

The 70% threshold is computed on actual row values (not unique values). This rule takes priority over the `u ≤ 20` categorical rules in the rule table.

## Generate ordinal mappings for ordered_categorical

For any `ordered_categorical` column, the `config.yaml` MUST include a `level_order` mapping that encodes the semantic ordering as integers:

```yaml
columns:
  <col_name>:
    type: ordered_categorical
    level_order:
      几乎不: 1
      偶尔: 2
      经常: 3
    levels: [几乎不, 偶尔, 经常]
    encoding: label
```

The `level_order` dict maps each category value to its ordinal position (1-indexed). The `levels` array lists the values in ascending order. Both MUST be present and consistent.

Common Chinese ordinal patterns to recognize:
- 几乎不/偶尔/经常 (frequency: almost never / occasionally / often)
- 无所谓/一般/比较强烈/非常强烈 (intensity: indifferent / moderate / fairly strong / very strong)
- 没概念/有限了解/清楚 (awareness: no concept / limited understanding / clear)
- 未曾尝试/经常减重/反复反弹 (experience: never tried / frequent dieting / repeated rebound)
- 清淡/一般/重口味 (taste preference: light / moderate / heavy)
- <15分钟/15-30分钟/>30分钟 (duration: <15min / 15-30min / >30min)
- 几乎不/1-4次/周/5-9次/周/>10次/周 (frequency: almost never / 1-4/wk / 5-9/wk / >10/wk)

## Minimize unordered_categorical and text

`unordered_categorical` should ONLY be used when:
- Values are genuinely unordered (e.g., blood types A/B/AB/O, country names, gender 男/女, marital status)
- Values cannot be meaningfully ordered either semantically or numerically

`text` should ONLY be used for true free-text fields with high cardinality (>50 unique values with no numeric pattern). Before classifying as `text`, always check the numeric-dominant rule — many columns classified as `text` due to high cardinality are actually numeric-dominant (e.g., dosage columns with many numeric values plus a few text outliers).

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
