# Change Log

Round-by-round log of changes to `SheetPreprocessor.md` and `protocols/`.
Newest at top.

---

## Round 2 → Round 3 fixes — 2026-04-09

**Round 2 result:** grade **A**, 13 PASS / 1 PARTIAL / 0 FAIL, zero regressions, all 4 Round-1 `outlier_entity_ids` PARTIAL sheets closed (248/248 reference UUIDs reproduced), 1,149 spurious Tukey outliers on `认知#希望减重完成的时间` suppressed, `饮食评分` reclassified continuous, `高蛋白` mixed numeric+text profiled at 99.8% parse rate, `疾病#目前身高` Q3=170/IQR=11/outliers=63 precision holds third round straight. The single new PARTIAL is a narrow `config.draft.yaml defaults:` block bug (not per-sheet correctness). Reports: `runs/2/evaluation/performance_report.md`, `runs/2/evaluation/spec_gaps_round2.md` (13 items: 3 H / 7 M / 3 L).

**Spec fixes folded into `protocols/` for Round 3:**

1. **[H] `defaults.copy_paste_run_len` must be a dict (H-1).** Round 2 assembler wrote scalar `3`; any Phase 2 cleaner reading defaults would re-flag 17k+ legitimate weight stabilizations. Protocol H now requires `{default: 3, weight_kg: 7}` dict form.
2. **[H] `defaults.implausible_delta` must enumerate all Protocol F keys (H-2).** Round 2 missed `exercise_kcal / diet_kcal / protein_g / fat_g / carb_g`. Protocol H assembler validation now fails if any key is absent.
3. **[H] `defaults.min_pairs_for_per_entity_corr = 3` pinned (H-3).** Round 2 defaults block had `5`, per-sheet workers used `3` — downstream entity counts would drift. Protocol H now pins to 3.
4. **[H] `defaults.inband_null_tokens` surfaced to top-level defaults (H).** Previously per-sheet only.
5. **[C/M] Tukey-suppressed columns still emit `outlier_entity_ids: null` + sibling `domain_violation_entity_ids` (M-5).** Closes the 腰围 skew=6.06 case where the schema was ambiguous.
6. **[D/M] Canonical `domain_clip(col, lo, hi, mask_col)` rule name (M-6).** Replaces 4 bespoke variants (`clip_height`, `clip_waist_domain`, `winsorize_body_composition_to_domain`, `domain_clip`). Single shared `clean.py` function.
7. **[H/M] `empty_string_split:` optional column field (M-7).** Machine-readable schema for the `运动#每次运动时间` pattern so the assembler can generate the derived boolean.
8. **[H/M] `join_keys[*].sheets` must include EVERY sheet whose `entity_key` matches (M-4).** Round 2 assembler omitted `体重`.
9. **[H/M] `join_keys[*].unique_per_sheet` must be populated for every listed sheet (M-8).** Null only allowed for `id_list` kind.
10. **[H/M] `wide_snapshot_repeated` sheets must declare `time_key` (M-10).** Round 2 left 轻断食/限能量/高蛋白 with `time_key: null`.
11. **[F/M] `span_days` inclusive-day convention (M-9).** `span_days = (last - first).days + 1`. Closes the 体重 adherence `>100%` bucket mismatch (worker=21 vs reference=26 before fix).
12. **[F/M] `single_visit` bucket semantics clarified.** Route entities by `n_records == 1`, not `span_days == 0`. Single-day multi-records belong in `>100%`.
13. **[L] `coordinator_timing.json` re-enabled (L-11).** Emit per-round wall-time aggregate.
14. **[L] Protocol G: derive edges from `join_keys.sheets` so HTML and config stay consistent (L-12).**
15. **[L] `建档.fragments:` declares provider side (L-13).** Source sheet writes `{demographics: {columns: [性别, 年龄], exported_to: [...]}}`; consumers populate `{source: 建档, columns: [...]}`.

Files changed: `protocols/C_diagnostics.md`, `protocols/D_proposals.md`, `protocols/F_timeseries.md`, `protocols/H_config_schema.md`, this `log.md`.

**Expected effect:** Round 3 should close the single Round-2 PARTIAL (`config.draft.yaml defaults:` block), populate the 体重 join_keys entry, reconcile `min_pairs_for_per_entity_corr` to 3 workbook-wide, align `>100%` adherence bucket with the 26-patient reference, and standardize all domain-clip proposals on the `domain_clip` canonical rule.

---

## Round 1 → Round 2 fixes — 2026-04-09

**Round 1 result:** grade **A−**, 13 PASS / 1 PARTIAL / 0 FAIL on the protocol scorecard, all 15 round-0 FAIL items closed, zero regressions. Precision rule confirmed: `疾病#目前身高` Q3=170 IQR=11 outlier_count=63 (vs run-0 wrong 169/10/102). 248/248 reference outlier UUIDs covered by the new `outlier_entity_ids` lists. Reports: `runs/1/evaluation/performance_report.md`, `runs/1/evaluation/spec_gaps_round1.md` (30 items: 5 H / 17 M / 8 L).

**Spec fixes folded into `protocols/` for Round 2:**

