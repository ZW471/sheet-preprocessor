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
- **Outliers outside domain limits** → winsorize to domain bound + add `<col>_was_clipped` mask column (medium). **Canonical rule name (Round 2 M-6):** `clean.py::domain_clip(col, lo, hi, mask_col=<col>_was_clipped)`. All per-sheet workers must reference this exact function name in `fix_rules:` so the assembler generates a single shared implementation — no bespoke `clip_height` / `winsorize_waist_to_domain` variants.
- **String-encoded numeric ranges** → parse to midpoint per Protocol B (high).
- **Sentinel dates / placeholder dates** → mask to null + add `<col>_was_sentinel` indicator (high).
- **Copy-paste runs (`n_consecutive_equal >= COPY_PASTE_RUN_LEN`)** → mask the trailing values of each run (keep the head) + add `<col>_was_copypaste` indicator (medium). Use the per-domain run length from Protocol F's `COPY_PASTE_RUN_LEN_DEFAULTS`. For legitimately stable signals (weight), use length 7 not 3.
- **Discrete column with failing Tukey fence** → suppress outlier proposal entirely (see Protocol C). Propose only when `n_unique > 8 AND abs(skew) <= 5`.
- **Derived / redundant column** (e.g., BMI that can be recomputed from weight/height) → drop + recompute post-clean in a derived-features step (low confidence; escalate).
- **Cohort-wide escalation** (e.g., pediatric patients, post-surgery window) — do NOT propose a per-column fix. Write a single entry in `analysis/<sheet>_config.yaml → escalations:` and surface it in `summary.md` under "Cohort-wide escalations".

Every proposal is cross-referenced from the generated `clean.py` function via docstring.
