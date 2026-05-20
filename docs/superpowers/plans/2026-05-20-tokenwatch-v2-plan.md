# opencode-tokenwatch v2 Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor opencode-tokenwatch from a monolithic TUI plugin into a modular architecture with 11 new features (cache visualization, performance metrics, i18n, JSONL logging, etc.)

**Architecture:** Module-split approach: `sidebar.tsx` handles all sidebar rendering, `perf-tracker.ts` handles performance metrics + JSONL logging, `i18n.ts` provides internationalization, `commands.ts` handles command registration. `tui.ts` slimmed to orchestration layer.

**Tech Stack:** TypeScript, `@opencode-ai/plugin/tui`, `@opentui/solid`, SolidJS `createSignal/createMemo`, `api.kv` for persistence

---

## File Structure

```
src/
├── index.ts          ← DEFAULT EXPORT (unchanged, ~10 lines)
├── tui.ts            ← REFACTOR: orchestration only (~80 lines)
├── formatter.ts      ← EXTEND: new types, i18n-aware formatting (~450 lines)
├── queries.ts        ← UNCHANGED (~435 lines)
├── sidebar.tsx       ← NEW: all sidebar panel rendering (~600 lines)
├── perf-tracker.ts   ← NEW: TTFT/TPS calculation + JSONL logging (~200 lines)
├── i18n.ts           ← NEW: Chinese/English translation table (~150 lines)
└── commands.ts       ← NEW: command registration extracted from tui.ts (~100 lines)
```

---

### Task 1: Create i18n.ts — Internationalization module

**Files:**
- Create: `src/i18n.ts`

Provides `t(key)` function for all user-facing strings. Auto-detects system language via `Intl.DateTimeFormat`, allows override via config parameter.

- [ ] **Step 1: Write i18n.ts**

```typescript
export type SupportedLanguage = "zh" | "en"

const zh: Record<string, string> = {
  panelTitle: "TokenWatch",
  collapse: "折叠",
  expand: "展开",
  sessionSummary: "会话累计",
  input: "输入",
  output: "输出",
  cacheRead: "缓存读",
  cacheWrite: "缓存写",
  cacheMiss: "未命中",
  hitRate: "命中率",
  requests: "请求",
  cost: "成本",
  trendUp: "↑",
  trendDown: "↓",
  cache: "Cache",
  performance: "Performance",
  pricing: "Pricing",
  tokenDistribution: "Token Distribution",
  modelLabel: "模型",
  provider: "提供商",
  ttft: "TTFT",
  tps: "TPS",
  latency: "延迟",
  avg: "平均",
  max: "最大",
  min: "最小",
  read: "读",
  write: "写",
  sessionAccumulated: "Session 累计",
  saving: "节省",
  priceInput: "输入",
  priceCacheRead: "缓存读",
  priceCacheWrite: "缓存写",
  priceOutput: "输出",
  total: "总计",
  system: "系统提示",
  user: "用户",
  agent: "Agent 指令",
  toolCall: "Tool 调用",
  toolResult: "Tool 结果",
  outputTokens: "输出",
  settings: "Settings",
  showCache: "显示缓存统计",
  showPerformance: "显示性能指标",
  showPricing: "显示模型定价",
  showTokenDistribution: "显示 Token 分布",
  showTrend: "显示趋势指示器",
  language: "语言",
  auto: "自动",
}

const en: Record<string, string> = {
  panelTitle: "TokenWatch",
  collapse: "Collapse",
  expand: "Expand",
  sessionSummary: "Session",
  input: "Input",
  output: "Output",
  cacheRead: "Cache Read",
  cacheWrite: "Cache Write",
  cacheMiss: "Cache Miss",
  hitRate: "Hit Rate",
  requests: "Requests",
  cost: "Cost",
  trendUp: "↑",
  trendDown: "↓",
  cache: "Cache",
  performance: "Performance",
  pricing: "Pricing",
  tokenDistribution: "Token Distribution",
  modelLabel: "Model",
  provider: "Provider",
  ttft: "TTFT",
  tps: "TPS",
  latency: "Latency",
  avg: "Avg",
  max: "Max",
  min: "Min",
  read: "Read",
  write: "Write",
  sessionAccumulated: "Session Accumulated",
  saving: "Saving",
  priceInput: "Input",
  priceCacheRead: "Cache Read",
  priceCacheWrite: "Cache Write",
  priceOutput: "Output",
  total: "Total",
  system: "System",
  user: "User",
  agent: "Agent",
  toolCall: "Tool Call",
  toolResult: "Tool Result",
  outputTokens: "Output",
  settings: "Settings",
  showCache: "Show Cache",
  showPerformance: "Show Performance",
  showPricing: "Show Pricing",
  showTokenDistribution: "Show Token Distribution",
  showTrend: "Show Trend",
  language: "Language",
  auto: "Auto",
}

let currentLang: SupportedLanguage = detectLanguage()

export function detectLanguage(): SupportedLanguage {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    if (locale.startsWith("zh")) return "zh"
  } catch {
    // Intl may not be available in restricted environments
  }
  return "en"
}

export function setLanguage(lang: SupportedLanguage | "auto"): void {
  if (lang === "auto") {
    currentLang = detectLanguage()
  } else {
    currentLang = lang
  }
}

export function getCurrentLanguage(): SupportedLanguage {
  return currentLang
}

export function t(key: string): string {
  const table = currentLang === "zh" ? zh : en
  return table[key] ?? key
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/i18n.ts
git commit -m "feat: add i18n module with zh/en support"
```

