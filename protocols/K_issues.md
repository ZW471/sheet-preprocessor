# Protocol K — Issues (agent uncertainties requiring user input)

**Lazy-loaded by:** Phase 1 steps 3–7 whenever the agent encounters an ambiguity it cannot resolve confidently.

---

## Issues vs. Escalations

These are distinct concepts — do not conflate them:

| | **Escalations** | **Issues** |
|---|---|---|
| **Purpose** | Agent found something technically problematic and has a specific fix proposal | Agent is uncertain and needs user input to proceed |
| **Agent confidence** | Medium to high — the agent knows what's wrong | Low — the agent doesn't know the right interpretation |
| **User action** | Confirm or reject a proposed fix | Answer a question or pick from options |
| **Location in config** | `escalations:` array | `issues:` array |
| **Examples** | "204 values outside Tukey fence — propose clip to domain" | "Is this column a patient ID or a visit ID?" |

Both escalations and issues appear in the review webapp. The Issues view is a separate tab that surfaces all unresolved questions.

---

## Issue types

### `question` — free-text answer expected

The agent asks an open-ended question. The user types a response.

```yaml
- id: issue_001
  type: question
  title: "Entity key ambiguity"
  description: >
    This sheet has two columns that could be the entity key:
    'subject_id' (5096 unique values) and 'visit_id' (12480 unique values).
    Which one identifies the primary entity for this sheet?
  resolved: false
  user_response: null
```

### `multichoice` — user picks from agent-provided options

The agent presents a set of interpretations. The user selects one.

```yaml
- id: issue_002
  type: multichoice
  title: "Column interpretation"
  description: >
    Column 'severity_score' has 15 unique integer values (1-15).
    How should this be treated?
  options:
    - label: "A continuous measurement"
      description: "Keep as numeric, compute mean/std/outliers"
    - label: "An ordinal category"
      description: "Treat as ordered_categorical with 15 levels"
    - label: "An identifier"
      description: "Treat as ID column, do not compute stats"
  resolved: false
  user_response: null
```

### `info` — informational, no response needed

The agent shares an observation that doesn't require action. These are "FYI" notes.

```yaml
- id: issue_003
  type: info
  title: "Constant column detected"
  description: >
    Column 'study_site' has the same value ('Site_A') in all 5096 rows.
    It will be excluded from analysis but preserved in config for documentation.
  resolved: true
  user_response: null
```

