# opencode-tokenwatch

**English** · [简体中文](./README.md)

![Sidebar](./assets/sidebar.png)

Real-time token usage, cache analytics & performance dashboard plugin for OpenCode CLI.

## Features

- **Sidebar panel** — Session-level and per-model real-time stats (requests, tokens, cache, cost)
- **Smart sorting** — Models sorted by most recent call time, current model always on top
- **Provider name truncation** — Long provider names auto-truncated (12 chars) to prevent layout overflow
- **Cache hit rate** — Inline color progress bars with trend indicators (↑/↓) and global weighted hit rate
- **Performance metrics** — TTFT / TPS / End-to-end latency + P50/P95/P99 latency percentiles
- **Token distribution** — 5-bucket role breakdown (system / user / toolCall / toolResult / output + other fallback)
- **Error rate tracking** — Detects failed requests (empty token response) and computes real-time error rate
- **Invalid data filtering** — Full-chain defense: filters zero-token entries from perf-tracker, sidebar, and HTML reports
- **Cost display** — Per-model cost (requires provider billing data)
- **`/usage` command** — HTML Report → JSON Export → Text Report → Settings
- **HTML report** — Interactive ECharts dashboard: token distribution, performance percentiles, TPS horizontal ranking, error rate analysis — auto-opened in browser
- **Persistent stats** — Performance metrics (TPS/TTFT/latency) written to a dedicated JSON file that accumulates forever, unaffected by log rotation
- **Multi-level collapse** — Panel, models, and sub-blocks collapsible with persisted state
- **Language switching** — Auto-detect or manually switch between Chinese and English

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
        "showPricing": true,
        "showTokenDistribution": true,
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
| `sidebar.showPricing` | boolean | `true` | Show request cost |
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

## Data Files

| File | Path | Description |
|------|------|-------------|
| JSONL log | `~/.opencode/tokenwatch.jsonl` | Raw per-request log, auto-rotated at 5 MB |
| Aggregated stats | `~/.opencode/tokenwatch-stats.json` | Persistent performance stats, accumulates forever |
| Report output | `~/.opencode/reports/` | HTML / JSON / Markdown reports |

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