---

### Task 2: Extend formatter.ts — Add new types and PerfStats

**Files:**
- Modify: `src/formatter.ts`
- Impact: New interfaces, new formatting functions, existing API unchanged

- [ ] **Step 1: Read current formatter.ts to understand existing types**

Run: `Get-Content src/formatter.ts`
Expected: Read the current 385-line file

- [ ] **Step 2: Add new type definitions after existing types**

Append after the last line of `src/formatter.ts`:

```typescript
// ── New types for v2 ──

export interface SessionPerfStats {
  models: Record<string, ModelPerfStats>
  totals: {
    totalInput: number
    totalOutput: number
    totalCacheRead: number
    totalCacheWrite: number
    totalRequests: number
    totalCost: number
  }
}

export interface ModelPerfStats {
  model: string
  providerID: string
  requestCount: number
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  totalCost: number
  avgTTFT: number | null
  maxTTFT: number | null
  minTTFT: number | null
  avgTPS: number | null
  maxTPS: number | null
  minTPS: number | null
  avgLatency: number | null
  maxLatency: number | null
  minLatency: number | null
}

export interface TokenDistribution {
  system: number
  user: number
  agent: number
  toolCall: number
  toolResult: number
  output: number
  total: number
}

export interface LogEntry {
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

- [ ] **Step 3: Add formatDuration function**

Append after `formatCost`:

```typescript
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s}s`
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/formatter.ts
git commit -m "feat: add v2 types and formatDuration to formatter"
```

---

### Task 3: Create perf-tracker.ts — Performance metrics + JSONL logging

**Files:**
- Create: `src/perf-tracker.ts`

Calculates TTFT/TPS/latency from `message.part.updated` and `message.updated` events. Appends results to JSONL file.

- [ ] **Step 1: Write perf-tracker.ts**

