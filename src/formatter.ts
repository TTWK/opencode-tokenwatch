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
  sessions: number
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
      `  ${m.model.padEnd(30)} ${String(m.requests).padStart(4)} req ${String(m.sessions).padStart(3)} ses ${formatTokens(m.totalTokens).padStart(8)} tok ${formatCost(m.totalCost)}`,
  )
  return ["Model Breakdown:", ...lines].join("\n")
}

export interface DailyBreakdownItem {
  day: string
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
}

export function formatDailyBreakdown(items: DailyBreakdownItem[]): string {
  if (items.length === 0) return "No daily data"
  const lines = items.map(
    (d) =>
      `  ${d.day.padEnd(12)} ${String(d.requests).padStart(4)} req ${formatTokens(d.totalTokens).padStart(8)} tok ${formatCost(d.totalCost)}`,
  )
  return ["Daily Breakdown (last 10 days):", ...lines].join("\n")
}
