# Protocol D — Missing values, outliers: proposal format

**Lazy-loaded by:** Phase 1 step 6.

For every issue surfaced by Protocol C or Protocol F, write **exactly one** proposal row. Don't list five options — pick the best and justify in one sentence.

## Format

```
Issue:      <column> has <count> <pattern> (<rate>)
Diagnosis:  <what the pattern really means>
Proposal:   <single concrete fix>
Code rule:  clean.py::<function_name>
Confidence: high | medium | low
```

## Confidence levels

- **high** — apply automatically in Phase 2, log in `preprocess_report.json`.
- **medium** — apply, but show the decision in the Phase 1 report for explicit review.
- **low** — do not apply; re-ask the user before Phase 2.

## Common patterns

- **Missingness > 50%** → propose drop column (medium) unless the missingness is informative per Protocol F (then keep + add missing-indicator column, high).
- **Single-value column** → propose drop (high).
- **Outliers within 1.5×IQR fence but inside domain limits** → keep, do not winsorize (high).
- **Outliers outside domain limits** → winsorize to domain bound + add `<col>_was_clipped` mask column (medium).
- **String-encoded numeric ranges** → parse to midpoint per Protocol B (high).
- **Sentinel dates / placeholder dates** → mask to null + add `<col>_was_sentinel` indicator (high).

Every proposal is cross-referenced from the generated `clean.py` function via docstring.