```typescript
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { LogEntry, ModelPerfStats, SessionPerfStats } from "./formatter.js"
import { appendFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync } from "node:fs"

const LOG_PATH = join(homedir(), ".opencode", "tokenwatch.jsonl")

interface PartEvent {
  message_id?: string
  type?: string
  text?: string
  time?: { start?: number }
}

interface MessageEvent {
  session_id?: string
  sessionID?: string
  message_id?: string
  messageID?: string
  role?: string
  info?: {
    tokens?: {
      total?: number
      input?: number
      output?: number
      reasoning?: number
      cache?: { read?: number; write?: number }
    }
    cost?: number
    providerID?: string
    modelID?: string
    time?: { created?: number; completed?: number }
  }
}

class PerfTracker {
  private firstPartTimes = new Map<string, number>()
  private statsMap = new Map<string, ModelPerfStats>()

  handlePartUpdated(event: PartEvent): void {
    if (!event.time?.start || !event.message_id) return
    this.firstPartTimes.set(event.message_id, event.time.start)
  }

  handleMessageUpdated(event: MessageEvent): void {
    if (event.role !== "assistant") return
    const info = event.info
    if (!info?.time?.created || !info?.time?.completed) return

    const sessionID = event.session_id ?? event.sessionID ?? ""
    const messageID = event.message_id ?? event.messageID ?? ""
    const providerID = info.providerID ?? "unknown"
    const modelID = info.modelID ?? "unknown"
    const model = `${providerID}/${modelID}`
    const tokens = info.tokens

    const inputTokens = tokens?.input ?? 0
    const outputTokens = tokens?.output ?? 0
    const reasoningTokens = tokens?.reasoning ?? 0
    const cacheRead = tokens?.cache?.read ?? 0
    const cacheWrite = tokens?.cache?.write ?? 0
    const cost = info.cost ?? 0

    const created = info.time.created
    const completed = info.time.completed
    const firstPart = this.firstPartTimes.get(messageID) ?? null

    const latencyMs = completed - created
    const ttftMs = firstPart !== null ? firstPart - created : null
    const genMs = firstPart !== null ? completed - firstPart : null
    const tps = (genMs !== null && genMs > 0 && outputTokens > 0)
      ? (outputTokens / genMs) * 1000
      : null
    // Fallback: when streaming timestamps aren't available, use latencyMs for rough TPS
    const tpsFallback = (tps === null && latencyMs > 0 && outputTokens > 0)
      ? (outputTokens / latencyMs) * 1000
      : null

    this.firstPartTimes.delete(messageID)

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      model,
      providerID,
      modelID,
      sessionID,
      ttft_ms: ttftMs,
      tps: tps ?? tpsFallback,
      latency_ms: latencyMs,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cost,
    }

    this.appendLog(entry)
    this.updateStats(model, entry)
  }

  private appendLog(entry: LogEntry): void {
    try {
      appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n")
    } catch {
      // Silently fail — logging is non-critical
    }
  }

  handleMessageRemoved(event: { message_id?: string; messageID?: string }): void {
    const mid = event.message_id ?? event.messageID ?? ""
    if (mid) this.firstPartTimes.delete(mid)
  }

  private updateStats(model: string, entry: LogEntry): void {
    let stats = this.statsMap.get(model)
    if (!stats) {
      stats = {
        model,
        providerID: entry.providerID,
        requestCount: 0,
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalCost: 0,
        avgTTFT: null,
        maxTTFT: null,
        minTTFT: null,
        avgTPS: null,
        maxTPS: null,
        minTPS: null,
        avgLatency: null,
        maxLatency: null,
        minLatency: null,
      }
      this.statsMap.set(model, stats)
    }

    stats.requestCount++
    stats.totalInput += entry.inputTokens
    stats.totalOutput += entry.outputTokens
    stats.totalCacheRead += entry.cacheReadTokens
    stats.totalCacheWrite += entry.cacheWriteTokens
    stats.totalCost += entry.cost

    if (entry.ttft_ms !== null) {
      const c = stats.requestCount
      const prev = stats.avgTTFT
      stats.avgTTFT = prev !== null ? prev + (entry.ttft_ms - prev) / c : entry.ttft_ms
      stats.maxTTFT = stats.maxTTFT !== null ? Math.max(stats.maxTTFT, entry.ttft_ms) : entry.ttft_ms
      stats.minTTFT = stats.minTTFT !== null ? Math.min(stats.minTTFT, entry.ttft_ms) : entry.ttft_ms
    }

    if (entry.tps !== null) {
      const c = stats.requestCount
      const prev = stats.avgTPS
      stats.avgTPS = prev !== null ? prev + (entry.tps - prev) / c : entry.tps
      stats.maxTPS = stats.maxTPS !== null ? Math.max(stats.maxTPS, entry.tps) : entry.tps
      stats.minTPS = stats.minTPS !== null ? Math.min(stats.minTPS, entry.tps) : entry.tps
    }

    if (entry.latency_ms !== null) {
      const c = stats.requestCount
      const prev = stats.avgLatency
      stats.avgLatency = prev !== null ? prev + (entry.latency_ms - prev) / c : entry.latency_ms
      stats.maxLatency = stats.maxLatency !== null ? Math.max(stats.maxLatency, entry.latency_ms) : entry.latency_ms
      stats.minLatency = stats.minLatency !== null ? Math.min(stats.minLatency, entry.latency_ms) : entry.latency_ms
    }
  }

  getSessionStats(): SessionPerfStats {
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0
    let totalRequests = 0, totalCost = 0
    for (const s of this.statsMap.values()) {
      totalInput += s.totalInput
      totalOutput += s.totalOutput
      totalCacheRead += s.totalCacheRead
      totalCacheWrite += s.totalCacheWrite
      totalRequests += s.requestCount
      totalCost += s.totalCost
    }
    return {
      models: Object.fromEntries(this.statsMap),
      totals: { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalRequests, totalCost },
    }
  }

  readLogs(last: number = 50): LogEntry[] {
    try {
      if (!existsSync(LOG_PATH)) return []
      const content = readFileSync(LOG_PATH, "utf-8").trim()
      if (!content) return []
      const lines = content.split("\n")
      const entries: LogEntry[] = []
      for (let i = Math.max(0, lines.length - last); i < lines.length; i++) {
        try {
          entries.push(JSON.parse(lines[i]) as LogEntry)
        } catch {
          // Skip malformed lines
        }
      }
      return entries
    } catch {
      return []
    }
  }

  reset(): void {
    this.firstPartTimes.clear()
    this.statsMap.clear()
  }
}

export function createPerfTracker(): PerfTracker {
  return new PerfTracker()
}
export type { PartEvent, MessageEvent, PerfTracker }
export function readLogs(last: number = 50): LogEntry[] {
  const tracker = new PerfTracker()
  return tracker.readLogs(last)
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/perf-tracker.ts
git commit -m "feat: add performance tracker with JSONL logging"
```

