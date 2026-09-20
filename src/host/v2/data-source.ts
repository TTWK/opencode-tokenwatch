/**
 * v2 历史用量数据源 —— 客户端遍历重算。
 *
 * v2 移除了 `opencode db` 子命令，无法再用 SQL 聚合。这里改为：
 * 1. `session.list()` 拿到全部会话（自带 tokens/cost，可快速出总数）
 * 2. 逐会话 `message.list()` 遍历 assistant 消息，按模型 / 供应商 / 日期分解
 *
 * 第 2 步是 O(会话数 × 消息数) 的冷启动开销，因此：
 * - 首次执行前由调用方提示用户（见 `UsageDataSource.needsFirstRunNotice`）
 * - 结果缓存在内存中，同一 TUI 会话内不重复扫描
 * - 每个会话只同步一次，并把让步交给事件循环，避免长时间阻塞渲染
 */
import type {
  DailyBreakdownItem,
  ErrorStats,
  ModelBreakdownItem,
  ProviderBreakdownItem,
  SessionBreakdownItem,
  SessionTokenData,
  UsageFilters,
  UsageReport,
} from "../../kernel/format.js"
import { t } from "../../kernel/i18n.js"

interface MutableSession {
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
  cacheWrite: number
  totalCost: number
  day: string
}

interface Snapshot {
  builtAt: number
  sessions: MutableSession[]
  models: ModelBreakdownItem[]
  providers: ProviderBreakdownItem[]
  daily: DailyBreakdownItem[]
  errors: ErrorStats
}

/** 同一 TUI 进程内复用扫描结果，避免每次打开报告都全量重算 */
let cache: Snapshot | null = null
/** 正在进行的扫描，防止并发重复触发 */
let inflight: Promise<Snapshot> | null = null
/** 缓存构建后有新数据落库（session.idle），下次取数时应后台重建 */
let dirty = false

function dayOf(ts: number): string {
  // 本地时区日期（YYYY-MM-DD），与 v1 SQL 的 date(...,'localtime') 分桶口径一致；
  // 用 toISOString 会按 UTC 分桶，UTC+8 的晚间使用会被记到"次日"
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function matchesDay(day: string, filters: UsageFilters): boolean {
  if (filters.startDate && day < filters.startDate) return false
  if (filters.endDate && day > filters.endDate) return false
  return true
}

function matchesModel(provider: string, model: string, filters: UsageFilters): boolean {
  if (filters.model && model !== filters.model) return false
  if (filters.provider && provider !== filters.provider) return false
  return true
}

/** 让出事件循环，避免大批量同步时卡住 TUI 渲染 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 会话列表页上限（每页 500），超出即截断并提示 */
const MAX_SESSION_PAGES = 64
/** 单会话消息页上限（每页 200），超出即截断并提示 */
const MAX_MESSAGE_PAGES = 400

/**
 * 服务端全量会话列表（含 v1 时期历史）。
 *
 * 必须走 `client.session.list`：TUI 的 `data.session.list()` 只是客户端 store，
 * 仅包含本进程打开/同步过的会话 —— v1 历史会话从未被打开过，走它会完全漏掉。
 * 服务端按页返回（limit=500 仍有 cursor.next），需 cursor 翻页拉全。
 * 返回 truncated=true 表示达到页上限仍有更多数据（已截断）。
 */
async function listAllSessions(ctx: any): Promise<{ sessions: any[]; truncated: boolean }> {
  const api = ctx?.client
  if (typeof api?.session?.list !== "function") {
    // 旧宿主没有暴露 client API 时退回客户端 store（行为同旧版插件）
    return { sessions: ctx?.data?.session?.list?.() ?? [], truncated: false }
  }
  const out: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_SESSION_PAGES; page++) {
    // cursor 自带排序方向，不能与 order 同时传
    const input: Record<string, unknown> = cursor ? { cursor } : { limit: 500, order: "asc" }
    const resp = await api.session.list(input)
    out.push(...(resp?.data ?? []))
    cursor = resp?.cursor?.next ?? undefined
    if (!cursor) break
  }
  return { sessions: out, truncated: cursor != null }
}

