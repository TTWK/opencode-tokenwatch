import type { LogEntry, ModelPerfStats, SessionPerfStats, UsageFilters } from "./format.js"
import { accumulateEntry, createAccumulator, finalizeAccumulator, type ModelAccumulator } from "./perf-aggregate.js"
import { appendFileSync, readFileSync, writeFileSync, existsSync, statSync, renameSync, unlinkSync, openSync, readSync, closeSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { readPersistedStats, updatePersistedStats } from "./store.js"

const LOG_PATH = join(homedir(), ".opencode", "tokenwatch.jsonl")
/** rename 轮转后的上一代日志（保存更早历史，stats 迁移会一并读取） */
const LOG_PATH_ROTATED = LOG_PATH + ".1"

/** 快速检测日志文件末尾是否已有该 messageID，毫秒级跨进程幂等规避重复落盘 */
function isMessageAlreadyLogged(messageID: string): boolean {
  if (!messageID || !existsSync(LOG_PATH)) return false
  try {
    const size = statSync(LOG_PATH).size
    if (size === 0) return false
    const readSize = Math.min(size, 16 * 1024)
    const buf = Buffer.alloc(readSize)
    const fd = openSync(LOG_PATH, "r")
    try {
      readSync(fd, buf, 0, readSize, size - readSize)
    } finally {
      closeSync(fd)
    }
    const tail = buf.toString("utf-8")
    return tail.includes(`"messageID":"${messageID}"`)
  } catch {
    return false
  }
}

interface PartEvent {
  message_id?: string
  type?: string
  text?: string
  time?: { start?: number }
}

interface MessageUpdateEvent {
  properties: {
    info: {
      id?: string
      sessionID?: string
      role?: string
      providerID?: string
      modelID?: string
      tokens?: {
        input?: number
        output?: number
        reasoning?: number
        cache?: { read?: number; write?: number }
      }
      cost?: number
      time?: { created?: number; streamed?: number; completed?: number }
    }
  }
}

interface MessageRemoveEvent {
  properties: {
    sessionID?: string
    messageID?: string
  }
}

export interface PerfTrackerOptions {
  /**
   * 是否向 ~/.opencode/tokenwatch.jsonl 与 stats 写入日志与持久化统计。
   * 默认为 true。若 Server 进程已在采集并权威落盘，客户端可将其设为 false 以免重复写入。
   */
  persistLog?: boolean
}

class PerfTracker {
  private readonly persistLog: boolean
  /** 已处理落盘的消息 ID 集合（防止 step.ended 与 message.updated 产生重复记录） */
  private readonly completedMessageIDs = new Set<string>()
  /** 最早的任意 part，仅在缺少内容锚点时作为 TTFT 回退；不参与 TPS 窗口 */
  private firstPartTimes = new Map<string, number>()
  /** 最早的输出 part（text/reasoning）—— 用作 TTFT（用户等待首个可见 token 的时间） */
  private firstOutputTimes = new Map<string, number>()
  private statsMap = new Map<string, ModelAccumulator>()
  /** 会话加载令牌：异步重放期间再次切会话时，旧加载结果按令牌过期丢弃 */
  private loadToken = 0
  /** 当前前台激活的会话 ID，防止非当前会话的迟到事件污染前台内存 statsMap */
  private activeSessionID = ""

  constructor(options: PerfTrackerOptions = {}) {
    this.persistLog = options.persistLog ?? true
  }

  handlePartUpdated(event: PartEvent): void {
    if (!event.time?.start || !event.message_id) return
    // Bug fix: 取最早 part 时间而非最后一个，避免 TTFT 被高估
    const cur = this.firstPartTimes.get(event.message_id) ?? Number.POSITIVE_INFINITY
    if (event.time.start < cur) {
      this.firstPartTimes.set(event.message_id, event.time.start)
    }
    // TTFT 只统计"首 token"锚点：v1 的输出 part（text/reasoning/tool 的
    // time.start 即首 token）与 v2 的 delta 事件（首个内容片段）。
    // 窗口锚点（v2 的 step / part-open，v1 的 step-start / step-finish，
    // 以及一切 *-started 占位符打开事件）标记的是"请求/阶段开始"而非首
    // token，不参与 TTFT —— 否则 v1 的 TTFT 会恒为毫秒级。TPS 则直接
    // 使用消息的 created → streamed，不依赖这些可能缺失的事件锚点。
    const type = event.type
    const isDelta = type != null && (type.endsWith("-delta") || type.endsWith(".delta"))
    const isWindowAnchor = type === "step" || type === "part-open"
      || type === "step-start" || type === "step-finish"
      || (type != null && (type.endsWith("-started") || type.endsWith(".started")))
    const isFirstTokenAnchor = isDelta || !isWindowAnchor
    if (isFirstTokenAnchor) {
      const curOut = this.firstOutputTimes.get(event.message_id) ?? Number.POSITIVE_INFINITY
      if (event.time.start < curOut) {
        this.firstOutputTimes.set(event.message_id, event.time.start)
      }
    }
  }

  handleMessageUpdated(event: MessageUpdateEvent): void {
    const info = event.properties?.info
    if (!info || info.role !== "assistant") return

    const messageID = info.id ?? ""
    if (messageID && this.completedMessageIDs.has(messageID)) {
      return
    }

    const created = info.time?.created
    const streamed = info.time?.streamed
    const completed = info.time?.completed
    if (!created || (!streamed && !completed)) {
      // 流式中间更新态：保留已记录的首 token/part 锚点，等待最终完成结算（杜绝提前误删）
      return
    }

    // 与 runtime 的会话归属兜底一致：宿主事件缺省 sessionID 时归入当前前台会话，
    // 避免 Token 消息已计入当前会话、性能样本却被会话守卫丢弃。
    const sessionID = info.sessionID || this.activeSessionID
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

    // 过滤全零 token 的失败请求，不写入日志和统计，防止污染数据
    if (inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite === 0) {
      this.firstPartTimes.delete(messageID)
      this.firstOutputTimes.delete(messageID)
      return
    }

    // 严禁回退 step 起点伪造 0ms，若无可见输出 delta/part 锚点，TTFT 诚实地记为 null
    const firstOutput = this.firstOutputTimes.get(messageID) ?? null

    const latencyMs = completed ? completed - created : null
    const activeMs = streamed ? streamed - created : null
    const ttftMs = firstOutput !== null ? firstOutput - created : null
    const tpsTokens = outputTokens + reasoningTokens
    // 与宿主 SessionTurn.tokensPerSecond 一致：分子包含可见输出与 reasoning，
    // 分母从请求 created 起算至 provider streamed，包含 TTFT 与 reasoning 阶段。
    const tps = (activeMs !== null && activeMs > 0 && tpsTokens > 0)
      ? (tpsTokens / activeMs) * 1000
      : null

    this.firstPartTimes.delete(messageID)
    this.firstOutputTimes.delete(messageID)

    if (messageID) {
      this.completedMessageIDs.add(messageID)
      if (this.completedMessageIDs.size > 1000) {
        const oldest = this.completedMessageIDs.values().next().value
        if (oldest) this.completedMessageIDs.delete(oldest)
      }
    }

    const entry: LogEntry = {
      ts: new Date(created ?? Date.now()).toISOString(),
      model,
      providerID,
      modelID,
      sessionID,
      messageID: messageID || undefined,
      ttft_ms: ttftMs,
      tps,
      active_ms: activeMs,
      latency_ms: latencyMs,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cost,
    }

    this.appendLog(entry)
    // 严格会话边界守卫：当明确绑定了前台会话时，非当前会话的迟到请求仅安全落盘，绝不污染当前前台内存统计
    if (!this.activeSessionID || sessionID === this.activeSessionID) {
      this.updateStats(model, entry)
    }
  }

  private appendLog(entry: LogEntry): void {
    if (!this.persistLog) return
    try {
      // Risk fix: JSONL 日志轮转保护，防止长期使用后文件无限增长。
      // rename 轮转（原子）替代整读整写：进程崩溃不会截断日志，
      // 上一代数据完整保留在 .1 文件中供 stats 迁移读取。
      const MAX_SIZE = 5 * 1024 * 1024  // 5 MB
      if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_SIZE) {
        try { unlinkSync(LOG_PATH_ROTATED) } catch { /* 首次轮转无旧文件 */ }
        renameSync(LOG_PATH, LOG_PATH_ROTATED)
      }
      // 跨进程/跨端幂等检查：若文件末尾已包含该 messageID，不重复追加写入
      if (entry.messageID && isMessageAlreadyLogged(entry.messageID)) {
        // 已有记录，跳过写日志
      } else {
        appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n")
      }
    } catch {
      // Silently fail — logging is non-critical
    }
    // 无论 JSONL 写入是否成功，都尝试更新持久化聚合统计
    // 这样即使日志被轮转，历史统计数据也永不丢失
    updatePersistedStats(entry)
  }

  handleMessageRemoved(event: MessageRemoveEvent): void {
    const mid = event.properties?.messageID ?? ""
    if (mid) {
      this.firstPartTimes.delete(mid)
      this.firstOutputTimes.delete(mid)
    }
  }

  private updateStats(model: string, entry: LogEntry): void {
    let acc = this.statsMap.get(model)
    if (!acc) {
      acc = createAccumulator(model, entry.providerID)
      this.statsMap.set(model, acc)
    }
    accumulateEntry(acc, entry)
  }

  getSessionStats(): SessionPerfStats {
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0
    let totalRequests = 0, totalCost = 0
    let weightedHitSum = 0, totalReqForHit = 0

    const models: Record<string, ModelPerfStats> = {}
    for (const [model, acc] of this.statsMap) {
      const stats = finalizeAccumulator(acc)
      models[model] = stats
      totalInput += stats.totalInput
      totalOutput += stats.totalOutput
      totalCacheRead += stats.totalCacheRead
      totalCacheWrite += stats.totalCacheWrite
      totalRequests += stats.requestCount
      totalCost += stats.totalCost
      // 按请求数加权的全局命中率
      if (stats.cacheHitRate !== null) {
        weightedHitSum += stats.cacheHitRate * stats.requestCount
        totalReqForHit += stats.requestCount
      }
    }

    const weightedCacheHitRate = totalReqForHit > 0 ? weightedHitSum / totalReqForHit : null

    return {
      models,
      totals: { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalRequests, totalCost, weightedCacheHitRate },
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
    this.loadToken++
    this.activeSessionID = ""
    this.firstPartTimes.clear()
    this.firstOutputTimes.clear()
    this.statsMap.clear()
  }

  /**
   * 切换会话：清空内存态后异步重放该会话的 JSONL 历史。
   *
   * 异步化是为了不阻塞 TUI 渲染线程（5MB 日志的同步读可达数十毫秒）；
   * 重放完成前若又切换了会话，由 loadToken 令牌丢弃过期结果。
   */
  async loadSession(sessionID: string): Promise<void> {
    const token = ++this.loadToken
    this.activeSessionID = sessionID
    this.firstPartTimes.clear()
    this.firstOutputTimes.clear()
    this.statsMap.clear()

    if (!sessionID) return

    try {
      const files = [LOG_PATH_ROTATED, LOG_PATH].filter((f) => existsSync(f))
      if (files.length === 0) return
      for (const filePath of files) {
        if (token !== this.loadToken) return // 期间又切换了会话，丢弃过期加载
        const content = await readFile(filePath, "utf-8")
        if (token !== this.loadToken) return
        const trimmed = content.trim()
        if (!trimmed) continue
        for (const line of trimmed.split("\n")) {
          if (!line) continue
          try {
            const entry = JSON.parse(line) as LogEntry
            if (entry.sessionID === sessionID) {
              this.updateStats(entry.model, entry)
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // Non-critical loading failure
    }
  }
}

export function createPerfTracker(options: PerfTrackerOptions = {}): PerfTracker {
  return new PerfTracker(options)
}
export type { PartEvent, PerfTracker }
export function readLogs(last: number = 50): LogEntry[] {
  const tracker = new PerfTracker()
  return tracker.readLogs(last)
}

function localDayFromTs(ts: string | number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * 按窗口与过滤条件聚合性能指标。
 *
 * 优先从 tokenwatch.jsonl（含 .1）中重放符合日期/模型窗口的日志；
 * 若某活跃模型未被日志覆盖（如早期日志轮转淘汰），自动回退至持久化 stats。
 * 若指定了 activeModels，最终结果严格限制在活跃模型集合内，彻底杜绝历史无关模型泄漏。
 */
export function getWindowPerfStats(filters: UsageFilters = {}, activeModels?: Set<string>): ModelPerfStats[] {
  const hasFilter = !!(filters.startDate || filters.endDate || filters.sessionId || filters.model || filters.provider)
  const persisted = readPersistedStats()

  if (activeModels && activeModels.size === 0) {
    return []
  }

  const files = [LOG_PATH_ROTATED, LOG_PATH].filter(existsSync)
  if (!hasFilter) {
    return activeModels
      ? persisted.filter((p) => activeModels.has(p.model))
      : persisted
  }

  // 存在过滤条件时：必须基于日志重放窗口；若无日志文件，诚实返回空数组，绝不将全量历史统计充当窗口结果
  if (files.length === 0) {
    return []
  }

  const map = new Map<string, ModelAccumulator>()
  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, "utf-8").trim()
      if (!content) continue
      for (const line of content.split("\n")) {
        if (!line) continue
        try {
          const entry = JSON.parse(line) as LogEntry
          if (activeModels && !activeModels.has(entry.model)) continue
          if (filters.sessionId && entry.sessionID !== filters.sessionId) continue
          if (filters.provider && entry.providerID !== filters.provider) continue
          if (filters.model && entry.modelID !== filters.model) continue

          const day = localDayFromTs(entry.ts)
          if (filters.startDate && day < filters.startDate) continue
          if (filters.endDate && day > filters.endDate) continue

          let acc = map.get(entry.model)
          if (!acc) {
            acc = createAccumulator(entry.model, entry.providerID)
            map.set(entry.model, acc)
          }
          accumulateEntry(acc, entry)
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore read error
    }
  }

  const result: ModelPerfStats[] = []
  const covered = new Set<string>()

  for (const [model, acc] of map) {
    result.push(finalizeAccumulator(acc))
    covered.add(model)
  }

  // 严格杜绝窗口外历史数据注入：仅在没有任何时间/会话/模型等过滤条件时，
  // 活跃模型才允许由全量持久化统计补全；任何带窗口过滤的场景绝不回退到全量历史！
  if (!hasFilter && activeModels) {
    for (const p of persisted) {
      if (activeModels.has(p.model) && !covered.has(p.model)) {
        result.push(p)
      }
    }
  }

  return result
}
