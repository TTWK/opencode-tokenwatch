# opencode-tokenwatch

**English** · [简体中文](./README.md)

Real-time token usage, cache hit rate, and performance metrics panel for OpenCode.

Adds a live sidebar panel and `/usage` slash command that reads your local OpenCode history from SQLite, aggregates token usage by model, provider, date, and session, and supports export to JSON or CSV.

## Features

- **Sidebar panel** — Session-level and per-model real-time statistics (input/output/cache read)
- **Cache hit rate visualization** — Progress bar with color thresholds (green/yellow/red), trend indicator (↑/↓)
- **Performance metrics** — Time to first token (TTFT), tokens per second (TPS), end-to-end latency
- **Token distribution** — Breakdown by role (system/user/Agent instruction/Tool call/Tool result)
- **Model pricing display** — Input/cache read unit prices for the current model
- **`/usage` command** — Historical reports grouped by model, provider, date, and session
- **`/usage-settings` command** — Configure sidebar display options
- **Multi-level collapse** — Panel, models, and sub-blocks (Cache/Performance/Pricing) collapsible independently
- **Collapse state persistence** — Restored after restart
- **Width adaptive** — Automatically adjusts layout when sidebar width changes
- **JSONL logging** — Per-request details persisted to `~/.opencode/tokenwatch.jsonl`
- **i18n** — Auto-detects system language, configurable override
- **Adaptive coloring** — Colors auto-derived from theme with desaturation
- **Export** — Full reports to JSON / CSV

## Install

```sh
npm install opencode-tokenwatch
```

Add to `opencode.json` or `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-tokenwatch"]
}
```

## Configuration

Customize sidebar display and language via `pluginConfig` (optional):

```jsonc
{
  "plugin": ["opencode-tokenwatch"],
  "pluginConfig": {
    "opencode-tokenwatch": {
      "sidebar": {
        "showCache": true,
        "showPerformance": true,
        "showPricing": false,
        "showTokenDistribution": false,
        "showTrend": true
      },
      "language": "auto"
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sidebar.showCache` | boolean | `true` | Show cache hit rate block |
| `sidebar.showPerformance` | boolean | `true` | Show performance metrics block |
| `sidebar.showPricing` | boolean | `true` | Show model pricing block |
| `sidebar.showTokenDistribution` | boolean | `true` | Show token distribution block |
| `sidebar.showTrend` | boolean | `true` | Show trend indicator |
| `language` | `"auto"` / `"zh"` / `"en"` | `"auto"` | UI language; `"auto"` follows system locale |

## Usage

In OpenCode TUI:

1. Open the right sidebar to see live session statistics.
2. Run `/usage` for multi-dimension historical reports.
3. Run `/usage-settings` to adjust sidebar display options.

Exports are written to the current working directory:

- `tokenwatch-usage-report.json`
- `tokenwatch-models.csv`
- `tokenwatch-providers.csv`
- `tokenwatch-daily.csv`
- `tokenwatch-sessions.csv`

## Report Dimensions

- By model
- By provider
- By date
- By session
- Current session summary

## Requirements

- OpenCode CLI (with `opencode db` command)
- Node.js 18+

## Build

```sh
npm install
npm run build
```

## Publish Prep

```sh
npm run release:check
```

Runs build and `npm pack --dry-run` with an isolated temp cache, especially helpful on Windows when the default cache is locked.

## License

MIT
