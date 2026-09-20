/**
 * stats-store.ts — 持久化聚合统计存储
 *
 * 设计目标：将性能指标的"聚合统计"与"原始 JSONL 日志"彻底解耦。
 * - 每次请求完成时，通过 updatePersistedStats() 增量写入 JSON 统计文件
 * - 统计文件永久累积，不受 JSONL 日志轮转/窗口限制影响
 * - 百分位数采用 Reservoir Sampling 保持有界内存占用
 * - 首次启动时自动从现有 JSONL 日志迁移，不丢失历史数据
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { LogEntry, ModelPerfStats } from "./format.js"
import { accumulateEntry, createAccumulator, finalizeAccumulator, type ModelAccumulator } from "./perf-aggregate.js"

const STATS_PATH = join(homedir(), ".opencode", "tokenwatch-stats.json")
const LOG_PATH = join(homedir(), ".opencode", "tokenwatch.jsonl")
const RESERVOIR_SIZE = 500   // 每个指标最多保留的原始样本数
const CURRENT_VERSION = 1

interface StatsFile {
  version: number
  updatedAt: string
  /** 是否已完成从 JSONL 日志的一次性迁移 */
  migratedFromLogs: boolean
  models: Record<string, ModelAccumulator>
}

// ─────────────────────────────────────────────
// 内部 I/O 工具
// ─────────────────────────────────────────────

function loadStatsFile(): StatsFile {
  try {
    if (!existsSync(STATS_PATH)) {
      return { version: CURRENT_VERSION, updatedAt: "", migratedFromLogs: false, models: {} }
    }
    const content = readFileSync(STATS_PATH, "utf-8")
    const parsed = JSON.parse(content) as StatsFile
    if (parsed?.version === CURRENT_VERSION && parsed.models) return parsed
  } catch { /* 文件损坏时返回空白统计 */ }
  return { version: CURRENT_VERSION, updatedAt: "", migratedFromLogs: false, models: {} }
}

function saveStatsFile(file: StatsFile): void {
  try {
    file.updatedAt = new Date().toISOString()
    writeFileSync(STATS_PATH, JSON.stringify(file), "utf-8")
  } catch { /* 写入失败不影响主流程 */ }
}

// ─────────────────────────────────────────────
// 一次性迁移：从 JSONL 日志重建初始统计
// ─────────────────────────────────────────────

/**
 * 如果统计文件尚未完成迁移，则读取全量 JSONL 日志并批量写入统计文件。
 * 只在首次调用 readPersistedStats() 时执行一次，之后通过 migratedFromLogs 标志跳过。
 */
function migrateFromLogsIfNeeded(file: StatsFile): boolean {
  if (file.migratedFromLogs) return false
  if (!existsSync(LOG_PATH)) {
    file.migratedFromLogs = true
    return true
  }
  try {
    const content = readFileSync(LOG_PATH, "utf-8").trim()
    if (!content) {
      file.migratedFromLogs = true
      return true
    }
    let migrated = 0
    for (const line of content.split("\n")) {
      if (!line) continue
      try {
        const entry = JSON.parse(line) as LogEntry
        if (entry.model && entry.ts) {
          let acc = file.models[entry.model]
          if (!acc) {
            acc = createAccumulator(entry.model, entry.providerID)
            file.models[entry.model] = acc
          }
          accumulateEntry(acc, entry)
          migrated++
        }
      } catch { /* 跳过格式损坏的行 */ }
    }
    file.migratedFromLogs = true
    if (migrated > 0) {
      // 标记本次迁移来源，便于调试
      ;(file as any)._migratedFrom = `${LOG_PATH} (${migrated} entries)`
    }
    return true
  } catch {
    // 迁移失败时仍标记为已完成，避免每次都重试（下次重建会通过 updatePersistedStats 增量补充）
    file.migratedFromLogs = true
    return true
  }
}

// ─────────────────────────────────────────────
// 分位数计算
// ─────────────────────────────────────────────

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null
  if (arr.length === 1) return arr[0]
  const idx = (p / 100) * (arr.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return arr[lo]
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo)
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/**
 * 将一条新的日志条目增量更新到持久化统计文件。
 * 在 perf-tracker.ts 的 appendLog() 之后调用。
 *
 * 设计原则：本函数只做增量更新，迁移逻辑由 readPersistedStats() 负责。
 * 这样可以避免迁移与增量更新之间的竞态问题。
 */
export function updatePersistedStats(entry: LogEntry): void {
  try {
    const file = loadStatsFile()
    let acc = file.models[entry.model]
    if (!acc) {
      acc = createAccumulator(entry.model, entry.providerID)
      file.models[entry.model] = acc
    }
    accumulateEntry(acc, entry)
    // 如果尚未完成迁移，先标记（避免 readPersistedStats 再重复迁移后与当前增量数据合并）
    // 实际上：首次有请求时 migratedFromLogs 必然为 false，
    // 所以 readPersistedStats 首次被调用时会重建全量历史，覆盖这个增量写入。
    // 这是可接受的：迁移完成后统计文件是完整的（含本条目，因为 JSONL 已先写入）。
    saveStatsFile(file)
  } catch { /* 统计写入失败不影响主流程 */ }
}

/**
 * 读取所有持久化统计，返回 ModelPerfStats 数组（含分位数）。
 * 用于 HTML 报告生成，替代 aggregatePerfStats(readLogs(N)) 的有限窗口方案。
 */
export function readPersistedStats(): ModelPerfStats[] {
  try {
    const file = loadStatsFile()
    // 如果尚未迁移（例如首次生成报告前没有任何请求），执行迁移
    // 迁移时先清空 models，以 JSONL 全量数据为唯一权威来源，
    // 避免与 updatePersistedStats 先写入的零散增量数据叠加导致重复计数。
    if (!file.migratedFromLogs) {
      file.models = {}  // 清空，让迁移从零开始重建
      migrateFromLogsIfNeeded(file)
      saveStatsFile(file)
    }

    // 旧版本统计文件缺少 last* 字段，finalize 内部统一归一化为 null
    return Object.values(file.models).map((s) => finalizeAccumulator(s))
  } catch {
    return []
  }
}
