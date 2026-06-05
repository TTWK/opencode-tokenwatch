import { exec } from "node:child_process"
import type {
  DailyBreakdownItem,
  ErrorStats,
  ModelBreakdownItem,
  ProviderBreakdownItem,
  SessionBreakdownItem,
  SessionTokenData,
  UsageFilters,
  UsageReport,
} from "./formatter.js"

function execAsync(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr }))
      else resolve({ stdout, stderr })
    })
  })
}

interface SummaryRow {
  models_used: string | null
  providers_used: string | null
  request_count: number | null
  total_tokens: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cache_read: number | null
  cache_write: number | null
  total_cost: number | null
}

interface ModelRow {
  provider: string | null
  model: string | null
  requests: number | null
  sessions: number | null
  total_tokens: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cache_read: number | null
  total_cost: number | null
}

interface ProviderRow {
  provider: string | null
  requests: number | null
  sessions: number | null
  total_tokens: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cache_read: number | null
  total_cost: number | null
}

interface DailyRow {
  day: string | null
  requests: number | null
  sessions: number | null
  total_tokens: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cache_read: number | null
  total_cost: number | null
}

interface SessionRow {
  session_id: string | null
  title: string | null
  provider: string | null
  model: string | null
  requests: number | null
  total_tokens: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cache_read: number | null
  total_cost: number | null
  day: string | null
}

interface DistinctValueRow {
  value: string | null
}