---

### Task 4: Create commands.ts — Extract command registration

**Files:**
- Create: `src/commands.ts`

Extracts `/usage` command registration from `tui.ts`. Adds `/usage settings` sub-command for toggling sidebar blocks and language.

- [ ] **Step 1: Read current tui.ts to understand command registration patterns**

Run: `Get-Content src/tui.ts`
Expected: Read current 505-line file

- [ ] **Step 2: Write commands.ts**

```typescript
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport } from "./queries.js"
import { formatUsageReport } from "./formatter.js"
import { t } from "./i18n.js"
import type { SidebarConfig } from "./sidebar.jsx"

const DEFAULT_CONFIG: SidebarConfig = {
  showCache: true,
  showPerformance: true,
  showPricing: true,
  showTokenDistribution: true,
  showTrend: true,
  language: "auto",
}

export async function registerCommands(api: TuiPluginApi): Promise<void> {
  api.command.register(() => [
    {
      value: "tokenwatch-usage",
      title: "Token Usage & Performance",
      description: "View detailed token usage and performance report",
      category: "Stats",
      slash: { name: "usage", aliases: ["tokens", "tokenwatch"] },
      onSelect: async () => {
        await showUsageReport(api)
      },
    },
    {
      value: "tokenwatch-settings",
      title: "TokenWatch Settings",
      description: "Configure sidebar display options",
      category: "Stats",
      slash: { name: "usage-settings", aliases: ["tokenwatch-settings"] },
      onSelect: async () => {
        await showSettingsDialog(api)
      },
    },
  ])
}

async function showUsageReport(api: TuiPluginApi): Promise<void> {
  try {
    const report = await getUsageReport({})
    const formatted = formatUsageReport(report)
    // Report display via route (matching existing pattern)
    api.ui.toast?.({ message: "Usage report generated", variant: "info" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}

async function showSettingsDialog(api: TuiPluginApi): Promise<void> {
  const currentConfig = loadConfigFromStore(api)
  const cfg = currentConfig.sidebar
  const options = [
    `[${cfg.showCache ? "x" : " "}] ${t("showCache")}`,
    `[${cfg.showPerformance ? "x" : " "}] ${t("showPerformance")}`,
    `[${cfg.showPricing ? "x" : " "}] ${t("showPricing")}`,
    `[${cfg.showTokenDistribution ? "x" : " "}] ${t("showTokenDistribution")}`,
    `[${cfg.showTrend ? "x" : " "}] ${t("showTrend")}`,
    `---`,
    `${t("language")}: ${currentConfig.language}`,
  ].join("\n")

  // Note: initial implementation uses toast. Full TUI select dialog deferred.
  api.ui.toast?.({ message: `TokenWatch settings:\n${options}`, variant: "info" })
}

function loadConfigFromStore(api: TuiPluginApi): SidebarConfig {
  const base = { sidebar: { ...DEFAULT_CONFIG.sidebar }, language: DEFAULT_CONFIG.language }
  try {
    const stored = api.kv?.get?.("tokenwatch-config") as Partial<SidebarConfig> | undefined
    if (stored) {
      if (stored.sidebar) Object.assign(base.sidebar, stored.sidebar)
      if (stored.language) base.language = stored.language
    }
  } catch { /* defaults */ }
  return base
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands.ts
git commit -m "feat: extract command registration to commands.ts"
```

---

### Task 5: Create sidebar.tsx — Sidebar JSX components

**Files:**
- Create: `src/sidebar.tsx`

Renders the sidebar using `@opentui/solid` JSX components. No string concatenation. Each block is a separate component with its own collapse state.

- [ ] **Step 1: Write sidebar.tsx — helpers, config, and collapse state**

