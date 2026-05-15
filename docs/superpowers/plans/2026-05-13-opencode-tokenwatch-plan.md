# opencode-tokenwatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opencode TUI Plugin that provides `/usage` slash command with real-time token tracking and a status bar indicator.

**Architecture:** TUI Plugin (v1) uses `default export { id, tui }` pattern. The `tui(api)` function registers a `/usage` command via `api.command.register()` with `slash` + `onSelect`. Data comes from `api.client.session.*` SDK methods. Real-time tracking via `api.event.on('message.updated')`. Display via built-in `api.ui.Dialog` and `api.slots.register()`.

**Tech Stack:** TypeScript, @opencode-ai/plugin (types only), opencode TUI Plugin API (runtime)

---

## File Structure

```
D:\not_work_space\github\opencode-tokenwatch/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── src/
│   ├── index.ts          # default export { id: "opencode-tokenwatch", tui }
│   ├── commands.ts       # registerCommands(api) — registers /usage
│   ├── tracker.ts        # TokenTracker class — real-time accumulation
│   ├── queries.ts        # SDK-based session/message data queries
│   ├── formatter.ts      # Pure utility: formatTokens, formatCost, etc.
│   └── panel.ts          # showUsageDialog(api, data), setupStatusBar(api, tracker)
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `D:\not_work_space\github\opencode-tokenwatch\package.json`
- Create: `D:\not_work_space\github\opencode-tokenwatch\tsconfig.json`
- Create: `D:\not_work_space\github\opencode-tokenwatch\.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "opencode-tokenwatch",
  "version": "0.1.0",
  "description": "Real-time token usage tracking plugin for opencode",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    "./tui": "./dist/index.js"
  },
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["opencode", "plugin", "tokens", "usage", "stats"],
  "license": "MIT",
  "devDependencies": {
    "@opencode-ai/plugin": "latest",
    "typescript": "^5.7.0"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

---

### Task 2: formatter.ts — Token formatting utilities

**Files:**
- Create: `src/formatter.ts`

Pure utility functions with no runtime dependencies.

- [ ] **Step 1: Write formatter.ts**

```typescript
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export interface SessionTokenData {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  totalCost: number
  requestCount: number
}

export function formatSessionSummary(data: SessionTokenData): string {
  return [
    `Requests:      ${data.requestCount}`,
    `Total Tokens:  ${formatTokens(data.totalTokens)}`,
    `  Input:       ${formatTokens(data.inputTokens)}`,
    `  Output:      ${formatTokens(data.outputTokens)}`,
    `  Reasoning:   ${formatTokens(data.reasoningTokens)}`,
    `  Cache Read:  ${formatTokens(data.cacheRead)}`,
    `  Cost:        ${formatCost(data.totalCost)}`,
  ].join("\n")
}

export function formatStatusBar(data: SessionTokenData): string {
  return `Tok:${formatTokens(data.totalTokens)} Cost:${formatCost(data.totalCost)}`
}

export interface ModelBreakdownItem {
  model: string
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheRead: number
  totalCost: number
}

export function formatModelBreakdown(items: ModelBreakdownItem[]): string {
  if (items.length === 0) return "No model data"
  const lines = items.map(
    (m) =>
      `  ${m.model.padEnd(30)} ${String(m.requests).padStart(4)} req ${formatTokens(m.totalTokens).padStart(8)} tok ${formatCost(m.totalCost)}`,
  )
  return ["Model Breakdown:", ...lines].join("\n")
}
```

---

### Task 3: queries.ts — SDK data queries

**Files:**
- Create: `src/queries.ts`

Uses `api.client` (opencode SDK) to query session and message data.

- [ ] **Step 1: Write queries.ts**

```typescript
import type { SessionTokenData, ModelBreakdownItem } from "./formatter.js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

interface RawMessageTokens {
  total?: number
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

interface RawMessageData {
  tokens?: RawMessageTokens
  cost?: number
  modelID?: string
  providerID?: string
}

export async function getSessionStats(
  client: TuiPluginApi["client"],
  sessionId: string,
): Promise<SessionTokenData> {
  const result = await client.session.messages({ path: { id: sessionId } })
  const data: SessionTokenData = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalCost: 0,
    requestCount: 0,
  }

  for (const msg of result.data ?? []) {
    const raw = parseMessageData(msg.info?.data)
    if (!raw?.tokens?.total || raw.tokens.total <= 0) continue
    data.totalTokens += raw.tokens.total ?? 0
    data.inputTokens += raw.tokens.input ?? 0
    data.outputTokens += raw.tokens.output ?? 0
    data.reasoningTokens += raw.tokens.reasoning ?? 0
    data.cacheRead += raw.tokens.cache?.read ?? 0
    data.cacheWrite += raw.tokens.cache?.write ?? 0
    data.totalCost += raw.cost ?? 0
    data.requestCount++
  }

  return data
}

export async function getHistoricalStats(
  client: TuiPluginApi["client"],
  maxSessions = 50,
): Promise<SessionTokenData> {
  const sessions = await client.session.list()
  const recentSessions = (sessions.data ?? []).slice(0, maxSessions)

  const data: SessionTokenData = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalCost: 0,
    requestCount: 0,
  }

  for (const session of recentSessions) {
    const stats = await getSessionStats(client, session.id)
    data.totalTokens += stats.totalTokens
    data.inputTokens += stats.inputTokens
    data.outputTokens += stats.outputTokens
    data.reasoningTokens += stats.reasoningTokens
    data.cacheRead += stats.cacheRead
    data.cacheWrite += stats.cacheWrite
    data.totalCost += stats.totalCost
    data.requestCount += stats.requestCount
  }

  return data
}

export async function getModelBreakdown(
  client: TuiPluginApi["client"],
  maxSessions = 50,
): Promise<ModelBreakdownItem[]> {
  const sessions = await client.session.list()
  const recentSessions = (sessions.data ?? []).slice(0, maxSessions)
  const modelMap = new Map<string, ModelBreakdownItem>()

  for (const session of recentSessions) {
    const result = await client.session.messages({ path: { id: session.id } })
    for (const msg of result.data ?? []) {
      const raw = parseMessageData(msg.info?.data)
      if (!raw?.tokens?.total || raw.tokens.total <= 0) continue
      const model = raw.modelID ?? "unknown"
      let item = modelMap.get(model)
      if (!item) {
        item = {
          model,
          requests: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          totalCost: 0,
        }
        modelMap.set(model, item)
      }
      item.requests++
      item.totalTokens += raw.tokens.total ?? 0
      item.inputTokens += raw.tokens.input ?? 0
      item.outputTokens += raw.tokens.output ?? 0
      item.cacheRead += raw.tokens.cache?.read ?? 0
      item.totalCost += raw.cost ?? 0
    }
  }

  return Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

function parseMessageData(data: unknown): RawMessageData | null {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as RawMessageData
    } catch {
      return null
    }
  }
  if (data && typeof data === "object") return data as RawMessageData
  return null
}
```

---

### Task 4: tracker.ts — Real-time token tracker

**Files:**
- Create: `src/tracker.ts`

- [ ] **Step 1: Write tracker.ts**

```typescript
import type { SessionTokenData } from "./formatter.js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

interface RawTokens {
  total?: number
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

interface RawEventData {
  tokens?: RawTokens
  cost?: number
}

type OnUpdateCallback = (data: SessionTokenData) => void

export class TokenTracker {
  private currentSession: SessionTokenData = this.emptyData()
  private currentSessionId = ""
  private unsubscribe: (() => void) | null = null

  constructor(
    private api: TuiPluginApi,
    private onUpdate: OnUpdateCallback,
  ) {}

  emptyData(): SessionTokenData {
    return {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalCost: 0,
      requestCount: 0,
    }
  }

  start(): void {
    this.unsubscribe = this.api.event.on("message.updated", (event: any) => {
      const sessionId = event.session_id ?? event.sessionID ?? ""
      if (sessionId && sessionId !== this.currentSessionId) {
        this.currentSessionId = sessionId
        this.currentSession = this.emptyData()
      }
      const raw = this.extractTokens(event)
      if (raw) this.accumulate(raw)
      this.onUpdate(this.currentSession)
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  getCurrentSessionStats(): SessionTokenData {
    return { ...this.currentSession }
  }

  reset(): void {
    this.currentSession = this.emptyData()
  }

  private extractTokens(event: any): RawTokens | null {
    const data = event.data ?? event.message?.data
    if (typeof data === "string") {
      try {
        return (JSON.parse(data) as RawEventData).tokens ?? null
      } catch {
        return null
      }
    }
    if (data?.tokens) return data.tokens as RawTokens
    return null
  }

  private accumulate(tokens: RawTokens): void {
    this.currentSession.totalTokens += tokens.total ?? 0
    this.currentSession.inputTokens += tokens.input ?? 0
    this.currentSession.outputTokens += tokens.output ?? 0
    this.currentSession.reasoningTokens += tokens.reasoning ?? 0
    this.currentSession.cacheRead += tokens.cache?.read ?? 0
    this.currentSession.cacheWrite += tokens.cache?.write ?? 0
    this.currentSession.requestCount++
  }
}
```

---

### Task 5: panel.ts — Stats display

**Files:**
- Create: `src/panel.ts`

- [ ] **Step 1: Write panel.ts**

```typescript
import type { SessionTokenData, ModelBreakdownItem } from "./formatter.js"
import { formatSessionSummary, formatModelBreakdown, formatStatusBar } from "./formatter.js"
import type { TokenTracker } from "./tracker.js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

export interface UsageData {
  currentSession: SessionTokenData
  historical: SessionTokenData
  modelBreakdown: ModelBreakdownItem[]
}

export function showUsageDialog(api: TuiPluginApi, data: UsageData): void {
  const lines = [
    "═══ Current Session ═══",
    formatSessionSummary(data.currentSession),
    "",
    "═══ Historical (50 sessions) ═══",
    formatSessionSummary(data.historical),
    "",
    formatModelBreakdown(data.modelBreakdown),
  ]

  api.ui.DialogAlert?.({
    title: "📊 Token Usage",
    message: lines.join("\n"),
  })
}

export function setupStatusBar(
  api: TuiPluginApi,
  tracker: TokenTracker,
): void {
  const updateStatus = (data: SessionTokenData) => {
    const text = formatStatusBar(data)
    updateSlot(text)
  }

  let currentUnregister: (() => void) | null = null

  function updateSlot(text: string) {
    currentUnregister?.()
    currentUnregister = api.slots.register({
      id: "tokenwatch-status",
      component: () => text,
    })
  }

  tracker.start()
  updateStatus(tracker.getCurrentSessionStats())
}
```

---

### Task 6: commands.ts — Slash command registration

**Files:**
- Create: `src/commands.ts`

- [ ] **Step 1: Write commands.ts**

```typescript
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getHistoricalStats, getModelBreakdown } from "./queries.js"
import { showUsageDialog, type UsageData } from "./panel.js"
import type { TokenTracker } from "./tracker.js"

export function registerCommands(api: TuiPluginApi, tracker: TokenTracker): void {
  api.command.register(() => [
    {
      title: "Token Usage Statistics",
      value: "usage.open",
      description: "Show real-time and historical token usage",
      category: "Stats",
      slash: { name: "usage", aliases: ["tokens", "stats"] },
      onSelect: async () => {
        await handleUsageCommand(api, tracker)
      },
    },
  ])
}

async function handleUsageCommand(api: TuiPluginApi, tracker: TokenTracker): Promise<void> {
  const client = api.client
  if (!client) {
    api.ui.toast?.({ message: "SDK client not available", variant: "error" })
    return
  }

  api.ui.toast?.({ message: "Fetching usage data...", variant: "info" })

  try {
    const [historical, modelBreakdown] = await Promise.all([
      getHistoricalStats(client),
      getModelBreakdown(client),
    ])

    const data: UsageData = {
      currentSession: tracker.getCurrentSessionStats(),
      historical,
      modelBreakdown,
    }

    showUsageDialog(api, data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}
```

---

### Task 7: index.ts — Plugin entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { registerCommands } from "./commands.js"
import { TokenTracker } from "./tracker.js"
import { setupStatusBar } from "./panel.js"
import { formatStatusBar } from "./formatter.js"

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-tokenwatch",
  tui: async (api) => {
    const tracker = new TokenTracker(api, (data) => {
      // Update status bar on each message
      const text = formatStatusBar(data)
      try {
        api.slots.register?.({
          id: "tokenwatch-status",
          component: () => text,
        })
      } catch {
        // slots API may not be available — silently degrade
      }
    })

    registerCommands(api, tracker)
    setupStatusBar(api, tracker)
  },
}