1. **[C] `outlier_entity_ids` MANDATORY (H).** Run 1 had 4 sheets (`轻断食`, `饮食`, `血压`, `高蛋白`) emit outliers without the id list. Protocol C now treats this as a Phase 1 validation failure.
2. **[C] Tukey fence suppression for discrete / skewed columns (H).** `认知#希望减重完成的时间` (4 unique int months 3/6/12/24) produced 1,149 spurious "outliers". Protocol C now suppresses Tukey when `n_unique ≤ 8` or `|skew| > 5` and notes `discrete_or_skewed — Tukey N/A`.
3. **[B] Score-named column override (H).** `饮食评分` (34 integer levels 15–100) was ordered_categorical by the `评分` token but is continuous. Protocol B now overrides to continuous when score-token + `u > 20` + dense integer sequence.
4. **[B] Mixed numeric+free-text profiler rule (M).** 高蛋白 has ~30 columns mixing grams/ml numerics with occasional text. Rule: if ≥90% of non-null tokens parse as numeric, classify continuous and null the rest.
5. **[B] Low-res numeric rule (M).** 8 ≤ u ≤ 20 evenly-spaced integers → `ordered_categorical(low_res_numeric)`; otherwise continuous + escalate.
6. **[B] In-band null token list (M).** `""`, `N/A`, `-`, `无`, `未知`, `记不清`, `不详` now treated as null pre-classification; override via `inband_null_tokens:` in config.
7. **[B] Empty-string gated category (M).** `运动#每次运动时间` empty strings correlate 1:1 with `是否运动 = 无`; split into derived `_not_applicable` boolean + null.
8. **[B] Multi-label free-text tail collapse (M).** `疾病#目前有无服用减肥药物？` had 78 pseudo-tokens, all `有:<drug>`. Rule: dominant token > 95% + tail pattern → binary + side text column.
9. **[A] Title-row auto-rename carve-out (H).** Single-column sheet with ≥99% id-shaped values (UUID / `^\d{8,}$`) may be auto-renamed to `<shape>_id` with `header_dedup_log`. Unblocks 患者清单.
10. **[A] Two-level `section#question` header convention documented (L).** `#` is a section separator; preserve intact.
11. **[F] `single_visit` bucket + `cadence_per_day` (M).** Adherence distribution now has 12 buckets: `single_visit, 0-10%, …, >100%`. `span_days == 0` entities go to `single_visit`, never fudged. `cadence_per_day` is declared per sheet.
12. **[F] `IMPLAUSIBLE_DELTA` defaults extended (M).** `exercise_kcal`, `diet_kcal`, `protein_g`, `fat_g`, `carb_g` added. Unlisted cols still escalate.
13. **[F] Per-domain `COPY_PASTE_RUN_LEN` (M).** `weight_kg` default raised to 7 (stabilizes legitimately); 3 for others. `COPY_PASTE_RUN_LEN_DEFAULTS` dict.
14. **[F] `MIN_PAIRS_FOR_PER_ENTITY_CORR = 3` pinned (M).** Fixes the 腰围 stats mismatch (233 vs 287 entities scored).
15. **[F] NaN-drop before aggregating per-entity corr (M).** Constant-value entities yield NaN correlations that poisoned the 饮食 aggregate; must `drop_nulls` before quantiles.
16. **[F] Cohort modifier block (L).** `implausible_delta.cohort_modifier.post_bariatric` pattern for relaxing thresholds inside a time window.
17. **[H] First-class `fragments:` map (H).** Replaces ad-hoc `wide_snapshot_fragment`. Supports promoting per-entity-constant columns out of long sheets.
18. **[H] First-class `escalations:` list (M).** Every cross-column / cross-sheet escalation goes in a structured block the assembler can enforce.
19. **[H] Promoted `units:` to top-level column field (M).** Previously nested under `domain_limits`; now a first-class attribute.
20. **[H] `wide_snapshot_repeated` kind (M).** For wide_snapshot sheets tolerating duplicate entity_key (one row per visit); 体成分 / 限能量 / 高蛋白 fit this pattern.
21. **[D] Copy-paste proposal template (L).** `mask_trailing + <col>_was_copypaste` indicator, with per-domain run length.
22. **[D] Cohort-wide escalation routing (M).** Does not get a per-column proposal; goes into `config.yaml:escalations:` and `summary.md`.
23. **[G] Coverage formula explicit (L).** `coverage(A, B, key) = |A ∩ B| / min(|A.unique|, |B.unique|)`; render on hover.

Files changed: `protocols/A_reading.md`, `protocols/B_classification.md`, `protocols/C_diagnostics.md`, `protocols/D_proposals.md`, `protocols/F_timeseries.md`, `protocols/G_relationships_view.md`, `protocols/H_config_schema.md`, this `log.md`.

**Expected effect:** Round 2 should eliminate the 4 PARTIAL sheets on `outlier_entity_ids`, suppress ~1,149 spurious `建档` Tukey outliers, reclassify `饮食评分` + score-named columns, correctly parse mixed numeric+text columns in 高蛋白, and route cohort-wide escalations into structured `escalations:` blocks rather than free-form markdown.

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