/**
 * 单会话全量消息（cursor 翻页）。服务端每页默认 50 条、只回最近一页，
 * 长会话的历史消息必须翻页才能拿全。个别 v1 早期会话服务端解码失败
 * （HTTP 500），调用方需按会话容错跳过。
 */
async function listAllMessages(ctx: any, sessionID: string): Promise<{ messages: any[]; truncated: boolean }> {
  const api = ctx?.client
  if (typeof api?.message?.list !== "function") {
    try {
      await ctx?.data?.session?.message?.sync?.(sessionID)
    } catch { /* 离线/权限失败时退化为本地缓存 */ }
    return { messages: ctx?.data?.session?.message?.list?.(sessionID) ?? [], truncated: false }
  }
  const out: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const resp = await (cursor
      ? api.message.list({ sessionID, cursor })
      : api.message.list({ sessionID, limit: 200, order: "desc" }))
    out.push(...(resp?.data ?? []))
    cursor = resp?.cursor?.next ?? undefined
    if (!cursor) break
  }
  return { messages: out, truncated: cursor != null }
}

function isAssistantMessage(message: any): boolean {
  // v2 API 统一投影为 type；防御性兼容 role 字段
  return message?.type === "assistant" || message?.role === "assistant"
}

async function scan(ctx: any): Promise<Snapshot> {
  const sessionAgg = new Map<string, MutableSession>()
  const modelAgg = new Map<string, ModelBreakdownItem>()
  const providerAgg = new Map<string, ProviderBreakdownItem>()
  const dailyAgg = new Map<string, DailyBreakdownItem>()
  const modelSessions = new Map<string, Set<string>>()
  const providerSessions = new Map<string, Set<string>>()
  const dailySessions = new Map<string, Set<string>>()

  const errorByModel = new Map<string, { provider: string; model: string; failed: number; total: number }>()
  let successCount = 0
  let failedCount = 0

  const { sessions, truncated: sessionsTruncated } = await listAllSessions(ctx)
  let skippedSessions = 0
  let truncatedMessageSessions = 0

  for (const session of sessions) {
    const sessionID = session?.id
    if (!sessionID) continue

    let messages: any[]
    try {
      // 服务端全量消息；个别 v1 早期会话解码失败（500），跳过不计入
      const result = await listAllMessages(ctx, sessionID)
      messages = result.messages
      if (result.truncated) truncatedMessageSessions++
    } catch {
      skippedSessions++
      continue
    }
    let sawAssistant = false

    for (const message of messages) {
      if (!isAssistantMessage(message)) continue
      const tokens = message?.tokens
      if (!tokens) continue

      const input = tokens.input ?? 0
      const output = tokens.output ?? 0
      const reasoning = tokens.reasoning ?? 0
      const cacheRead = tokens.cache?.read ?? 0
      const cacheWrite = tokens.cache?.write ?? 0
      const total = input + output + reasoning + cacheRead + cacheWrite
      const cost = typeof message?.cost === "number" ? message.cost : 0
      const provider = message?.model?.providerID ?? "unknown"
      const model = message?.model?.id ?? "unknown"
      const day = dayOf(message?.time?.created ?? session?.time?.created ?? Date.now())

      // v2 用 finish === "error" 判定失败，比 v1 的 tokens.total === 0 启发式更准确
      const isFailure = message?.finish === "error" || total === 0
      const modelKey = `${provider}/${model}`
      const err = errorByModel.get(modelKey) ?? { provider, model, failed: 0, total: 0 }
      err.total++
      if (isFailure) {
        err.failed++
        failedCount++
      } else {
        successCount++
      }
      errorByModel.set(modelKey, err)

      // 失败请求不计入用量统计（与 v1 SQL 过滤条件一致）
      if (isFailure) continue
      sawAssistant = true

      // session 维度
      let s = sessionAgg.get(sessionID)
      if (!s) {
        s = {
          sessionId: sessionID,
          title: session?.title ?? "",
          provider,
          model,
          requests: 0,
          totalTokens: 0, inputTokens: 0, outputTokens: 0,
          reasoningTokens: 0, cacheRead: 0, cacheWrite: 0,
          totalCost: 0,
          day,
        }
        sessionAgg.set(sessionID, s)
      }
      s.requests++
      s.totalTokens += total
      s.inputTokens += input
      s.outputTokens += output
      s.reasoningTokens += reasoning
      s.cacheRead += cacheRead
      s.cacheWrite += cacheWrite
      s.totalCost += cost
      if (!s.provider || s.provider === "unknown") s.provider = provider
      if (!s.model || s.model === "unknown") s.model = model

      // model 维度
      let m = modelAgg.get(modelKey)
      if (!m) {
        m = {
          provider, model, requests: 0, sessions: 0,
          totalTokens: 0, inputTokens: 0, outputTokens: 0,
          reasoningTokens: 0, cacheRead: 0, totalCost: 0,
        }
        modelAgg.set(modelKey, m)
      }
      m.requests++
      m.totalTokens += total
      m.inputTokens += input
      m.outputTokens += output
      m.reasoningTokens += reasoning
      m.cacheRead += cacheRead
      m.totalCost += cost
      ;(modelSessions.get(modelKey) ?? modelSessions.set(modelKey, new Set()).get(modelKey)!).add(sessionID)

      // provider 维度
      let p = providerAgg.get(provider)
      if (!p) {
        p = {
          provider, requests: 0, sessions: 0,
          totalTokens: 0, inputTokens: 0, outputTokens: 0,
          reasoningTokens: 0, cacheRead: 0, totalCost: 0,
        }
        providerAgg.set(provider, p)
      }
      p.requests++
      p.totalTokens += total
      p.inputTokens += input
      p.outputTokens += output
      p.reasoningTokens += reasoning
      p.cacheRead += cacheRead
      p.totalCost += cost
      ;(providerSessions.get(provider) ?? providerSessions.set(provider, new Set()).get(provider)!).add(sessionID)

      // daily 维度
      let d = dailyAgg.get(day)
      if (!d) {
        d = {
          day, requests: 0, sessions: 0,
          totalTokens: 0, inputTokens: 0, outputTokens: 0,
          reasoningTokens: 0, cacheRead: 0, totalCost: 0,
        }
        dailyAgg.set(day, d)
      }
      d.requests++
      d.totalTokens += total
      d.inputTokens += input
      d.outputTokens += output
      d.reasoningTokens += reasoning
      d.cacheRead += cacheRead
      d.totalCost += cost
      ;(dailySessions.get(day) ?? dailySessions.set(day, new Set()).get(day)!).add(sessionID)
    }

    if (!sawAssistant && session?.id) {
      // 没有 assistant 消息的会话不进入 sessions 列表，避免空行
      sessionAgg.delete(sessionID)
    }

    await yieldToEventLoop()
  }

  // 截断/跳过不再只写 console（TUI 里不可见），经宿主 toast 提示用户数据可能有缺口
  const warn = (message: string): void => {
    try {
      ctx?.ui?.toast?.show({ message, variant: "warning" })
    } catch {
      console.warn(`[tokenwatch] ${message}`)
    }
  }
  if (skippedSessions > 0) {
    warn(t("noticeSkippedSessions").replace("{n}", String(skippedSessions)))
  }
  if (sessionsTruncated) {
    warn(t("noticeScanTruncatedSessions"))
  }
  if (truncatedMessageSessions > 0) {
    warn(t("noticeScanTruncatedMessages").replace("{n}", String(truncatedMessageSessions)))
  }

  for (const [key, set] of modelSessions) {
    const m = modelAgg.get(key)
    if (m) m.sessions = set.size
  }
  for (const [key, set] of providerSessions) {
    const p = providerAgg.get(key)
    if (p) p.sessions = set.size
  }
  for (const [key, set] of dailySessions) {
    const d = dailyAgg.get(key)
    if (d) d.sessions = set.size
  }

  return {
    builtAt: Date.now(),
    sessions: Array.from(sessionAgg.values()).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)),
    models: Array.from(modelAgg.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    providers: Array.from(providerAgg.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    daily: Array.from(dailyAgg.values()).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)),
    errors: {
      successCount,
      failedCount,
      // 小数口径（0~1），与 v1 的 getErrorStats 及 HTML 报告的消费方一致
      errorRate: successCount + failedCount > 0 ? failedCount / (successCount + failedCount) : 0,
      byModel: Array.from(errorByModel.values()),
    },
  }
}

