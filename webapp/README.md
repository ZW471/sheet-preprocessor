# SheetPreprocessor Review Webapp

A lightweight web interface for reviewing analysis results from the SheetPreprocessor pipeline.

## Quick Start

```bash
# Install dependencies (one-time)
pip install -r webapp/requirements.txt

# Launch the server
cd webapp
python server.py --analysis-dir ../analysis/

# Open in browser
open http://localhost:8787
```

## Features

- **Dashboard** — overview of all sheets with row counts, column counts, and pending decision counts
- **Per-sheet detail** — expandable column stats (continuous, categorical, multi-label, datetime, ID), box plots, escalations, proposals, adherence buckets
- **Relationships** — table view showing all pairwise relationships with type (1:1, 1:N, N:M), coverage bars, and containment formula; optional D3 force-directed graph
- **Outlier Review** — interactive decision cards for each outlier group. Choose: keep, flag, clip to domain, clip to custom bounds, remove, or enter a custom rule. Decisions are saved to the per-sheet `config.yaml` and feed into Phase 2 code generation.

## Architecture

- **Server**: FastAPI (Python) — serves analysis JSON/YAML via REST API + handles write-back for user decisions
- **Frontend**: vanilla HTML + Alpine.js (reactivity) + D3.js (graph) — no build step, CDN-loaded

## Analysis Output Structure

```
analysis/
  manifest.json          # Index of all sheets (loaded first)
  config.draft.yaml      # Assembled config for Phase 2
  relationships.json     # Pairwise sheet relationships
  <sheet_name>/
    stats.json           # Full-precision per-column statistics
    config.yaml          # Column declarations + user decisions
    timing.json          # Worker timing metrics
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/manifest` | Sheet index |
| GET | `/api/relationships` | Pairwise relationships |
| GET | `/api/config-draft` | Assembled config |
| GET | `/api/sheet/{name}/stats` | Per-sheet statistics |
| GET | `/api/sheet/{name}/config` | Per-sheet config |
| POST | `/api/sheet/{name}/outlier-decision` | Save outlier decision |
| POST | `/api/sheet/{name}/escalation-response` | Confirm/dismiss escalation |
