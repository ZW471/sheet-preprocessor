# Protocol D — Fix proposals and outlier presentation

**Lazy-loaded by:** Phase 1 step 6.

For every issue surfaced by Protocol C or Protocol F, write **exactly one** proposal row. Proposals are **suggestions presented to the user via the review webapp** — the user decides what to do.

## Core principle: outliers are informational, not errors

Being outside 1.5×IQR does **NOT** mean a value is invalid. Age=78 in a weight-loss cohort is legitimate. A weight of 130 kg is not an error just because it's above the Tukey fence. **Never auto-decide** how to handle outliers — present them clearly and let the user choose via the webapp.

The only exception is **domain violations** (physically impossible values like height < 0 or heart rate > 100,000). These can be flagged as likely errors with `high` confidence, but the user still confirms.

## Proposal format (written to `<sheet>/config.yaml`)

```yaml
proposals:
  - column: <column_name>
    issue: "204 values outside Tukey fence [159.5, 180.5]"
    typical_values: [120.0, 155.0, 182.0, 190.0, 200.0]
    entity_count: 136
    diagnosis: "Wide age range in cohort; short and tall patients are legitimate"
    suggestions:
      - action: keep
        label: "Keep as-is (these are valid heights)"
      - action: clip_to_domain
        label: "Clip to domain [100, 250] + flag"
        params: { min: 100, max: 250 }
      - action: flag_only
        label: "Add _is_outlier column, keep original values"
      - action: custom
        label: "Enter your own rule"
    default_action: keep
    confidence: low
```

## Confidence levels

- **high** — likely a data error (domain violation, sentinel value, impossible magnitude). Still presented in the webapp for confirmation.
- **medium** — ambiguous; could be error or legitimate. User must decide.
- **low** — almost certainly legitimate data that happens to be statistically unusual. Default suggestion is "keep".

## Common patterns

- **Missingness > 50%** → propose drop column (medium) unless the missingness is informative per Protocol F (then keep + add missing-indicator column, high).
- **Single-value column** → propose drop (high).
- **Statistical outliers (outside Tukey fence, inside domain)** → present for user decision. Default: keep. Confidence: low.
- **Domain violations (outside physically possible range)** → `domain_clip(col, lo, hi, mask_col=<col>_was_clipped)`. Confidence: high. **Canonical rule name:** `clean.py::domain_clip`. All workers must use this exact name.
- **String-encoded numeric ranges** → parse to midpoint per Protocol B (high).
- **Sentinel dates / placeholder dates** → mask to null + add `<col>_was_sentinel` indicator (high).
- **Copy-paste runs** → mask trailing values + add `<col>_was_copypaste` indicator (medium). Use per-domain run length from Protocol F.
- **Discrete column with failing Tukey fence** → suppress outlier reporting entirely (see Protocol C).
- **Derived / redundant column** → escalate to user (low confidence).
- **Cohort-wide escalation** → write to `escalations:` block, do not propose per-column fix.

## User decisions via the webapp

When the user makes an outlier decision in the review webapp, the server writes an `outlier_decisions:` block into the per-sheet config.yaml:

```yaml
columns:
  <column_name>:
    type: continuous
    outlier_decisions:
      action: keep           # keep | clip_to_domain | clip_to_custom | flag_only | remove | custom
      custom_note: null      # freetext from user (only if action=custom)
      clip_bounds: null      # {min, max} only if action=clip_to_custom
      decided_at: "2026-04-10T14:30:00"
```

Phase 2 code generation reads `outlier_decisions` and only applies transformations the user explicitly approved. Columns without a decision are left unchanged (implicit "keep").

Every applied fix cites the proposal in its `clean.py` docstring.