function summarize(input: {
  sessions: MutableSession[]
  models: ModelBreakdownItem[]
}): SessionTokenData {
  let totalTokens = 0, inputTokens = 0, outputTokens = 0, reasoningTokens = 0
  let cacheRead = 0, cacheWrite = 0, totalCost = 0, requestCount = 0

  for (const s of input.sessions) {
    totalTokens += s.totalTokens
    inputTokens += s.inputTokens
    outputTokens += s.outputTokens
    reasoningTokens += s.reasoningTokens
    cacheRead += s.cacheRead
    cacheWrite += s.cacheWrite
    totalCost += s.totalCost
    requestCount += s.requests
  }

  const modelsUsed = input.models.map((m) => `${m.provider}/${m.model}`)

  return {
    model: input.sessions[0]?.model ?? "",
    provider: input.sessions[0]?.provider ?? "",
    modelsUsed,
    totalTokens, inputTokens, outputTokens, reasoningTokens,
    cacheRead, cacheWrite, totalCost, requestCount,
  }
}

/**
 * 启动一次全量扫描。
 *
 * 独立成函数是因为"后台重建"路径不 await 结果：挂一个空 catch
 * 防止 unhandled rejection，真正的错误仍由冷启动路径的调用方处理。
 */
function startScan(ctx: any): Promise<Snapshot> {
  const p = scan(ctx)
    .then((snapshot) => {
      cache = snapshot
      inflight = null
      return snapshot
    })
    .catch((err) => {
      inflight = null
      throw err
    })
  p.catch(() => { /* 后台重建路径不 await，吞掉拒绝避免未处理告警 */ })
  inflight = p
  return p
}