async function queryDb<T>(sql: string): Promise<T[]> {
  const flatSql = sql.replace(/\s+/g, " ").trim()
  const { stdout, stderr } = await execAsync(`opencode db ${JSON.stringify(flatSql)} --format json`)
  if (stderr) throw new Error(stderr.trim())
  const parsed = JSON.parse(stdout.trim())
  return Array.isArray(parsed) ? parsed : parsed.data ?? []
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

/** 校验日期格式必须为 YYYY-MM-DD，防止格式异常字符串进入 SQL */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function messageWhere(filters: UsageFilters): string {
  const where = [
    "json_extract(m.data, '$.role') = 'assistant'",
    "coalesce(json_extract(m.data, '$.tokens.total'), 0) > 0",
  ]

  if (filters.sessionId) where.push(`m.session_id = '${escapeSql(filters.sessionId)}'`)
  if (filters.provider) where.push(`coalesce(json_extract(m.data, '$.providerID'), '') = '${escapeSql(filters.provider)}'`)
  if (filters.model) where.push(`coalesce(json_extract(m.data, '$.modelID'), '') = '${escapeSql(filters.model)}'`)
  // Risk fix: 日期参数先验证格式（YYYY-MM-DD），格式不符则忽略该过滤条件
  if (filters.startDate && isValidDate(filters.startDate)) {
    where.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') >= '${filters.startDate}'`)
  }
  if (filters.endDate && isValidDate(filters.endDate)) {
    where.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') <= '${filters.endDate}'`)
  }

  return where.join(" AND ")
}


function parseList(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

function toSessionTokenData(row?: SummaryRow): SessionTokenData {
  const models = parseList(row?.models_used)
  const providers = parseList(row?.providers_used)

  return {
    model: models.length === 1 ? models[0] : "",
    provider: providers.length === 1 ? providers[0] : "",
    modelsUsed: models,
    totalTokens: row?.total_tokens ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
    reasoningTokens: row?.reasoning_tokens ?? 0,
    cacheRead: row?.cache_read ?? 0,
    cacheWrite: row?.cache_write ?? 0,
    totalCost: row?.total_cost ?? 0,
    requestCount: row?.request_count ?? 0,
  }
}

export function getPresetRange(preset: "all" | "7d" | "30d" | "month"): Pick<UsageFilters, "startDate" | "endDate"> {
  if (preset === "all") return {}

  const end = new Date()
  const start = new Date(end)

  if (preset === "7d") start.setDate(end.getDate() - 6)
  if (preset === "30d") start.setDate(end.getDate() - 29)
  if (preset === "month") start.setDate(1)

  const format = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  return { startDate: format(start), endDate: format(end) }
}

export async function getCurrentSessionStats(sessionId?: string): Promise<SessionTokenData> {
  const filters: UsageFilters = sessionId ? { sessionId } : {}
  return getSummary(filters)
}

export async function getSummary(filters: UsageFilters = {}): Promise<SessionTokenData> {
  const sql = `
SELECT
  group_concat(distinct coalesce(json_extract(m.data, '$.modelID'), 'unknown')) as models_used,
  group_concat(distinct coalesce(json_extract(m.data, '$.providerID'), 'unknown')) as providers_used,
  count(*) as request_count,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.write'), 0)) as cache_write,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
  `.trim()

  const rows = await queryDb<SummaryRow>(sql)
  return toSessionTokenData(rows[0])
}

export async function getModelBreakdown(filters: UsageFilters = {}): Promise<ModelBreakdownItem[]> {
  const sql = `
SELECT
  coalesce(json_extract(m.data, '$.providerID'), 'unknown') as provider,
  coalesce(json_extract(m.data, '$.modelID'), 'unknown') as model,
  count(*) as requests,
  count(distinct m.session_id) as sessions,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
GROUP BY provider, model
ORDER BY total_tokens DESC
  `.trim()

  const rows = await queryDb<ModelRow>(sql)
  return rows.map((row) => ({
    provider: row.provider ?? "unknown",
    model: row.model ?? "unknown",
    requests: row.requests ?? 0,
    sessions: row.sessions ?? 0,
    totalTokens: row.total_tokens ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    reasoningTokens: row.reasoning_tokens ?? 0,
    cacheRead: row.cache_read ?? 0,
    totalCost: row.total_cost ?? 0,
  }))
}

export async function getProviderBreakdown(filters: UsageFilters = {}): Promise<ProviderBreakdownItem[]> {
  const sql = `
SELECT
  coalesce(json_extract(m.data, '$.providerID'), 'unknown') as provider,
  count(*) as requests,
  count(distinct m.session_id) as sessions,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
GROUP BY provider
ORDER BY total_tokens DESC
  `.trim()

  const rows = await queryDb<ProviderRow>(sql)
  return rows.map((row) => ({
    provider: row.provider ?? "unknown",
    requests: row.requests ?? 0,
    sessions: row.sessions ?? 0,
    totalTokens: row.total_tokens ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    reasoningTokens: row.reasoning_tokens ?? 0,
    cacheRead: row.cache_read ?? 0,
    totalCost: row.total_cost ?? 0,
  }))
}

export async function getDailyBreakdown(filters: UsageFilters = {}): Promise<DailyBreakdownItem[]> {
  const limit = filters.limit ?? 30
  const sql = `
SELECT
  date(m.time_created / 1000, 'unixepoch', 'localtime') as day,
  count(*) as requests,
  count(distinct m.session_id) as sessions,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
GROUP BY day
ORDER BY day DESC
LIMIT ${Math.max(1, limit)}
  `.trim()

  const rows = await queryDb<DailyRow>(sql)
  return rows.map((row) => ({
    day: row.day ?? "",
    requests: row.requests ?? 0,
    sessions: row.sessions ?? 0,
    totalTokens: row.total_tokens ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    reasoningTokens: row.reasoning_tokens ?? 0,
    cacheRead: row.cache_read ?? 0,
    totalCost: row.total_cost ?? 0,
  }))
}

export async function getSessionBreakdown(filters: UsageFilters = {}): Promise<SessionBreakdownItem[]> {
  const limit = filters.limit ?? 15
  const sql = `
SELECT
  s.id as session_id,
  s.title as title,
  coalesce(json_extract(m.data, '$.providerID'), json_extract(s.model, '$.providerID'), 'unknown') as provider,
  coalesce(json_extract(m.data, '$.modelID'), json_extract(s.model, '$.id'), 'unknown') as model,
  count(*) as requests,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost,
  date(max(m.time_created) / 1000, 'unixepoch', 'localtime') as day
FROM message m
JOIN session s ON s.id = m.session_id
WHERE ${messageWhere(filters)}
GROUP BY s.id, s.title, provider, model
ORDER BY max(m.time_created) DESC
LIMIT ${Math.max(1, limit)}
  `.trim()

  const rows = await queryDb<SessionRow>(sql)
  return rows.map((row) => ({
    sessionId: row.session_id ?? "",
    title: row.title ?? "(untitled)",
    provider: row.provider ?? "unknown",
    model: row.model ?? "unknown",
    requests: row.requests ?? 0,
    totalTokens: row.total_tokens ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    reasoningTokens: row.reasoning_tokens ?? 0,
    cacheRead: row.cache_read ?? 0,
    totalCost: row.total_cost ?? 0,
    day: row.day ?? "",
  }))
}

export async function getAvailableModels(): Promise<string[]> {
  const sql = `
SELECT distinct coalesce(json_extract(m.data, '$.modelID'), 'unknown') as value
FROM message m
WHERE ${messageWhere({})}
ORDER BY value ASC
  `.trim()

  const rows = await queryDb<DistinctValueRow>(sql)
  return rows.map((row) => row.value ?? "unknown")
}

export async function getAvailableProviders(): Promise<string[]> {
  const sql = `
SELECT distinct coalesce(json_extract(m.data, '$.providerID'), 'unknown') as value
FROM message m
WHERE ${messageWhere({})}
ORDER BY value ASC
  `.trim()

  const rows = await queryDb<DistinctValueRow>(sql)
  return rows.map((row) => row.value ?? "unknown")
}

/** 失败请求计数 SQL。1次运行获取成功数＋失败数＋按模型细分 */
export async function getErrorStats(filters: UsageFilters = {}): Promise<ErrorStats> {
  // 构建日期／Session/Provider/Model 过滤条件（不包含 tokens.total > 0 过滤）
  const baseConds: string[] = [
    "json_extract(m.data, '$.role') = 'assistant'",
  ]
  if (filters.sessionId) baseConds.push(`m.session_id = '${escapeSql(filters.sessionId)}'`)
  if (filters.provider) baseConds.push(`coalesce(json_extract(m.data, '$.providerID'), '') = '${escapeSql(filters.provider)}'`)
  if (filters.model) baseConds.push(`coalesce(json_extract(m.data, '$.modelID'), '') = '${escapeSql(filters.model)}'`)
  if (filters.startDate && isValidDate(filters.startDate)) {
    baseConds.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') >= '${filters.startDate}'`)
  }
  if (filters.endDate && isValidDate(filters.endDate)) {
    baseConds.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') <= '${filters.endDate}'`)
  }
  const baseWhere = baseConds.join(" AND ")

  // 按模型细化：同时统计成功和失败请求
  const sql = `
SELECT
  coalesce(json_extract(m.data, '$.providerID'), 'unknown') as provider,
  coalesce(json_extract(m.data, '$.modelID'), 'unknown') as model,
  count(*) as total,
  sum(CASE WHEN coalesce(json_extract(m.data, '$.tokens.total'), 0) = 0 THEN 1 ELSE 0 END) as failed
FROM message m
WHERE ${baseWhere}
GROUP BY provider, model
ORDER BY failed DESC
  `.trim()

  interface ErrorRow {
    provider: string | null
    model: string | null
    total: number | null
    failed: number | null
  }

  try {
    const rows = await queryDb<ErrorRow>(sql)
    let successCount = 0, failedCount = 0
    const byModel = rows.map(r => {
      const total = r.total ?? 0
      const failed = r.failed ?? 0
      const success = total - failed
      successCount += success
      failedCount += failed
      return { provider: r.provider ?? 'unknown', model: r.model ?? 'unknown', failed, total }
    })
    const errorRate = (successCount + failedCount) > 0
      ? failedCount / (successCount + failedCount)
      : 0
    return { successCount, failedCount, errorRate, byModel }
  } catch {
    return { successCount: 0, failedCount: 0, errorRate: 0, byModel: [] }
  }
}

export async function getUsageReport(filters: UsageFilters = {}): Promise<UsageReport> {
  const [summary, models, providers, daily, sessions, errors] = await Promise.all([
    getSummary(filters),
    getModelBreakdown(filters),
    getProviderBreakdown(filters),
    getDailyBreakdown(filters),
    getSessionBreakdown(filters),
    getErrorStats(filters),
  ])

  return { filters, summary, models, providers, daily, sessions, errors }
}

function csvEscape(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text
}

export function exportReportAsCsv(report: UsageReport, section: "models" | "providers" | "daily" | "sessions"): string {
  if (section === "models") {
    const header = ["provider", "model", "requests", "sessions", "totalTokens", "inputTokens", "outputTokens", "reasoningTokens", "cacheRead", "totalCost"]
    const rows = report.models.map((item) => [
      item.provider,
      item.model,
      item.requests,
      item.sessions,
      item.totalTokens,
      item.inputTokens,
      item.outputTokens,
      item.reasoningTokens,
      item.cacheRead,
      item.totalCost,
    ])
    return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")
  }

  if (section === "providers") {
    const header = ["provider", "requests", "sessions", "totalTokens", "inputTokens", "outputTokens", "reasoningTokens", "cacheRead", "totalCost"]
    const rows = report.providers.map((item) => [
      item.provider,
      item.requests,
      item.sessions,
      item.totalTokens,
      item.inputTokens,
      item.outputTokens,
      item.reasoningTokens,
      item.cacheRead,
      item.totalCost,
    ])
    return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")
  }

  if (section === "daily") {
    const header = ["day", "requests", "sessions", "totalTokens", "inputTokens", "outputTokens", "reasoningTokens", "cacheRead", "totalCost"]
    const rows = report.daily.map((item) => [
      item.day,
      item.requests,
      item.sessions,
      item.totalTokens,
      item.inputTokens,
      item.outputTokens,
      item.reasoningTokens,
      item.cacheRead,
      item.totalCost,
    ])
    return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")
  }

  const header = ["day", "sessionId", "title", "provider", "model", "requests", "totalTokens", "inputTokens", "outputTokens", "reasoningTokens", "cacheRead", "totalCost"]
  const rows = report.sessions.map((item) => [
    item.day,
    item.sessionId,
    item.title,
    item.provider,
    item.model,
    item.requests,
    item.totalTokens,
    item.inputTokens,
    item.outputTokens,
    item.reasoningTokens,
    item.cacheRead,
    item.totalCost,
  ])
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")
}
