export interface UsageFilters {
  sessionId?: string
  model?: string
  provider?: string
  startDate?: string
  endDate?: string
  limit?: number
}

export interface SessionTokenData {
  model: string
  provider: string
  modelsUsed: string[]
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  totalCost: number
  requestCount: number
}

export interface ModelBreakdownItem {
  provider: string
  model: string
  requests: number
  sessions: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
}

export interface ProviderBreakdownItem {
  provider: string
  requests: number
  sessions: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
}

export interface DailyBreakdownItem {
  day: string
  requests: number
  sessions: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
}

export interface SessionBreakdownItem {
  sessionId: string
  title: string
  provider: string
  model: string
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
  day: string
}

export interface UsageReport {
  filters: UsageFilters
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  providers: ProviderBreakdownItem[]
  daily: DailyBreakdownItem[]
  sessions: SessionBreakdownItem[]
}

interface Column {
  label: string
  align: "left" | "right"
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

export function formatFilters(filters: UsageFilters): string {
  const parts: string[] = []
  if (filters.sessionId) parts.push(`session=${filters.sessionId}`)
  if (filters.provider) parts.push(`provider=${filters.provider}`)
  if (filters.model) parts.push(`model=${filters.model}`)
  if (filters.startDate || filters.endDate) {
    parts.push(`date=${filters.startDate ?? "..."}..${filters.endDate ?? "..."}`)
  }
  return parts.length ? parts.join(" | ") : "scope=all local sessions"
}

function getVisualWidth(str: string): number {
  let width = 0
  for (let i = 0; i < str.length; i++) {
    width += str.charCodeAt(i) > 255 ? 2 : 1
  }
  return width
}

function truncateByWidth(str: string, maxWidth: number): string {
  if (getVisualWidth(str) <= maxWidth) return str
  let width = 0
  let res = ""
  for (let i = 0; i < str.length; i++) {
    const charWidth = str.charCodeAt(i) > 255 ? 2 : 1
    if (width + charWidth > maxWidth - 3) {
      return res + "..."
    }
    width += charWidth
    res += str[i]
  }
  return res
}

function table(columns: Column[], rows: string[][], totalRow?: string[]): string {
  const widths = columns.map((col, i) => {
    const rowWidths = rows.map((row) => getVisualWidth(row[i] ?? ""))
    const maxRow = rowWidths.length ? Math.max(...rowWidths) : 0
    const totalWidth = totalRow ? getVisualWidth(totalRow[i] ?? "") : 0
    return Math.max(getVisualWidth(col.label), maxRow, totalWidth)
  })

  const renderRow = (cells: string[]) =>
    "║" + cells.map((cell, i) => {
      const value = cell ?? ""
      const vWidth = getVisualWidth(value)
      const padding = " ".repeat(widths[i] - vWidth)
      const content = columns[i].align === "right"
        ? padding + value
        : value + padding
      return ` ${content} ║`
    }).join("")

  const sep = (left: string, mid: string, right: string, fill: string) =>
    left + widths.map((w) => fill.repeat(w + 2)).join(mid) + right

  const lines = [
    sep("╔", "╦", "╗", "═"),
    renderRow(columns.map((col) => col.label)),
    sep("╠", "╬", "╣", "═"),
    ...rows.map(renderRow),
  ]

  if (totalRow) {
    lines.push(sep("╠", "╬", "╣", "═"))
    lines.push(renderRow(totalRow))
  }

  lines.push(sep("╚", "╩", "╝", "═"))
  return lines.join("\n")
}

export function formatSessionSummary(data: SessionTokenData, title = "Current Session"): string {
  const modelLabel = data.modelsUsed.length > 1
    ? `${data.modelsUsed.length} models`
    : data.model || "(unknown)"

  return [
    `═══ ${title} ═══`,
    `Models:        ${modelLabel}`,
    `Provider:      ${data.provider || "(mixed)"}`,
    `Requests:      ${data.requestCount}`,
    `Total Tokens:  ${formatTokens(data.totalTokens)}`,
    `  Input:       ${formatTokens(data.inputTokens)}`,
    `  Output:      ${formatTokens(data.outputTokens)}`,
    `  Reasoning:   ${formatTokens(data.reasoningTokens)}`,
    `  Cache Read:  ${formatTokens(data.cacheRead)}`,
    `  Cache Write: ${formatTokens(data.cacheWrite)}`,
    `  Cost:        ${formatCost(data.totalCost)}`,
  ].join("\n")
}

export function formatStatusBar(data: SessionTokenData): string {
  return `Tok:${formatTokens(data.totalTokens)} Req:${data.requestCount} Cost:${formatCost(data.totalCost)}`
}

export function formatModelBreakdown(items: ModelBreakdownItem[]): string {
  if (items.length === 0) return "═══ Model Breakdown ═══\n(no data)"

  const total = items.reduce((acc, item) => ({
    requests: acc.requests + item.requests,
    totalTokens: acc.totalTokens + item.totalTokens,
    inputTokens: acc.inputTokens + item.inputTokens,
    outputTokens: acc.outputTokens + item.outputTokens,
    cacheRead: acc.cacheRead + item.cacheRead,
  }), {
    requests: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
  })

  const rows = items.map((item) => [
    item.provider || "-",
    truncateByWidth(item.model, 20),
    String(item.requests),
    formatTokens(item.totalTokens),
    formatTokens(item.inputTokens),
    formatTokens(item.outputTokens),
    formatTokens(item.cacheRead),
  ])

  return [
    "═══ Model Breakdown ═══",
    table([
      { label: "Provider", align: "left" },
      { label: "Model", align: "left" },
      { label: "Req", align: "right" },
      { label: "Total", align: "right" },
      { label: "In", align: "right" },
      { label: "Out", align: "right" },
      { label: "Cache", align: "right" },
    ], rows, [
      "TOTAL",
      "",
      String(total.requests),
      formatTokens(total.totalTokens),
      formatTokens(total.inputTokens),
      formatTokens(total.outputTokens),
      formatTokens(total.cacheRead),
    ]),
  ].join("\n")
}

export function formatProviderBreakdown(items: ProviderBreakdownItem[]): string {
  if (items.length === 0) return "═══ Provider Breakdown ═══\n(no data)"

  const total = items.reduce((acc, item) => ({
    requests: acc.requests + item.requests,
    totalTokens: acc.totalTokens + item.totalTokens,
    inputTokens: acc.inputTokens + item.inputTokens,
    outputTokens: acc.outputTokens + item.outputTokens,
    cacheRead: acc.cacheRead + item.cacheRead,
  }), {
    requests: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
  })

  const rows = items.map((item) => [
    item.provider || "-",
    String(item.requests),
    formatTokens(item.totalTokens),
    formatTokens(item.inputTokens),
    formatTokens(item.outputTokens),
    formatTokens(item.cacheRead),
  ])

  return [
    "═══ Provider Breakdown ═══",
    table([
      { label: "Provider", align: "left" },
      { label: "Req", align: "right" },
      { label: "Total", align: "right" },
      { label: "In", align: "right" },
      { label: "Out", align: "right" },
      { label: "Cache", align: "right" },
    ], rows, [
      "TOTAL",
      String(total.requests),
      formatTokens(total.totalTokens),
      formatTokens(total.inputTokens),
      formatTokens(total.outputTokens),
      formatTokens(total.cacheRead),
    ]),
  ].join("\n")
}

export function formatDailyBreakdown(items: DailyBreakdownItem[]): string {
  if (items.length === 0) return "═══ Daily Breakdown ═══\n(no data)"

  const total = items.reduce((acc, item) => ({
    requests: acc.requests + item.requests,
    totalTokens: acc.totalTokens + item.totalTokens,
    inputTokens: acc.inputTokens + item.inputTokens,
    outputTokens: acc.outputTokens + item.outputTokens,
    cacheRead: acc.cacheRead + item.cacheRead,
  }), {
    requests: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
  })

  const rows = items.map((item) => [
    item.day,
    String(item.requests),
    formatTokens(item.totalTokens),
    formatTokens(item.inputTokens),
    formatTokens(item.outputTokens),
    formatTokens(item.cacheRead),
  ])

  return [
    "═══ Daily Breakdown ═══",
    table([
      { label: "Day", align: "left" },
      { label: "Req", align: "right" },
      { label: "Total", align: "right" },
      { label: "In", align: "right" },
      { label: "Out", align: "right" },
      { label: "Cache", align: "right" },
    ], rows, [
      "TOTAL",
      String(total.requests),
      formatTokens(total.totalTokens),
      formatTokens(total.inputTokens),
      formatTokens(total.outputTokens),
      formatTokens(total.cacheRead),
    ]),
  ].join("\n")
}

export function formatSessionBreakdown(items: SessionBreakdownItem[]): string {
  if (items.length === 0) return "═══ Session Breakdown ═══\n(no data)"

  const rows = items.map((item) => {
    // Truncate title by visual width (40 columns)
    const title = truncateByWidth(item.title, 40)
    return [
      item.day,
      item.provider || "-",
      truncateByWidth(item.model, 20),
      String(item.requests),
      formatTokens(item.totalTokens),
      formatTokens(item.cacheRead),
      title,
    ]
  })

  return [
    "═══ Session Breakdown ═══",
    table([
      { label: "Day", align: "left" },
      { label: "Provider", align: "left" },
      { label: "Model", align: "left" },
      { label: "Req", align: "right" },
      { label: "Total", align: "right" },
      { label: "Cache", align: "right" },
      { label: "Title", align: "left" },
    ], rows),
  ].join("\n")
}

export function formatUsageReport(report: UsageReport): string {
  return [
    `Filters: ${formatFilters(report.filters)}`,
    "",
    formatSessionSummary(report.summary, "Usage Summary"),
    "",
    formatModelBreakdown(report.models),
    "",
    formatProviderBreakdown(report.providers),
    "",
    formatDailyBreakdown(report.daily),
    "",
    formatSessionBreakdown(report.sessions),
  ].join("\n")
}

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

// ── HTML report types ──

export interface HtmlReportMeta {
  generatedAt: string
  dateRange: { start: string; end: string }
}

export interface CombinedReportData {
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  providers: ProviderBreakdownItem[]
  daily: DailyBreakdownItem[]
  sessions: SessionBreakdownItem[]
  perfLogs: LogEntry[]
  perfSummary: ModelPerfStats[]
  meta: HtmlReportMeta
}
