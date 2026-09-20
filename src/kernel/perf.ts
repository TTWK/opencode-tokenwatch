import type { LogEntry, ModelPerfStats, SessionPerfStats } from "./format.js"
import { accumulateEntry, createAccumulator, finalizeAccumulator, type ModelAccumulator } from "./perf-aggregate.js"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, statSync } from "node:fs"
import { updatePersistedStats } from "./store.js"

const LOG_PATH = join(homedir(), ".opencode", "tokenwatch.jsonl")

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
      time?: { created?: number; completed?: number }
    }
  }
}

interface MessageRemoveEvent {
  properties: {
    sessionID?: string
    messageID?: string
  }
}

class PerfTracker {
  /** 最早的任意 part（含 step 起点）—— 用作 TPS 的流式窗口起点（对齐宿主官方口径） */
  private firstPartTimes = new Map<string, number>()
  /** 最早的输出 part（text/reasoning）—— 用作 TTFT（用户等待首个可见 token 的时间） */
  private firstOutputTimes = new Map<string, number>()
  private statsMap = new Map<string, ModelAccumulator>()
  /** 原始样本串，用于分位数计算，不持久化 */
  private ttftSamples = new Map<string, number[]>()
  private latencySamples = new Map<string, number[]>()

  handlePartUpdated(event: PartEvent): void {
    if (!event.time?.start || !event.message_id) return
    // Bug fix: 取最早 part 时间而非最后一个，避免 TTFT 被高估
    const cur = this.firstPartTimes.get(event.message_id) ?? Number.POSITIVE_INFINITY
    if (event.time.start < cur) {
      this.firstPartTimes.set(event.message_id, event.time.start)
    }
    // TTFT 只统计"首 token"锚点：v1 的输出 part（text/reasoning/tool 的
    // time.start 即首 token）与 v2 的 delta 事件（首个内容片段）。
    // v2 的 text/reasoning "started" 事件是 part 占位符打开时刻（≈ step 开始，
    // 恒为个位数 ms），step 锚点同理 —— 两者都不参与 TTFT。
    const isDelta = event.type != null && event.type.endsWith("-delta")
    const isFirstTokenAnchor = isDelta || (event.type !== "step" && event.type !== "part-open")
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
    if (!info.time?.completed) return

    const messageID = info.id ?? ""
    const created = info.time.created
    const completed = info.time.completed
    if (!created || !completed) {
      this.firstPartTimes.delete(messageID)
      this.firstOutputTimes.delete(messageID)
      return
    }

    const sessionID = info.sessionID ?? ""
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

    const firstPart = this.firstPartTimes.get(messageID) ?? null
    const firstOutput = this.firstOutputTimes.get(messageID) ?? firstPart

    const latencyMs = completed - created
    const ttftMs = firstOutput !== null ? firstOutput - created : null
    const genMs = firstPart !== null ? completed - firstPart : null
    const tps = (genMs !== null && genMs > 0 && outputTokens > 0)
      ? (outputTokens / genMs) * 1000
      : null
    // Bug fix: 移除 TPS fallback。
    // 原 fallback 用 latencyMs（completed-created，含排队+TTFT）计算 TPS，
    // 会使结果严重低估（约 40%+）。null 表示"无可靠数据"比虚假数字更好。

    this.firstPartTimes.delete(messageID)
    this.firstOutputTimes.delete(messageID)

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      model,
      providerID,
      modelID,
      sessionID,
      ttft_ms: ttftMs,
      tps: tps,          // 只在有可靠 genMs 时才有值
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
      // Risk fix: JSONL 日志轮转保护，防止长期使用后文件无限增长
      // 超过 5MB 时截断，保留最新 2000 行
      // 注意：轮转前先调用 updatePersistedStats，确保被轮转行的数据已持久化
      const MAX_SIZE = 5 * 1024 * 1024  // 5 MB
      const KEEP_LINES = 2000
      if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_SIZE) {
        const lines = readFileSync(LOG_PATH, "utf-8").trim().split("\n")
        writeFileSync(LOG_PATH, lines.slice(-KEEP_LINES).join("\n") + "\n")
      }
      appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n")
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
    this.firstPartTimes.clear()
    this.firstOutputTimes.clear()
    this.statsMap.clear()
    this.ttftSamples.clear()
    this.latencySamples.clear()
  }

  loadSession(sessionID: string): void {
    this.firstPartTimes.clear()
    this.firstOutputTimes.clear()
    this.statsMap.clear()
    this.ttftSamples.clear()
    this.latencySamples.clear()

    if (!sessionID) return

    try {
      if (!existsSync(LOG_PATH)) return
      const content = readFileSync(LOG_PATH, "utf-8").trim()
      if (!content) return
      const lines = content.split("\n")
      for (const line of lines) {
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
    } catch {
      // Non-critical loading failure
    }
  }
}

export function createPerfTracker(): PerfTracker {
  return new PerfTracker()
}
export type { PartEvent, PerfTracker }
export function readLogs(last: number = 50): LogEntry[] {
  const tracker = new PerfTracker()
  return tracker.readLogs(last)
}