function buildReport(snapshot: Snapshot, filters: UsageFilters): UsageReport {
  const sessions = snapshot.sessions.filter(
    (s) => matchesDay(s.day, filters) && matchesModel(s.provider, s.model, filters),
  )
  // 注意：session 级 model/provider 过滤用的是该会话"首个非 unknown"的主模型，
  // 多模型会话无法按单个模型精确切分 —— 与 v1 SQL 的逐消息过滤语义近似但不完全等价
  const models = snapshot.models.filter((m) => matchesModel(m.provider, m.model, filters))
  const providers = snapshot.providers.filter((p) => !filters.provider || p.provider === filters.provider)
  const daily = snapshot.daily.filter((d) => matchesDay(d.day, filters))

  return {
    filters,
    summary: summarize({ sessions, models }),
    models,
    providers,
    daily,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      provider: s.provider,
      model: s.model,
      requests: s.requests,
      totalTokens: s.totalTokens,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      reasoningTokens: s.reasoningTokens,
      cacheRead: s.cacheRead,
      totalCost: s.totalCost,
      day: s.day,
    })) satisfies SessionBreakdownItem[],
    errors: snapshot.errors,
  }
}

/**
 * 取用量报告（stale-while-revalidate）。
 *
 * - 冷启动（无缓存）：等待全量扫描完成（调用方已先提示用户）。
 * - 缓存可用且数据有更新（markUsageCacheDirty）：立即返回旧快照，
 *   同时后台重建 —— 本次报告不卡顿，下次打开即为新数据。
 * - 缓存可用且无更新：直接返回。
 */
export async function getUsageReport(ctx: any, filters: UsageFilters = {}): Promise<UsageReport> {
  if (!inflight) {
    if (!cache) {
      startScan(ctx)
    } else if (dirty) {
      dirty = false
      startScan(ctx)
    }
  }

  if (!cache) {
    const snapshot = await inflight!
    return buildReport(snapshot, filters)
  }
  return buildReport(cache, filters)
}

/** 有新数据落库（如 session.idle）时由适配层调用：下次取数触发后台重建 */
export function markUsageCacheDirty(): void {
  dirty = true
}

/** 供命令层判断本次调用是否会触发冷启动扫描 */
export function isUsageCacheCold(): boolean {
  return cache === null
}
