# opencode-tokenwatch

**English** · [简体中文](./README.md)

Real-time token usage, cache analytics & performance dashboard for OpenCode CLI.

Adds a live sidebar panel and `/usage` slash command that reads your local OpenCode history from SQLite, aggregates token usage by model, provider, date, and session, and supports export to HTML, JSON, or Markdown.

## Features

- **Sidebar panel** — Session-level and per-model real-time stats (requests, input/output tokens, cache, latency, cost)
- **Cache hit rate visualization** — Inline progress bars with color thresholds (green/yellow/red) and trend indicators (↑/↓)
- **Performance metrics** — Time to first token (TTFT), tokens per second (TPS), end-to-end latency
- **Token distribution** — Breakdown by role (system/user/Agent instruction/Tool call/Tool result/output)
- **Model pricing** — Input/cache-read/output unit prices for the current model
- **`/usage` command** — One-stop main menu: HTML Report → JSON Export → Text Report → Settings
- **HTML report** — Interactive ECharts dashboard with KPI cards, stacked bar charts, scatter plots, auto-opened in browser
- **Multi-level collapse** — Panel, individual models, and sub-blocks (Performance/Pricing/Token Distribution) collapsible independently; state persists across restarts
- **Language switching** — Auto-detects system language; override via Settings menu at runtime
- **Per-request tracking** — TTFT/TPS/latency persisted to JSONL for performance analysis in reports
- **Adaptive coloring** — Colors auto-derived from the theme with desaturation

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

Optionally customize sidebar display and language via `pluginConfig`:

```jsonc
{
  "plugin": ["opencode-tokenwatch"],
  "pluginConfig": {
    "opencode-tokenwatch": {
      "sidebar": {
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
| `sidebar.showPerformance` | boolean | `true` | Show TTFT/TPS/latency block |
| `sidebar.showPricing` | boolean | `true` | Show model pricing block |
| `sidebar.showTokenDistribution` | boolean | `true` | Show token distribution block |
| `sidebar.showTrend` | boolean | `true` | Show trend indicator |
| `language` | `"auto"` / `"zh"` / `"en"` | `"auto"` | UI language; `"auto"` follows system locale |

Settings can also be toggled interactively via `/usage` → Settings, taking precedence over `pluginConfig`.

## Usage

In OpenCode TUI:

1. Open the right sidebar to view live session statistics
2. Run `/usage` to open the main menu:
   - **HTML Report** — Pick a date range (Today / 7 days / 30 days / All), generates an interactive dashboard and opens it in your browser
   - **JSON Export** — Exports the full usage report to `~/.opencode/reports/`
   - **Text Report** — Exports a Markdown-formatted report to `~/.opencode/reports/`
   - **Settings** — Toggle sidebar display blocks, switch interface language

## Report Dimensions

Queries your local OpenCode SQLite database, aggregated by:

- Model
- Provider
- Date (daily trends)
- Session
- Current session summary

## Requirements

- OpenCode CLI (with `opencode db` command)
- Node.js 18+

## Build

```sh
npm install
npm run build
```

## License

MIT
