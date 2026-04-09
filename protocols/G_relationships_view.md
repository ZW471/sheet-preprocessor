# Protocol G — Relationship viewer (`analysis/relationships.html`)

**Lazy-loaded by:** Phase 1 step 8.

## When required (MANDATORY)

If the workbook has **≥3 sheets sharing at least one non-trivial join key**, you MUST emit `analysis/relationships.html`. This is not optional — the report reviewer relies on it to audit join coverage. Skip ONLY for single-CSV inputs or workbooks with <3 sheets.

A "non-trivial" join key is any column shared across ≥2 sheets that is NOT a generic per-row constant like `性别` / `年龄` (those are demographic columns, not relational keys). Prefer keys whose name contains `id`, `_id`, `编号`, `uuid`, or that achieve ≥50% cross-sheet coverage.

## Implementation rules

- Single self-contained HTML file, **<500 lines**.
- Vanilla HTML + vis-network or d3 via CDN. **No build step**, no SPA framework.
- Nodes = sheets. Node size proportional to row count (log scale recommended).
- Edges = shared keys. Edge thickness proportional to join coverage (`min(matched, total) / max(total)`).
- Hover tooltip on each node: sheet kind, n_rows, n_unique(entity_key), top columns.
- Hover on each edge: key name, coverage %, # matched ids.
- Sidebar lists all join keys with counts; clicking a key highlights the relevant edges.

## Smoke test

After writing the file:
1. The file exists and is `<500` lines.
2. It contains references to every sheet in the workbook by name.
3. It contains at least one `<script src="https://...vis-network.../...">` or d3 CDN tag.

If any check fails, regenerate before completing Phase 1.
