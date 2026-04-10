# Protocol J — Semi-structured data detection and mapping

**Lazy-loaded by:** Phase 1 step 3 (column classification) when a sheet has many columns following a naming pattern.

---

## Problem

Some sheets have 20+ columns whose names encode structured metadata — for example, a dietary intake sheet where columns are named `breakfast#grains#refined`, `breakfast#grains#whole`, `lunch#protein#meat`, etc. These columns may contain:
- Numeric values that look continuous but are actually ordinal scores (e.g., 0/1/2/3 servings)
- Free-text entries mixed with numbers
- Mostly-empty cells (sparse data)

Treating each column independently as `continuous` leads to misleading statistics (means of ordinal scores, outlier detection on 0-3 scales). Treating them as independent categoricals loses the hierarchical structure.

## Detection trigger

Activate this protocol when **all** of the following are true:

1. A sheet has **20+ columns** whose names share a common delimiter pattern (e.g., `#`, `_`, `/`, `.`)
2. **≥60%** of those columns match a regex like `^<prefix><delim><suffix>` with a small set of unique prefixes (≤10 prefixes covering ≥60% of columns)
3. The values across these columns have **low cardinality** (≤20 unique values per column on average)

### Detection logic

```python
import re
from collections import Counter

def detect_semi_structured(columns: list[str], delimiter: str = "#") -> dict | None:
    """Return pattern metadata if columns follow a semi-structured naming pattern."""
    parts = [col.split(delimiter) for col in columns if delimiter in col]
    if len(parts) < 20:
        return None

    prefixes = Counter(p[0] for p in parts)
    coverage = sum(prefixes.values()) / len(columns)
    if coverage < 0.6 or len(prefixes) > 10:
        return None

    return {
        "delimiter": delimiter,
        "n_structured_cols": len(parts),
        "coverage": coverage,
        "prefixes": dict(prefixes),
        "depth": max(len(p) for p in parts),
    }
```

Try common delimiters in order: `#`, `_`, `.`, `/`. Use the first that triggers.

## Classification strategy

Once semi-structured columns are detected, classify the **value space** (not just the column names):

### Step 1: Value profile

For each group of columns sharing a prefix, compute:

```python
profile = {
    "prefix": "<prefix>",
    "n_cols": 15,
    "value_dtype": "numeric",       # numeric | string | mixed
    "n_unique_range": [2, 8],       # min and max n_unique across columns in this group
    "value_range": [0, 5],          # min and max observed values (if numeric)
    "pct_zero_or_empty": 0.72,      # fraction of cells that are 0, empty, or null
    "all_integer": true,            # all non-null values are whole numbers
}
```

### Step 2: Interpretation decision tree

| Condition | Interpretation | Column type |
|---|---|---|
| `all_integer` AND `n_unique_range.max ≤ 5` AND `value_range` spans ≤ 10 | **Ordinal scale** (e.g., servings, frequency codes) | `ordered_categorical` |
| `all_integer` AND `n_unique_range.max ≤ 20` AND not evenly-spaced | **Nominal code** | `unordered_categorical` |
| Numeric AND `n_unique_range.max > 20` AND values span a wide range | **True measurement** (keep as continuous) | `continuous` |
| `value_dtype == "mixed"` (numbers + text in same column) | **Mixed** — needs user decision | Escalate |
| `pct_zero_or_empty > 0.9` across the group | **Sparse indicator** — consider binary encoding | `unordered_categorical` or binary |

### Step 3: Generate an issue for user confirmation

Always generate an `issues` entry (Protocol K) asking the user to confirm the interpretation. Example:

```yaml
issues:
  - id: semi_struct_001
    type: multichoice
    title: "Semi-structured column group: <prefix>"
    description: >
      Found <N> columns with prefix '<prefix>' (e.g., <prefix>#<suffix_1>,
      <prefix>#<suffix_2>, ...). Values are integers in range [0, 5] with
      <X>% zero/empty cells. How should these be interpreted?
    options:
      - label: "Ordinal scale (0=none, 1=small, 2=medium, ...)"
        description: "Treat as ordered_categorical; compute frequency stats, not means"
      - label: "True measurements (continuous)"
        description: "Keep as continuous; compute mean/std/outliers normally"
      - label: "Binary indicators (present/absent)"
        description: "Collapse to 0/1 boolean; the numeric value is not meaningful"
      - label: "Drop this group"
        description: "These columns are not useful for analysis"
    resolved: false
    user_response: null
```

## Config output: `value_mapping`

When the user confirms (or the agent makes a high-confidence determination), write a `value_mapping` block in the per-sheet `config.yaml`:

```yaml
semi_structured:
  delimiter: "#"
  groups:
    <prefix>:
      interpretation: ordered_categorical    # or continuous, binary, drop
      columns: [<prefix>#<suffix_1>, <prefix>#<suffix_2>, ...]
      value_mapping:                         # only for ordered_categorical
        0: "none"
        1: "small"
        2: "medium"
        3: "large"
      encoding: label                        # label | onehot | binary | none
      notes: "User confirmed as ordinal servings scale"
```

### Value mapping rules

- **If `ordered_categorical`:** provide a `value_mapping` dict that maps raw values to semantic labels. If the mapping is not known, leave it as `{0: "0", 1: "1", ...}` and add a note asking the user to supply labels.
- **If `continuous`:** no `value_mapping` needed. The columns proceed through normal Protocol C diagnostics.
- **If `binary`:** map to `{0: "absent", 1: "present"}` (or user-supplied labels). Encoding is `none` (already 0/1).
- **If `drop`:** mark `fix_rules: [drop_column]` on each column.

## Integration with Protocol C (diagnostics)

When semi-structured columns are classified as `ordered_categorical`:
- Do NOT compute continuous stats (mean, std, outlier fences) — these are meaningless for ordinal scales
- DO compute: `n`, `missing_count`, `missing_rate`, `n_unique`, `top_values`, `levels`
- Group-level summary stats: total non-zero entries per prefix, sparsity rate per prefix

When classified as `continuous`:
- Proceed with normal Protocol C diagnostics
- Consider whether outlier detection makes sense given the value range

## Sparse data handling

Semi-structured sheets often have very high sparsity (>80% zeros/empty). Report:

```yaml
semi_structured_summary:
  total_structured_cols: 45
  overall_sparsity: 0.82          # fraction of cells that are 0/empty/null
  groups:
    <prefix>:
      n_cols: 15
      sparsity: 0.78
      non_zero_row_rate: 0.45     # fraction of rows with at least one non-zero in this group
```

This helps the user decide whether to keep, aggregate, or drop sparse column groups.

## Aggregation proposals

For very wide semi-structured groups (>30 columns in one prefix), propose aggregation options in the `proposals` block:

```yaml
proposals:
  - column: "<prefix>#*"
    issue: "Wide semi-structured group with 45 columns"
    suggestions:
      - action: keep_all
        label: "Keep all columns individually"
      - action: aggregate_sum
        label: "Sum across suffixes per row (total intake per meal type)"
      - action: aggregate_count
        label: "Count non-zero entries per row"
      - action: aggregate_max
        label: "Max value across suffixes per row"
      - action: drop_sparse
        label: "Drop columns with >95% zeros"
    default_action: keep_all
    confidence: low
```

## Smoke test

After processing semi-structured columns:
1. Every column that was re-classified appears in the correct type group in `stats.json`
2. The `value_mapping` in `config.yaml` covers all observed values
3. If `ordered_categorical`, no continuous stats (mean/std/outlier fences) are emitted
4. An issue entry exists for each semi-structured group awaiting user confirmation
