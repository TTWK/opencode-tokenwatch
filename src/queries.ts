import { exec } from "node:child_process"
import type { SessionTokenData, ModelBreakdownItem, DailyBreakdownItem } from "./formatter.js"

function execAsync(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout, stderr })
    })
  })
}

interface SummaryRow {
  total_requests: number
  total_sessions: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  total_cost: number
}

interface ModelRow {
  model: string
  requests: number
  sessions: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  total_cost: number
}

interface DailyRow {
  day: string
  requests: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  total_cost: number
}

async function queryDb<T>(sql: string): Promise<T[]> {
  const { stdout, stderr } = await execAsync(
    `opencode db ${JSON.stringify(sql)} --format json`,
  )
  if (stderr) throw new Error(stderr.trim())
  const parsed = JSON.parse(stdout.trim())
  return Array.isArray(parsed) ? parsed : parsed.data ?? []
}

export async function getSummaryStats(): Promise<SessionTokenData> {
  const sql = `
SELECT
  count(*) as total_requests,
  count(distinct session_id) as total_sessions,
  sum(json_extract(data, '$.tokens.total')) as total_tokens,
  sum(json_extract(data, '$.tokens.input')) as input_tokens,
  sum(json_extract(data, '$.tokens.output')) as output_tokens,
  sum(json_extract(data, '$.tokens.cache.read')) as cache_read,
  sum(json_extract(data, '$.cost')) as total_cost
FROM message
WHERE json_extract(data, '$.tokens.total') > 0
  `.trim()

  const rows = await queryDb<SummaryRow>(sql)
  const row = rows[0] ?? {}
  return {
    totalTokens: row.total_tokens ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    reasoningTokens: 0,
    cacheRead: row.cache_read ?? 0,
    cacheWrite: 0,
    totalCost: row.total_cost ?? 0,
    requestCount: row.total_requests ?? 0,
  }
}

export async function getModelBreakdown(): Promise<ModelBreakdownItem[]> {
  const sql = `
SELECT
  json_extract(data, '$.modelID') as model,
  count(*) as requests,
  count(distinct session_id) as sessions,
  sum(json_extract(data, '$.tokens.total')) as total_tokens,
  sum(json_extract(data, '$.tokens.input')) as input_tokens,
  sum(json_extract(data, '$.tokens.output')) as output_tokens,
  sum(json_extract(data, '$.tokens.cache.read')) as cache_read,
  sum(json_extract(data, '$.cost')) as total_cost
FROM message
WHERE json_extract(data, '$.tokens.total') > 0
GROUP BY model
ORDER BY total_tokens DESC
  `.trim()

  const rows = await queryDb<ModelRow>(sql)
  return rows.map((r) => ({
    model: r.model ?? "unknown",
    requests: r.requests ?? 0,
    sessions: r.sessions ?? 0,
    totalTokens: r.total_tokens ?? 0,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    cacheRead: r.cache_read ?? 0,
    totalCost: r.total_cost ?? 0,
  }))
}

export async function getDailyBreakdown(limit = 10): Promise<DailyBreakdownItem[]> {
  const sql = `
SELECT
  date(time_created / 1000, 'unixepoch') as day,
  count(*) as requests,
  sum(json_extract(data, '$.tokens.total')) as total_tokens,
  sum(json_extract(data, '$.tokens.input')) as input_tokens,
  sum(json_extract(data, '$.tokens.output')) as output_tokens,
  sum(json_extract(data, '$.tokens.reasoning')) as reasoning_tokens,
  sum(json_extract(data, '$.tokens.cache.read')) as cache_read,
  sum(json_extract(data, '$.cost')) as total_cost
FROM message
WHERE json_extract(data, '$.tokens.total') > 0
GROUP BY day
ORDER BY day DESC
LIMIT ${limit}
  `.trim()

  const rows = await queryDb<DailyRow>(sql)
  return rows.map((r) => ({
    day: r.day ?? "",
    requests: r.requests ?? 0,
    totalTokens: r.total_tokens ?? 0,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    reasoningTokens: r.reasoning_tokens ?? 0,
    cacheRead: r.cache_read ?? 0,
    totalCost: r.total_cost ?? 0,
  }))
}