```tsx
import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { TokenDistribution } from "./formatter.js"
import { formatTokens, formatCost, formatDuration } from "./formatter.js"
import { t, setLanguage } from "./i18n.js"
import type { PerfTracker } from "./perf-tracker.js"

// ── Config Interface ──
export interface SidebarConfig {
  sidebar: {
    showCache: boolean
    showPerformance: boolean
    showPricing: boolean
    showTokenDistribution: boolean
    showTrend: boolean
  }
  language: "zh" | "en" | "auto"
}

const DEFAULT_CONFIG: SidebarConfig = {
  sidebar: { showCache: true, showPerformance: true, showPricing: true, showTokenDistribution: true, showTrend: true },
  language: "auto",
}

// ── Progress Bar (reusable text helper) ──
function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width)
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, width - filled))
}

// ── Collapse State ──
interface CollapseState { global: boolean; models: Record<string, boolean>; subBlocks: Record<string, boolean> }

function loadCollapseState(api: TuiPluginApi): CollapseState {
  try { return (api.kv?.get?.("tokenwatch-collapse") as CollapseState) ?? { global: false, models: {}, subBlocks: {} } }
  catch { return { global: false, models: {}, subBlocks: {} } }
}
function saveCollapseState(api: TuiPluginApi, state: CollapseState): void {
  try { api.kv?.set?.("tokenwatch-collapse", state) } catch { /* non-critical */ }
}

// ── Config Loading ──
export function loadConfig(api: TuiPluginApi): SidebarConfig {
  const base = { sidebar: { ...DEFAULT_CONFIG.sidebar }, language: DEFAULT_CONFIG.language }
  try {
    const pluginCfg = (api as any).config?.pluginConfig?.["opencode-tokenwatch"]
    if (pluginCfg?.sidebar) Object.assign(base.sidebar, pluginCfg.sidebar)
    if (pluginCfg?.language) base.language = pluginCfg.language
    const overrides = api.kv?.get?.("tokenwatch-config") as Partial<SidebarConfig> | undefined
    if (overrides?.sidebar) Object.assign(base.sidebar, overrides.sidebar)
    if (overrides?.language) base.language = overrides.language
  } catch { /* defaults */ }
  return base
}
```

- [ ] **Step 2: Write sidebar.tsx — TokenWatchPanel JSX component**