export default plugin
```

---

### Task 8: README.md

- [ ] **Step 1: Create README.md**

Full path: `README.md`

```markdown
# opencode-tokenwatch

A real-time token usage tracking plugin for opencode.

## Features

- **`/usage` slash command** — View current session and historical token stats
- **Real-time tracking** — Automatically tracks tokens as messages arrive
- **Status bar** — Shows live token count (via slots API)
- **Model breakdown** — Per-model token/cost summary

## Installation

```jsonc
// tui.json
{
  "plugins": ["opencode-tokenwatch"]
}
```

Or via CLI:
```
opencode plugin opencode-tokenwatch
```

## Usage

In opencode TUI, type `/usage` to open the stats dialog.

## Requirements

- opencode v1.14+ (TUI Plugin API)
```

---

### Task 9: Build and verify

- [ ] **Step 1: Install dependencies and build**

Run from project root:
```powershell
cd D:\not_work_space\github\opencode-tokenwatch
npm install
npm run build
```
Expected: `dist/index.js`, `dist/index.d.ts`, `dist/formatter.js`, etc. created with no errors.

- [ ] **Step 2: Verify compile output**

Run:
```powershell
Get-ChildItem dist/*.js
```
Expected: All source files compiled to `dist/` directory.

- [ ] **Step 3: Local plugin test (manual)**

1. Copy the compiled plugin to opencode's global plugins dir:
   ```powershell
   New-Item -ItemType Directory -Path "$env:USERPROFILE\.config\opencode\plugins" -Force
   Copy-Item "dist/*" "$env:USERPROFILE\.config\opencode\plugins\opencode-tokenwatch\" -Recurse
   ```
2. Start opencode TUI
3. Type `/usage` — expect dialog to appear with token stats
4. Interact with opencode (send messages) — expect status bar to update
