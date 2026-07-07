# opencode-tokenwatch

**English** · [简体中文](./README.md)

![Sidebar](./assets/sidebar.png)

Real-time token usage, cache analytics & performance dashboard plugin for OpenCode CLI.

## Features

- **Sidebar panel** — Session-level and per-model real-time stats (requests, tokens, cache, cost)
- **Cache hit rate** — Per-model tracking with trend indicators (↑/↓) and global weighted total
- **Performance metrics** — TTFT / TPS / End-to-end latency + P50/P95/P99 latency percentiles
- **Token distribution** — Per-role breakdown (system / user / tool / output)
- **Cost tracking** — Per-model cost display (requires provider billing data)
- **Error rate tracking** — Detects failed requests and computes real-time error rate
- **`/usage` command** — HTML Report → JSON Export → Text Report → Settings
- **HTML report** — Interactive ECharts dashboard: token trends, performance comparison, TPS ranking, error rate analysis — auto-opened in browser
- **Persistent stats** — Performance metrics accumulate forever in a dedicated file, unaffected by session resets
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

In OpenCode TUI, run `/usage` → **Settings** to interactively toggle display items and switch language. Settings are persisted automatically — no need to edit config files manually.

## Usage

In OpenCode TUI, run `/usage`:

- **HTML Report** — Pick a date range, generates a dashboard and opens it in browser
- **JSON Export** — Exports full usage data to `~/.opencode/reports/`
- **Text Report** — Exports Markdown report to `~/.opencode/reports/`
- **Settings** — Toggle sidebar blocks, switch language

## Data Files

| File | Path | Description |
|------|------|-------------|
| JSONL log | `~/.opencode/tokenwatch.jsonl` | Raw per-request log |
| Aggregated stats | `~/.opencode/tokenwatch-stats.json` | Persistent performance stats |
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
