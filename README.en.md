# opencode-tokenwatch

**English** · [简体中文](./README.md)

![Sidebar](./assets/sidebar.png)

Real-time token usage, cache analytics & performance dashboard plugin for OpenCode CLI.

## Features

- **Sidebar panel** — Session-level and per-model real-time stats (requests, tokens, cache, latency, cost)
- **Cache hit rate** — Inline progress bars with color thresholds, trend indicators (↑/↓), and global weighted cache hit rate in the summary row
- **Performance metrics** — TTFT / TPS / End-to-end latency + P50/P95/P99 latency percentiles
- **Token distribution** — 5-bucket role breakdown (system, user, Agent, Tool and other with fallback and adaptive scaling)
- **Error rate statistics** — Detects and tracks failed requests (empty token response) and real-time error rate
- **Model pricing** — Input/cache/output unit prices
- **`/usage` command** — HTML Report → JSON Export → Text Report → Settings
- **HTML report** — Interactive ECharts dashboard: Token distribution, performance percentiles, error rate analysis, model speed rankings (redesigned from overlapping scatter plots to horizontal bar charts), auto-opened in browser
- **Multi-level collapse** — Panel, models, and sub-blocks collapsible with persisted state
- **Language switching** — Auto-detect or manually switch between Chinese and English
- **Per-request tracking** — TTFT/TPS/latency logged to JSONL for report analysis
- **Adaptive coloring** — Colors auto-derived from theme

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
| `sidebar.showPerformance` | boolean | `true` | Show TTFT/TPS/latency |
| `sidebar.showPricing` | boolean | `true` | Show model pricing |
| `sidebar.showTokenDistribution` | boolean | `true` | Show token distribution |
| `sidebar.showTrend` | boolean | `true` | Show trend indicator |
| `language` | `"auto"` / `"zh"` / `"en"` | `"auto"` | UI language |

Settings can also be toggled via `/usage` → Settings, taking precedence over `pluginConfig`.

## Usage

In OpenCode TUI, run `/usage`:

- **HTML Report** — Pick a date range, generates a dashboard and opens it in browser
- **JSON Export** — Exports full usage data to `~/.opencode/reports/`
- **Text Report** — Exports Markdown report to `~/.opencode/reports/`
- **Settings** — Toggle sidebar blocks, switch language

## Requirements

- OpenCode CLI (with `opencode db` command)
- Node.js 18+

## Build

```sh
npm install
npm run build
```

## Related

- [opencode-throughput](https://github.com/Howardzhangdqs/opencode-throughput) — Real-time LLM performance monitoring (TTFT/TPS/latency/cost)
- [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache) — TUI sidebar cache hit rate visualization, token distribution analysis
- [magic-context](https://github.com/cortexkit/magic-context/) — Cache-aware infinite context + cross-session memory system

## License

MIT