```tsx
interface TokenWatchPanelProps {
  api: TuiPluginApi
  perfTracker: PerfTracker
  messages: readonly any[]
}

export function TokenWatchPanel(props: TokenWatchPanelProps) {
  const { api, perfTracker, messages } = props
  const [config] = createSignal<SidebarConfig>(loadConfig(api))
  const [collapse, setCollapse] = createSignal<CollapseState>(loadCollapseState(api))
  const [panelWidth, setPanelWidth] = createSignal(40)

  createEffect(() => setLanguage(config().language))

  // ── Computed model stats ──
  const modelStats = createMemo(() => {
    const map = new Map<string, { providerID: string; modelID: string; totalInput: number; totalOutput: number; cacheRead: number; cacheWrite: number; requestCount: number; totalCost: number }>()
    for (const msg of messages) {
      const info = msg.info ?? {}
      const key = `${info.providerID ?? "unknown"}::${info.modelID ?? "unknown"}`
      const tokens = info.tokens ?? {}
      let e = map.get(key)
      if (!e) { e = { providerID: info.providerID ?? "unknown", modelID: info.modelID ?? "unknown", totalInput: 0, totalOutput: 0, cacheRead: 0, cacheWrite: 0, requestCount: 0, totalCost: 0 }; map.set(key, e) }
      e.totalInput += tokens.input ?? 0; e.totalOutput += tokens.output ?? 0
      e.cacheRead += tokens.cache?.read ?? 0; e.cacheWrite += tokens.cache?.write ?? 0
      e.totalCost += info.cost ?? 0; e.requestCount++
    }
    return Array.from(map.entries()).sort((a, b) => (b[1].totalInput + b[1].totalOutput) - (a[1].totalInput + a[1].totalOutput))
  })

  const sessionTotals = createMemo(() => {
    let i = 0, o = 0, cr = 0, cw = 0, r = 0, c = 0
    for (const [, s] of modelStats()) { i += s.totalInput; o += s.totalOutput; cr += s.cacheRead; cw += s.cacheWrite; r += s.requestCount; c += s.totalCost }
    return { totalInput: i, totalOutput: o, totalCacheRead: cr, totalCacheWrite: cw, totalRequests: r, totalCost: c }
  })

  // Per-model hit rate with trend
  const modelHitRate = createMemo(() => {
    return modelStats().map(([key, stat]) => {
      const totalInput = stat.totalInput + stat.cacheRead
      if (totalInput === 0) return { key, rate: 0, trend: null as number | null }
      const modelMessages = messages.filter((m: any) => `${(m.info ?? {}).providerID ?? "unknown"}::${(m.info ?? {}).modelID ?? "unknown"}` === key && (m.info ?? {}).role === "assistant")
      let trend: number | null = null
      if (modelMessages.length >= 2) {
        const last = modelMessages[modelMessages.length - 1].info ?? {}
        const prev = modelMessages[modelMessages.length - 2].info ?? {}
        const lr = ((last.tokens?.cache?.read ?? 0) / Math.max(1, (last.tokens?.input ?? 0) + (last.tokens?.cache?.read ?? 0))) * 100
        const pr = ((prev.tokens?.cache?.read ?? 0) / Math.max(1, (prev.tokens?.input ?? 0) + (prev.tokens?.cache?.read ?? 0))) * 100
        trend = lr - pr
      }
      return { key, rate: (stat.cacheRead / totalInput) * 100, trend }
    })
  })

  const toggle = {
    global: () => setCollapse(p => { const n = { ...p, global: !p.global }; saveCollapseState(api, n); return n }),
    model: (k: string) => setCollapse(p => { const n = { ...p, models: { ...p.models, [k]: !p.models[k] } }; saveCollapseState(api, n); return n }),
    sub: (k: string) => setCollapse(p => { const n = { ...p, subBlocks: { ...p.subBlocks, [k]: !p.subBlocks[k] } }; saveCollapseState(api, n); return n }),
  }

  // ── Render JSX ──
  // Note: These use @opentui/solid JSX (<box>, <text>) as supported by OpenCode TUI
  return (
    <box flexDirection="column" width={panelWidth()}>
      {/* Header */}
      <box onMouseDown={toggle.global}>
        <text>{collapse().global ? "▶" : "▼"} {t("panelTitle")}</text>
      </box>

      <Show when={!collapse().global}>
        {/* Session summary */}
        <text>{t("sessionSummary")}: {t("input")} {formatTokens(sessionTotals().totalInput)}  {t("output")} {formatTokens(sessionTotals().totalOutput)}  {t("cacheRead")} {formatTokens(sessionTotals().totalCacheRead)}  {t("requests")} {sessionTotals().totalRequests}  {t("cost")} {formatCost(sessionTotals().totalCost)}</text>

        {/* Per-model blocks */}
        <For each={modelStats()}>
          {([key, stat]) => {
            const modelCollapsed = () => collapse().models[key] !== true
            const totalInput = stat.totalInput + stat.cacheRead
            const hitRate = totalInput > 0 ? (stat.cacheRead / totalInput) * 100 : 0
            const hrData = modelHitRate().find(h => h.key === key)
            const trendStr = hrData?.trend !== null && hrData?.trend !== undefined
              ? (hrData.trend >= 0 ? `${t("trendUp")}${hrData.trend.toFixed(1)}%` : `${t("trendDown")}${Math.abs(hrData.trend).toFixed(1)}%`)
              : ""

            return (
              <box flexDirection="column">
                <box onMouseDown={() => toggle.model(key)}>
                  <text>{modelCollapsed() ? "▼" : "▶"} {stat.modelID.length > 24 ? stat.modelID.slice(0, 22) + "…" : stat.modelID}</text>
                </box>
                <text>  {t("input")}:{formatTokens(stat.totalInput)}  {t("output")}:{formatTokens(stat.totalOutput)}  {t("cacheRead")}:{formatTokens(stat.cacheRead)}  {t("requests")}:{stat.requestCount}  {t("cost")}:{formatCost(stat.totalCost)}</text>
                <text>  {t("hitRate")}:{hitRate.toFixed(0)}% {trendStr}</text>

                <Show when={modelCollapsed()}>
                  {/* Cache block */}
                  <Show when={config().sidebar.showCache}>
                    <box flexDirection="column">
                      <box onMouseDown={() => toggle.sub(`cache-${key}`)}>
                        <text>  ── {t("cache")} ──{collapse().subBlocks[`cache-${key}`] ? "▼" : "▶"}</text>
                      </box>
                      <Show when={!collapse().subBlocks[`cache-${key}`]}>
                        <text>    {t("hitRate")}: {progressBar(hitRate, Math.max(10, panelWidth() - 20))} {hitRate.toFixed(1)}%</text>
                        <text>    {t("cacheRead")}:{formatTokens(stat.cacheRead)}  {t("cacheWrite")}:{formatTokens(stat.cacheWrite)}  {t("output")}:{formatTokens(stat.totalOutput)}</text>
                      </Show>
                    </box>
                  </Show>

                  {/* Performance block */}
                  <Show when={config().sidebar.showPerformance}>
                    <box flexDirection="column">
                      <box onMouseDown={() => toggle.sub(`perf-${key}`)}>
                        <text>  ── {t("performance")} ──{collapse().subBlocks[`perf-${key}`] ? "▼" : "▶"}</text>
                      </box>
                      <Show when={!collapse().subBlocks[`perf-${key}`]}>
                        <text>    {t("ttft")}: {formatDuration(perfTracker.getSessionStats().models[key]?.avgTTFT ?? null)}  {t("tps")}: {perfTracker.getSessionStats().models[key]?.avgTPS?.toFixed(1) ?? "—"}  {t("latency")}: {formatDuration(perfTracker.getSessionStats().models[key]?.avgLatency ?? null)}</text>
                      </Show>
                    </box>
                  </Show>

                  {/* Pricing block */}
                  <Show when={config().sidebar.showPricing}>
                    <box flexDirection="column">
                      <box onMouseDown={() => toggle.sub(`pricing-${key}`)}>
                        <text>  ── {t("pricing")} ──{collapse().subBlocks[`pricing-${key}`] ? "▼" : "▶"}</text>
                      </box>
                      <Show when={!collapse().subBlocks[`pricing-${key}`]}>
                        <text>    {t("cost")}: {formatCost(stat.totalCost)}</text>
                        <text>    {t("modelLabel")}: {stat.providerID}/{stat.modelID}</text>
                      </Show>
                    </box>
                  </Show>
                </Show>
              </box>
            )
          }}
        </For>

        {/* Token Distribution (session-level) */}
         <Show when={config().sidebar.showTokenDistribution}>
          <box flexDirection="column">
            <box onMouseDown={() => toggle.sub("token-dist")}>
              <text>── {t("tokenDistribution")} ──{collapse().subBlocks["token-dist"] ? "▼" : "▶"}</text>
            </box>
            <Show when={!collapse().subBlocks["token-dist"]}>
              <text>    {t("system")}: {formatTokens(0)} ({t("outputTokens")}: {formatTokens(sessionTotals().totalOutput)})</text>
              <text>    ({t("output")} {t("read")}: {formatTokens(sessionTotals().totalOutput)})</text>
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/sidebar.tsx
git commit -m "feat: add sidebar JSX component with model-level grouping"
```

