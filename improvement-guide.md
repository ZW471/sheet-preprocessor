# Improvement Guide

How to refine `SheetPreprocessor.md` and the `protocols/` files across iterations. Update this file whenever a new lesson surfaces.

## Goals

1. **Generic.** Every rule in `SheetPreprocessor.md` and `protocols/` must apply to *any* spreadsheet, not just the example workbook. If a rule starts to look domain-specific (e.g. "weight in kg"), move it into a default-with-override pattern (a default value the user can replace via `config.yaml`).
2. **Lazy-loaded.** `SheetPreprocessor.md` is an index. Readers should never need more than the index plus the protocol(s) for the current step. Watch the index for protocol files that have grown too large or interdependent — split them.
3. **Cite the trigger.** Every protocol file starts with a "Lazy-loaded by" line that names the workflow step that pulls it in. Keep this honest.
4. **Reproduce reference, then fail safely.** Each iteration must close the gap between worker output and the reference sheets in `runs/N/evaluation/`. Where the spec is genuinely under-determined, pick a default AND surface it for the user.

## How to run an iteration

1. **Read `runs/<latest>/evaluation/performance_report.md`** — that's the canonical bug list.
2. **Read every per-sheet `*_analysis.md`** that the report flags. Look for: missing fields, obvious miscomputations, ambiguous classifications, undocumented choices.
3. **For each issue**, decide one of:
   - **Spec gap** — fix `SheetPreprocessor.md` or a protocol file. Reference the issue in `log.md`.
   - **Worker bug not caused by spec** — note in `log.md` and add an explicit guard in the relevant protocol so the next worker can't reproduce it.
   - **Out of scope** — record in `log.md` and skip.
4. **Update `log.md`** with the round number, files changed, why.
5. **Run the next round**:
   - Inventory + per-sheet analysis: dispatch one Opus subagent per sheet, in parallel. Each must read `SheetPreprocessor.md` and the protocols it actually needs.
   - Summary + relationships viewer + config assembler: one or two more subagents.
   - Evaluation: a single Opus subagent that reads the new run's outputs against the reference sheets and writes `runs/<n>/evaluation/performance_report.md`.
6. **Stop early** if the evaluation report has zero "WRONG" / "FAIL" findings AND no new spec gaps.

## What to look for during evaluation

- **Numerical accuracy** vs reference sheets (worker stat vs `_数据分析` sheet stat).
- **Display-precision bugs** (rounded values used in computation, e.g. the Q3 truncation that inflated outlier counts by 62% in run 0).
- **Missing artefacts** (relationships viewer, stats json, outlier entity lists).
- **Classification errors** (date-named columns that are integers, etc.).
- **Bucketing scheme drift** (adherence buckets, gap buckets — must match Protocol F exactly).
- **Performance regressions** (parallelism wins should not be lost to a serial assembler step).

## What NOT to put in the spec

- Domain-specific magic numbers (move to `defaults` block in Protocol H, override per-sheet via `domain_limits`).
- File-specific column names, sheet names, units.
- Workarounds for one bad worker run that the user could have caught in the approval gate.

## Conventions for protocol files

- Filename: `<letter>_<short_topic>.md`.
- First line is `# Protocol <letter> — <name>`.
- Second non-empty line is `**Lazy-loaded by:** <step references>`.
- Code blocks are runnable, no pseudo-code.
- Defaults are constants at the top of the file in a Python block, named `<NAME>_DEFAULTS`.
- When a rule has a "MUST" or "CRITICAL" qualifier, attach a one-line reason ("…in run N this caused …").

## Iteration log location

All round-by-round changes go in `log.md` at the project root. Each entry: round number, date, files changed, root cause, fix, expected effect.
