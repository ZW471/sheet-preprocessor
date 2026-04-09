# Change Log

Round-by-round log of changes to `SheetPreprocessor.md` and `protocols/`.
Newest at top.

---

## Round 0 — 2026-04-09 — Reorganization

**Trigger:** initial setup, before any iterative improvement.

**Changes:**
- Initialized git repo and pushed to `github.com/ZW471/sheet-preprocessor` (https remote). `.gitignore` allows only the doc set (`SheetPreprocessor.md`, `protocols/`, `improvement-guide.md`, `log.md`).
- Moved the existing run artefacts into `runs/0/`:
  - `analysis/` → `runs/0/analysis/`
  - `evaluation/` → `runs/0/evaluation/`
- Created `protocols/` and split the monolithic `SheetPreprocessor.md` into:
  - `protocols/A_reading.md` — large-sheet reading, header hygiene, sheet indexing, datetime parsing
  - `protocols/B_classification.md` — unique-value-first column type rules
  - `protocols/C_diagnostics.md` — per-type stats, precision rule, outlier entity list
  - `protocols/D_proposals.md` — fix-proposal format and confidence levels
  - `protocols/E_pt_contract.md` — `.pt` output dict and assertions
  - `protocols/F_timeseries.md` — long-format diagnostics and processing
  - `protocols/G_relationships_view.md` — relationships HTML viewer (now mandatory when triggered)
  - `protocols/H_config_schema.md` — `config.draft.yaml` shape and per-sheet fragment format
- Rewrote `SheetPreprocessor.md` as a thin index that lazy-loads protocols at the step that needs them. Hard rules and anti-patterns stay in the index; everything else is delegated.
- Created `improvement-guide.md` and this `log.md`.

**Spec fixes folded in from `runs/0/evaluation/performance_report.md`** (full motivation in that file):
1. **Precision rule (Protocol C).** Stats stored at full precision in `<sheet>_stats.json`; markdown display may round but downstream math uses unrounded values. Rationale: run 0 truncated Q3 to 169 vs true 170 on 疾病#目前身高, inflating outlier count from 63 → 102 (+62%).
2. **Outlier entity list (Protocol C).** New required field `outlier_entity_ids` (up to 250) per continuous column. Run 0 could not reproduce the reference 异常值患者清单 (248 rows).
3. **Datetime classification override (Protocol B).** Name-based date detection requires the dtype check to actually parse ≥90% of values; integer-month columns like `认知#希望减重完成的时间` (3/6/12/24) now classify as `continuous`.
4. **String-encoded numeric ranges (Protocol B).** `"500~800"`, `"≥2500"`, `"100-200"` parsed to midpoint+sentinel and treated as continuous.
5. **Header de-duplication (Protocols A & B).** Duplicate / blank headers from merged-cell bleed get suffixed `#2`, `#3`, … and logged. No silent renaming of title rows.
6. **`IMPLAUSIBLE_DELTA` and `BUCKET_DAYS` defaults (Protocol F).** Concrete defaults dict; escalate when value column is unrecognized.
7. **Sentinel-date scrub (Protocol F step 0).** Drop / mask `year < 2000`, `0001-01-01`, `1900-01-01`, `1970-01-01`. Run 0 found 5 entities with `0001-01-01` blowing span_days to 738,894.
8. **11 adherence buckets including `>100%` (Protocol F).** Run 0 collapsed 26 over-adherence patients into the 90–100% bucket.
9. **Per-entity informative missingness (Protocol F).** Compute correlation per-entity, then summarize. Run 0 used a pooled correlation that was dominated by between-entity variance.
10. **Borderline `5 ≤ ratio < 10` rule (Protocol F).** Tag as `long_timeseries_borderline`, run TS diagnostics, surface to user. Closes the 腰围 (7.93) ambiguity.
11. **Sheet-kind streaming exception (Protocol A).** Step 1 explicitly permits streaming the entity-key column for the `rows/n_unique` calculation. Closes the W13 ambiguity in run 0.
12. **Relationship viewer is MANDATORY (Protocol G + hard rule 7).** Run 0 W14 silently skipped this; now an explicit Phase 1 failure if missed.
13. **`config.draft.yaml` schema spelled out (Protocol H).** Per-sheet fragment format documented so workers + assembler agree without reverse-engineering.
14. **Per-entity-constant column promotion (Protocol B + F).** Constant columns inside long sheets become wide_snapshot fragments, not tiled rows.
15. **Copy-paste run length default (`COPY_PASTE_RUN_LEN = 3`, Protocol F).** Run 0 体重 worker guessed 3; codified.

**Files changed:** all of the above were created in this round, so the diff is the entire `protocols/` tree plus a fresh `SheetPreprocessor.md`.

**Expected effect:** the round-1 evaluation should show no WRONG/FAIL entries on items 1, 2, 3, 8, and 12; partial improvement on the rest.
