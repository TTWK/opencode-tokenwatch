# opencode-tokenwatch v2 Refactoring Design Document

## 1. Overview

opencode-tokenwatch is an OpenCode TUI plugin that displays real-time token usage, cache hit rate, performance metrics (TTFT/TPS), and cost statistics in the sidebar, plus provides the `/usage` command for multi-dimensional historical data querying and export.

The v2 refactoring preserves the existing SQLite query layer and `/usage` command while introducing a modular architecture and 11 new features.

Reference projects:
- [opencode-throughput](https://github.com/Howardzhangdqs/opencode-throughput) — performance metrics (TTFT/TPS), JSONL logging
- [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache) — cache hit rate visualization, adaptive coloring, token distribution analysis
- [magic-context](https://github.com/cortexkit/magic-context/) — cache-aware design, background compression (not adopted, reserved for future reference)

## 2. Feature List

### 2.1 v2 New Features

| # | Feature | Source |
|---|---------|--------|
| 1 | Cache hit rate visualization (progress bar + color coding) | visual-cache |
| 4 | Collapse state persistence (`api.kv` storage) | visual-cache |
| 5 | Trend indicator (hit rate ↑/↓ change direction) | visual-cache |
| 6 | Performance metrics (TTFT/TPS/latency) | throughput |
| 8 | Token distribution by role (system/user/Agent/Tool/result) | visual-cache |
| 9 | JSONL persistent logging (`~/.opencode/tokenwatch.jsonl`) | throughput |
| 11 | Multi-level independent collapsing (model + sub-block) | visual-cache |
| 12 | Model pricing display | visual-cache |
| 13 | Sidebar width adaptive layout | visual-cache |
| 14 | i18n bilingual (Chinese/English) | visual-cache |
| 15 | Adaptive theme coloring (auto-desaturation) | visual-cache |

### 2.2 Retained v0.1 Features

- `/usage` command (multi-dimension reports: model/provider/date/session)
- Real-time sidebar stats panel
- SQLite query layer (`opencode db` subprocess)
- JSON/CSV export
- Formatting utilities (Unicode table rendering, number formatting)

### 2.3 Rejected Features

| # | Feature | Reason |
|---|---------|--------|
| 2 | Toast notifications | May distract user's flow |
| 3 | Cache cost savings | Deemed unnecessary |
| 7 | Finish reason tracking | Limited user value |
| 16 | Context compression + cross-session memory | Too large in scope, deviates from plugin's core purpose |
| 17 | Semantic search | Depends on embedding models, high complexity |
| 19 | Caveman text compression | Requires integration into context pipeline, complex |

### 2.4 TBD (Reserved for Future Reference)

| # | Feature | Notes |
|---|---------|-------|
| 10 | Benchmark query tool | Depends on JSONL infrastructure; wait for explicit demand |
| 18 | Desktop companion app | Large engineering effort, low priority for CLI ecosystem |
| 20 | Git contribution analysis | Deviates from "usage monitoring" core positioning |

## 3. Architecture

### 3.1 Module Split

```
src/
├── index.ts          ← Plugin entry (unchanged)
├── tui.ts            ← Slim down to: register commands/slots/events, dispatch to modules
├── formatter.ts      ← Keep (formatting + types), add i18n support
├── queries.ts        ← Keep (SQL query layer), largely unchanged
├── sidebar.tsx       ← Sidebar rendering (cache viz, collapse mgmt, adaptive width, colors, token dist)
├── perf-tracker.ts   ← Performance metrics (TTFT/TPS) + JSONL logging
├── i18n.ts           ← Internationalization (Chinese/English, auto-detect + config override)
└── commands.ts       ← Extended /usage command, add settings sub-command
```

### 3.2 Data Flow

```
message.updated / message.part.updated events
  → tui.ts listens, dispatches
    → perf-tracker.ts: compute TTFT/TPS/latency, write JSONL
    → sidebar.tsx: refresh sidebar panel
      → read api.state.session.messages
      → aggregate by model
      → compute cache hit rate + trend
      → render blocks (Cache / Performance / Pricing / Token Distribution)
```

### 3.3 Tech Stack

- **UI framework**: `@opentui/solid` (SolidJS + JSX, matches OpenCode TUI)
- **Reactive state**: SolidJS `createSignal` / `createMemo`
- **Persistence**: `api.kv` (collapse state), JSONL file (performance log)

### 3.4 Rendering Strategy

Sidebar content uses `@opentui/solid` JSX components, rendered via `api.slots.register`'s `component` callback. No string concatenation.

Core component hierarchy:
```
<TokenWatchPanel>
  ├── HeaderRow              ← title, global collapse toggle
  ├── SessionSummary         ← session totals
  ├── For each model:
  │   ├── ModelHeader        ← model title, model-level collapse toggle
  │   ├── ModelSummary       ← model summary row
  │   ├── CacheBlock         ← cache sub-block (conditional)
  │   ├── PerformanceBlock   ← performance sub-block (conditional)
  │   └── PricingBlock       ← pricing sub-block (conditional)
  └── TokenDistributionBlock ← session-level token distribution (conditional)
```

Each component manages collapse state via `createSignal` and computed values via `createMemo`.

## 4. Sidebar Detailed Design

### 4.1 Layout

```
┌─ TokenWatch ──────────────────────────▼─┐  ← global collapse/expand
│  Session: In 65K  Out 12K  Cache 53K    │  ← summary when collapsed
│  Requests 52  Cost $0.89                 │
│                                          │
│  ▼ claude-sonnet-4-20250229              │  ← model level (▶ collapsed / ▼ expanded)
│    In:30.5K  Out:892  Cache Read:45K    │  ← summary row (shown when collapsed)
│    Hit Rate:85% ↑2.1%  Req:12  Cost:$0.023 │
│    ── Cache ───────────────────────▶    │  ← sub-block (default collapsed)
│    ── Performance ─────────────────▶    │
│    ── Pricing ─────────────────────▶    │
│                                          │
│  ▼ deepseek-chat                         │
│    In:25K  Out:1.2K  Cache Read:8K       │
│    Hit Rate:20% ↓3.5%  Req:40  Cost:$0.012 │
│    ...                                    │
│                                          │
│  ── Token Distribution ────────────▶    │  ← session level, default collapsed
└──────────────────────────────────────────┘
```

### 4.2 Design Principles

- **No icons**: All data uses plain text labels
- **Color as visual cue**: Hit rate uses ANSI colors (≥85% green / ≥70% yellow / <70% red)
- **`▶`/`▼` for collapse state**: Widely-accepted terminal convention
- **Progress bar with Unicode blocks**: `████░░░░`, matching Claude Code style
- **Labels left-aligned, data right-aligned**: For quick scanning

### 4.3 Collapse Levels

| Level | Default | Description |
|-------|---------|-------------|
| Global panel | Expanded | Full sidebar visibility; collapsed shows title + summary |
| Model level | Collapsed | Per-model independent collapse; collapsed shows one summary row |
| Sub-block (Cache/Performance/Pricing) | Collapsed | Independent collapse within an expanded model |
| Token Distribution | Collapsed | Session-level, independent of models |

All collapse states persisted via `api.kv`.

### 4.4 Hit Rate Color Thresholds

| Hit Rate | Color | Meaning |
|----------|-------|---------|
| ≥ 85% | Green | Efficient cache utilization |
| ≥ 70% | Yellow/Orange | Moderate cache utilization |
| < 70% | Red | Low cache utilization, needs optimization |

v2 initial version uses hardcoded ANSI colors (green/yellow/red). Future version (v2.1) will implement auto-derivation from OpenCode theme color with binary-search desaturation (Morandi palette).

## 5. perf-tracker.ts Design

### 5.1 Event Flow

```
message.part.updated (TextPart.time.start)
  → record firstPartTime[messageID] = time.start

message.updated (AssistantMessage, role === "assistant")
  → compute:
    - latencyMs = time.completed - time.created
    - ttftMs = firstPartTime - time.created (if firstPartTime exists)
    - genMs = time.completed - firstPartTime (if exists)
    - tps = outputTokens / (genMs / 1000) (if genMs > 0 && outputTokens > 0)
    - tpsFallback = outputTokens / (latencyMs / 1000) (if genMs null but latencyMs > 0 && outputTokens > 0; prefixed with ~)
  → build LogEntry, both:
    a) sync append to JSONL (fs.appendFileSync, avoids concurrency)
    b) update in-memory sessionStats Map (for sidebar)
  → cleanup firstPartTime[messageID]

message.removed / cancelled
  → cleanup corresponding messageID from firstPartTime Map (prevent memory leak)
```

### 5.2 JSONL Log Format

```typescript
type LogEntry = {
  ts: string
  model: string
  providerID: string
  modelID: string
  sessionID: string
  ttft_ms: number | null
  tps: number | null
  latency_ms: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}
```

Path: `~/.opencode/tokenwatch.jsonl`

### 5.3 Exposed API

```typescript
export function getSessionStats(): SessionPerfStats
export function readLogs(last?: number): LogEntry[]
export function createPerfTracker(): PerfTracker
```

### 5.4 Stability Design

| Risk | Mitigation |
|------|-----------|
| `firstPartTimes` Map memory leak | Listen to `message.removed` to clean up stale entries; optional cap at 1000 entries |
| JSONL write concurrency | Use `fs.appendFileSync` (synchronous, ~200 bytes per write, no bottleneck) |
| TPS unavailable (non-streaming) | Fallback to rough TPS using `latencyMs`, prefix with `~` in UI |
| Unbounded log growth | No rotation in v2; user can manually clean `~/.opencode/tokenwatch.jsonl`. Future: size/day-based rotation |

## 6. Configuration

### 6.1 Config Options

```typescript
type TokenWatchConfig = {
  sidebar: {
    showCache: boolean
    showPerformance: boolean
    showPricing: boolean
    showTokenDistribution: boolean
    showTrend: boolean
  }
  language: "zh" | "en" | "auto"
}
```

### 6.2 Config Sources (priority high to low)

1. `api.kv` runtime changes (via `/usage settings` command)
2. `opencode.jsonc` `pluginConfig["opencode-tokenwatch"]`

## 7. i18n Design

All UI text goes through `t(key)` function with complete Chinese/English translation table in `i18n.ts`.

Language detection: `Intl.DateTimeFormat().resolvedOptions().locale` (wrapped in try-catch, falls back to `"en"` on failure).
Overridable via `TOKENWATCH_LANG` env var or config `language` field.

## 8. Affected Files

| File | Change | Description |
|------|--------|-------------|
| `src/index.ts` | Unchanged | Plugin entry |
| `src/tui.ts` | Refactored | Slimmed to dispatch layer |
| `src/formatter.ts` | Extended | New types, i18n formatting |
| `src/queries.ts` | Unchanged | SQL query layer |
| `src/sidebar.tsx` | New | All sidebar panel logic |
| `src/perf-tracker.ts` | New | Performance + JSONL logging |
| `src/i18n.ts` | New | Internationalization |
| `src/commands.ts` | New | Command registration (extracted from tui.ts) |

## 9. Verification

1. Start TUI, verify sidebar renders correctly
2. Switch models, verify per-model stats are independent
3. Send messages, verify real-time updates + trend indicator
4. Resize panel, verify adaptive layout
5. Switch language, verify all text switches correctly
6. Toggle config items, verify corresponding blocks show/hide
7. Restart OpenCode, verify collapse states persist
8. Check `~/.opencode/tokenwatch.jsonl` exists and has correct format
9. Run `tsc` to confirm zero compilation errors
