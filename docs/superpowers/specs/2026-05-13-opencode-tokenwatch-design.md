# [DEPRECATED] opencode-tokenwatch Design Spec (v0.1.0)

> **This document is deprecated.** The original v0.1.0 design has been superseded
> by the v2 refactoring. See `2026-05-20-tokenwatch-v2-design.zh.md` (Chinese)
> or `2026-05-20-tokenwatch-v2-design.en.md` (English) for the current design.

## Overview (Historical)

An opencode plugin that provides token usage statistics via the `/usage`
custom command. Uses direct SQLite queries (`opencode db`) for fast
aggregation instead of SDK client crawling. Works in both CLI and TUI modes.

## Architecture (Historical)

```
┌─ opencode session ─────────────────────────────────────┐
│  /usage                                                 │
│    → commands/usage.md                                  │
│      → opencode-usage.ps1 (PowerShell)                  │
│        → opencode db "SELECT ..." --format json         │
│          → Format-Table output                           │
│                                                         │
│  Server Plugin (opencode-tokenwatch)                    │
│    → event hook: tracks token accumulation              │
└─────────────────────────────────────────────────────────┘
```

## Components

### `src/index.ts` — Server Plugin Entry
- Default export `{ id: "opencode-tokenwatch", server }`
- `server` function registers an `event` hook to track token usage from
  `message.updated` events
- Lightweight — no UI dependencies, no TUI API required

### `src/queries.ts` — SQL Query Functions
- `getSummaryStats()` — Aggregate across all messages: total requests, sessions, tokens, cost
- `getModelBreakdown()` — Per-model aggregation with request/session/token counts
- `getDailyBreakdown(limit)` — Per-day aggregation with token type breakdown
- Each function calls `opencode db <sql> --format json` via `child_process.exec`
- Returns typed arrays matching `SessionTokenData`, `ModelBreakdownItem`, `DailyBreakdownItem`

### `src/formatter.ts` — Formatting Utilities
- `formatTokens(n)` — Human-readable: "12.4K", "3.2M"
- `formatCost(n)` — "$0.05"
- Type definitions: `SessionTokenData`, `ModelBreakdownItem`, `DailyBreakdownItem`

### `scripts/opencode-usage.ps1` — CLI Command Backend
- PowerShell script invoked by `/usage` custom command
- Three modes: `current`, `model`, `daily`
- Uses `opencode db --format json` then `Format-Table -AutoSize` for display
- Handles token formatting and cost display inline

### `commands/usage.md` — Custom Command Definition
- Markdown file in opencode's `commands/` directory
- Description: "Show token usage statistics for opencode sessions"
- Three `!` directives calling `opencode-usage.ps1` with different modes

## Data Source

All statistics come from opencode's SQLite database:
- `message` table — `data` column contains JSON with `tokens` and `cost`
- `session` table — `model` column contains JSON provider/model metadata

SQL aggregation queries use `json_extract()` for field extraction:
- `json_extract(data, '$.tokens.total')`
- `json_extract(data, '$.tokens.input')`
- `json_extract(data, '$.tokens.output')`
- `json_extract(data, '$.tokens.reasoning')`
- `json_extract(data, '$.tokens.cache.read')`
- `json_extract(data, '$.cost')`

## Output Format

Three sections are displayed:

1. **Current Session** — Latest session's model, requests, token breakdown, cost
2. **Model Breakdown** — Per-model stats with TOTAL row (req, ses, tot/in/out/cache tok, cost)
3. **Daily Breakdown** — Per-day stats with TOTAL row (req, tot/in/out/cache tok, cost)

## Installation

```sh
cd ~/.config/opencode
npm install opencode-tokenwatch
```

Add `commands/usage.md` and `scripts/opencode-usage.ps1` manually (see README).

## Events

| Event | Source | Purpose |
|-------|--------|---------|
| `message.updated` | server plugin `event` hook | Optionally track token accumulation |

## Requirements

- opencode v1.14+
- Node.js 18+
- PowerShell (Windows helper script)

## Future Considerations

- Cost alerts when exceeding thresholds
- Export to CSV/JSON
- Cross-platform shell script (bash for Linux/macOS)
- AI tool integration for model-powered queries