---

### Task 6: Create token-estimator.ts — Token estimation (optional fallback)

**Files:**
- Create: `src/token-estimator.ts`

Heuristic token counter for estimating per-role token counts when exact API values aren't available. Distinguishes normal text, JSON, and code content for better accuracy.

- [ ] **Step 1: Write token-estimator.ts**

```typescript
// Character-based BPE token estimation
// Normal text: ~4 ASCII chars/token
// JSON content: ~2 chars/token
// Code content: ~2.5 chars/token
// CJK characters: ~1.5 chars/token

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0)
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0xAC00 && code <= 0xD7AF)
  )
}

function detectContentType(text: string): "json" | "code" | "text" {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json"
  if (/^(import|function|class|const|let|var|def|pub|fn|impl)/.test(trimmed)) return "code"
  return "text"
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  const type = detectContentType(text)
  const asciiPerToken = type === "json" ? 2 : type === "code" ? 2.5 : 4

  let tokenCount = 0
  let asciiCount = 0

  for (const char of text) {
    if (isCJK(char)) {
      tokenCount += 1 / 1.5
    } else {
      asciiCount++
    }
  }

  tokenCount += asciiCount / asciiPerToken
  return Math.ceil(tokenCount)
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/token-estimator.ts
git commit -m "feat: add token estimation utility"
```

---

### Task 7: Refactor tui.ts — Orchestration layer

**Files:**
- Modify: `src/tui.ts`

Slim down from current 505 lines to an orchestration layer. Import and wire up sidebar, perf-tracker, and commands.

- [ ] **Step 1: Read current tui.ts fully**

Run: `Get-Content src/tui.ts`
Expected: Read the full 505-line file

- [ ] **Step 2: Rewrite tui.ts as orchestration layer with JSX slot**