Info issues are auto-resolved (they don't block Phase 2).

---

## Schema

Issues are written to `config.yaml` under the `issues:` key at the sheet level.

```yaml
issues:
  - id: <string>              # unique within the sheet, e.g., "issue_001", "semi_struct_001"
    type: <string>            # "question" | "multichoice" | "info"
    title: <string>           # short title for display in the webapp
    description: <string>     # detailed explanation with relevant data
    options:                  # REQUIRED for multichoice, OMIT for question/info
      - label: <string>       # short option label
        description: <string> # explanation of what this choice means
    resolved: <boolean>       # false until user responds (info issues are auto-true)
    user_response: <any>      # null until resolved; string for question, label string for multichoice
```

### Field details

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier within the sheet. Convention: `issue_NNN` or `<protocol>_NNN` (e.g., `semi_struct_001`, `classify_003`) |
| `type` | string | yes | One of: `question`, `multichoice`, `info` |
| `title` | string | yes | Short display title (≤80 chars) |
| `description` | string | yes | Full explanation. Include relevant data: column names, value counts, examples. Use YAML block scalar (`>`) for multi-line |
| `options` | array | multichoice only | List of option objects. Each has `label` (string) and `description` (string) |
| `resolved` | boolean | yes | `false` for `question`/`multichoice` until user responds; `true` for `info` |
| `user_response` | any or null | yes | `null` until resolved. For `question`: free-text string. For `multichoice`: the selected `label` string. For `info`: always `null` |

---

## When to create issues

Create an issue whenever the agent encounters any of these situations:

### Column classification ambiguity (Protocol B)
- Integer column with 3–20 unique values — ordinal vs nominal vs low-res continuous?
- Column name doesn't clearly indicate type (e.g., `code_1` — is it an ID or a category?)
- Mixed-type column — mostly numeric but some text entries

### Entity key ambiguity
- Multiple columns could serve as the entity key
- The entity key has duplicates — is this a repeated-measures sheet or a data error?

### Sheet kind ambiguity
- Ratio of rows/unique entities is in the borderline range (5–10)
- Sheet could be either `wide_snapshot_repeated` or `long_timeseries`

### Semi-structured data (Protocol J)
- Detected a naming pattern but unsure about the value interpretation
- High-sparsity column groups — keep or drop?

### Domain knowledge gaps
- No domain limits available for a continuous column — should the agent use a wide default or ask?
- Time series with no clear cadence — daily? weekly? event-driven?
- Columns that might be derived/computed from other columns

### Data quality observations
- Suspiciously round numbers (all multiples of 5 or 10)
- Values that look like they were copy-pasted from a different format
- Encoding ambiguity (e.g., 0/1 that might be boolean or a count)

## When NOT to create issues

**Never ask about column names.** Column names are provided by the data source and are not ambiguous — use them as-is. Do not create issues asking "What does column X mean?" or "Should we rename column Y?" Column naming is not the agent's concern.

**Never ask about things you can determine from the data.** If a column's type can be inferred from its values (e.g., >70% numeric → continuous per Protocol B), classify it and move on. Only create an issue if the data is genuinely ambiguous after applying all classification rules.

**Never create trivial issues.** Issues like "Should we process this column?" or "Is this data important?" waste the user's time. Only flag things that require domain expertise to resolve.

---

## Issue lifecycle

```
1. Agent creates issue (resolved: false, user_response: null)
     |
2. Webapp displays issue in the Issues tab
     |
3. User responds:
   - question  -> types free text -> user_response = "<text>"
   - multichoice -> selects option -> user_response = "<label>"
   - info -> no action needed (already resolved: true)
     |
4. Webapp writes response back to config.yaml
     |
5. Agent re-reads config.yaml and applies the decision
```

### Blocking behavior

- **`question` and `multichoice` issues with `resolved: false`** block Phase 2 code generation. The agent must not proceed until all non-info issues are resolved.
- **`info` issues** never block.
- The webapp displays a count of unresolved issues in the manifest and per-sheet headers.

---

## ID conventions

Issue IDs should be descriptive and scoped:

| Source | ID pattern | Example |
|---|---|---|
| Column classification | `classify_NNN` | `classify_001` |
| Entity key | `entity_key_NNN` | `entity_key_001` |
| Sheet kind | `sheet_kind_NNN` | `sheet_kind_001` |
| Semi-structured (Protocol J) | `semi_struct_NNN` | `semi_struct_001` |
| Time series (Protocol F) | `timeseries_NNN` | `timeseries_001` |
| Domain knowledge | `domain_NNN` | `domain_001` |
| Data quality | `quality_NNN` | `quality_001` |
| General | `issue_NNN` | `issue_001` |

IDs must be unique within a sheet. They do not need to be globally unique across sheets.

---

## Integration with manifest.json

The assembler counts unresolved issues per sheet and writes them to the manifest:

```json
{
  "sheets": [
    {
      "sheet": "<sheet_name>",
      "issues_pending": 3
    }
  ],
  "issues_pending": 12
}
```

The webapp uses `issues_pending` to show a badge/count in the sheet list and overall summary.

---

## Smoke test

After writing issues:
1. Every issue has all required fields (`id`, `type`, `title`, `description`, `resolved`, `user_response`)
2. Every `multichoice` issue has a non-empty `options` array
3. Every `question`/`multichoice` issue has `resolved: false` and `user_response: null`
4. Every `info` issue has `resolved: true`
5. Issue IDs are unique within each sheet's `config.yaml`
6. `issues_pending` in `manifest.json` matches the count of `resolved: false` issues across all sheets
