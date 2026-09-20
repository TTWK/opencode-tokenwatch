# opencode-tokenwatch

**English** · [简体中文](./README.md)

![Sidebar](./assets/sidebar.png)

A terminal monitoring plugin for OpenCode CLI that displays real-time token usage, cache hit rate, and model throughput in the sidebar, with one-click interactive browser reports.

---

## Key Features

- **Real-time Sidebar Dashboard**: Check input/output tokens, estimated cost, cache hit rate, time to first token, and generation speed per model during sessions.
- **Cache Hit Rate & Trends**: Track cache efficiency per model, with arrows showing whether the hit rate for recent requests is trending up or down.
- **Token Breakdown**: Automatically breaks down tokens into system prompt, user input, tool execution, and assistant output to identify major context consumers.
- **Interactive Usage Reports**: Type `/usage` in the terminal to launch an ECharts interactive dashboard in your browser with historical trends, cross-model comparisons, and failed request stats; export to JSON or Markdown with one click.
- **Dual-Host Compatibility**: Seamlessly works with both OpenCode 1.x and OpenCode 2 (beta). Automatically detects the host environment with zero manual configuration.

---

## Installation & Setup

### 1. Install

Run in your project directory:

```sh
npm install opencode-tokenwatch
```

### 2. Enable Plugin

Add the plugin entry to `opencode.json` (or `opencode.jsonc`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-tokenwatch"]
}
```

Restart OpenCode and the TokenWatch panel will load in the sidebar automatically.

---

## Usage

Type `/usage` in the terminal input to open the action menu:

- **HTML Report**: Select a date range to generate and open an interactive chart in your default browser.
- **Export Data**: Export structured JSON or Markdown reports, saved to `~/.opencode/reports/` by default.
- **Settings**: Interactively toggle sidebar sections or switch language in the popup menu. Changes are saved automatically without editing configuration files.

---

## Requirements

- **OpenCode CLI**: 1.18+ or OpenCode 2 (`@opencode-ai/cli@beta`)
- **Node.js**: ≥ 18.0.0

---

## Related Projects

- [opencode-throughput](https://github.com/Howardzhangdqs/opencode-throughput) — Real-time LLM performance monitoring (TTFT/TPS/latency/cost)
- [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache) — TUI sidebar cache hit rate visualization, token distribution analysis
- [magic-context](https://github.com/cortexkit/magic-context/) — Cache-aware infinite context + cross-session memory system

---

## License

MIT