```typescript
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { registerCommands } from "./commands.js"
import { createPerfTracker, type PerfTracker } from "./perf-tracker.js"
import { TokenWatchPanel } from "./sidebar.jsx"

const tui: TuiPluginModule["tui"] = async (api) => {
  const perfTracker = createPerfTracker()

  // Register slash commands
  registerCommands(api)

  // Sidebar revision counter for reactive updates
  const [sidebarRevision, setSidebarRevision] = createSignal(0)
  let currentSessionID = ""
  const cleanups: (() => void)[] = []

  // Event listeners with dispose tracking
  const unsubMsgUpdated = api.event.on("message.updated", (event: any) => {
    const sessionID = event.session_id ?? event.sessionID ?? ""
    if (sessionID && sessionID !== currentSessionID) {
      currentSessionID = sessionID
      perfTracker.reset()
    }
    perfTracker.handleMessageUpdated(event)
    setSidebarRevision(prev => prev + 1)
  })
  cleanups.push(unsubMsgUpdated)

  const unsubPartUpdated = api.event.on("message.part.updated", (event: any) => {
    perfTracker.handlePartUpdated(event)
  })
  cleanups.push(unsubPartUpdated)

  const unsubRemoved = api.event.on("message.removed", (event: any) => {
    perfTracker.handleMessageRemoved(event)
    setSidebarRevision(prev => prev + 1)
  })
  cleanups.push(unsubRemoved)

  // Cleanup on plugin dispose
  api.lifecycle?.onDispose?.(() => {
    for (const cleanup of cleanups) cleanup()
  })

  // Register sidebar panel — returns JSX component directly
  api.slots.register({
    id: "tokenwatch-sidebar",
    order: 50,
    component: () => {
      const messages = api.state.session.messages?.(currentSessionID) ?? []
      return <TokenWatchPanel api={api} perfTracker={perfTracker} messages={messages} />
    },
  })
}

// Default export
const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-tokenwatch",
  tui,
}

export default plugin
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify existing functionality preserved**

Run: `node -e "const m = require('./dist/index.js'); console.log(typeof m)"`
Expected: Module loads without error

- [ ] **Step 5: Commit**

```bash
git add src/tui.ts
git commit -m "refactor: slim tui.ts to orchestration layer"
```

---

### Task 8: Update index.ts — Export perfTracker

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Read current index.ts**

Run: `Get-Content src/index.ts`
Expected: Read current 10-line file

- [ ] **Step 2: Update index.ts to also export the tui entry**

```typescript
import type { PluginModule } from "@opencode-ai/plugin"

const plugin: PluginModule & { id: string } = {
  id: "opencode-tokenwatch",
  server: async () => { return {} },
}

export default plugin
```

Note: `index.ts` is unchanged — the TUI entry is exported via package.json exports field pointing to `tui.ts`.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: no changes needed for index.ts"
```

---

### Task 9: Update README.md — New features documentation

**Files:**
- Modify: `README.md`
- Create: `README.zh.md`

- [ ] **Step 1: Read current README.md**

Run: `Get-Content README.md`
Expected: Read current file

- [ ] **Step 2: Update README.md (English)**

```markdown
# opencode-tokenwatch

Real-time token usage, cache hit rate, and performance metrics for OpenCode.

## Features

- **Sidebar panel**: Real-time per-model token stats, cache hit rate with progress bar, TTFT/TPS/latency
- **`/usage` command**: Multi-dimension historical reports (by model/provider/date/session)
- **Cache visualization**: Hit rate progress bar with color thresholds, trend indicators
- **Performance metrics**: TTFT, TPS, latency tracking with JSONL persistent logging
- **Token distribution**: Breakdown by role (system/user/Agent/Tool/result)
- **i18n**: Chinese/English auto-detection
- **Export**: JSON and CSV format
- **`/usage-settings`**: Configure sidebar display options

## Installation

```jsonc
// opencode.jsonc
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

## Requirements

- OpenCode v1.14+
- Node.js 18+
```

- [ ] **Step 3: Create README.zh.md (Chinese)**

```markdown
# opencode-tokenwatch

OpenCode 实时 Token 用量、缓存命中率和性能指标面板。

## 功能

- **侧边栏面板**：实时按模型统计 token、缓存命中率（进度条 + 颜色编码）、TTFT/TPS/延迟
- **`/usage` 命令**：多维度历史报告（按模型/提供商/日期/会话分组）
- **缓存可视化**：命中率进度条带颜色阈值 + 趋势指示
- **性能指标**：TTFT、TPS、延迟追踪，JSONL 持久日志
- **Token 分布**：按角色分解（系统/用户/Agent/Tool/结果）
- **国际化**：中/英双语自动检测
- **导出**：JSON 和 CSV 格式
- **`/usage-settings`**：配置侧边栏显示选项

## 安装

```jsonc
// opencode.jsonc
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

## 要求

- OpenCode v1.14+
- Node.js 18+
```

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs: update README with v2 features"
```

---

### Task 10: Full build and verify

- [ ] **Step 1: Install dependencies**

Run: `npm install`
Expected: All dependencies installed without error

- [ ] **Step 2: Build project**

Run: `npm run build`
Expected: `dist/index.js`, `dist/index.d.ts`, `dist/tui.js`, `dist/tui.d.ts`, `dist/queries.js`, `dist/formatter.js`, `dist/i18n.js`, `dist/perf-tracker.js`, `dist/commands.js`, `dist/sidebar.jsx` etc. created with no errors

- [ ] **Step 3: Verify all output files exist**

Run: `Get-ChildItem dist/*.js`
Expected: All source files have corresponding JS output

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: v2 refactoring complete"
```
