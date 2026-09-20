/**
 * stats-store.ts — 持久化聚合统计存储
 *
 * 设计目标：将性能指标的"聚合统计"与"原始 JSONL 日志"彻底解耦。
 * - 每次请求完成时，通过 updatePersistedStats() 增量写入 JSON 统计文件
 * - 统计文件永久累积，不受 JSONL 日志轮转/窗口限制影响
 * - 百分位数采用 Reservoir Sampling 保持有界内存占用
 * - 首次启动时自动从现有 JSONL 日志迁移，不丢失历史数据
 */

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { LogEntry, ModelPerfStats } from "./format.js"
import { accumulateEntry, createAccumulator, finalizeAccumulator, type ModelAccumulator } from "./perf-aggregate.js"

const STATS_PATH = join(homedir(), ".opencode", "tokenwatch-stats.json")
const LOG_PATH = join(homedir(), ".opencode", "tokenwatch.jsonl")
const LOG_PATH_ROTATED = LOG_PATH + ".1"
const CURRENT_VERSION = 1
/** 合并落盘窗口：窗口内的多次增量只做一次同步 I/O，降低 TUI 线程卡顿 */
const WRITE_COALESCE_MS = 1000

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

/** 原子写：先写临时文件再 rename，写入中途崩溃不会损坏既有统计 */
function saveStatsFileNow(file: StatsFile): void {
  try {
    file.updatedAt = new Date().toISOString()
    const tmpPath = STATS_PATH + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(file), "utf-8")
    renameSync(tmpPath, STATS_PATH)
  } catch { /* 写入失败不影响主流程 */ }
}

// 合并写状态：pending 持有尚未落盘的累计结果，flushSoon 保证至多每秒一次同步写
let pending: StatsFile | null = null
let flushScheduled = false
let lastFlushAt = 0

function flushNow(): void {
  const file = pending
  if (!file) return
  pending = null
  lastFlushAt = Date.now()
  saveStatsFileNow(file)
}

function flushSoon(): void {
  if (flushScheduled) return
  flushScheduled = true
  const timer = setTimeout(() => {
    flushScheduled = false
    flushNow()
  }, Math.max(0, WRITE_COALESCE_MS - (Date.now() - lastFlushAt)))
  timer.unref?.() // 不阻止宿主进程退出
}

// 进程退出前把未落盘的增量写出去（exit 回调只能做同步操作，writeFileSync 满足）
process.once("exit", () => { flushNow() })

// ─────────────────────────────────────────────
// 一次性迁移：从 JSONL 日志重建初始统计
// ─────────────────────────────────────────────

/** 读取单个日志文件的行（不存在/损坏时返回空） */
function readLogLines(path: string): string[] {
  try {
    if (!existsSync(path)) return []
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 如果统计文件尚未完成迁移，则读取全量 JSONL 日志并批量写入统计文件。
 * 只在首次调用 readPersistedStats() 时执行一次，之后通过 migratedFromLogs 标志跳过。
 * 轮转产生的 .1 文件保存更早的历史，也一并纳入（旧数据只存在于其中一个文件）。
 */
function migrateFromLogsIfNeeded(file: StatsFile): boolean {
  if (file.migratedFromLogs) return false
  const lines = [...readLogLines(LOG_PATH_ROTATED), ...readLogLines(LOG_PATH)]
  file.migratedFromLogs = true
  if (lines.length === 0) return true
  try {
    let migrated = 0
    for (const line of lines) {
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
    if (migrated > 0) {
      // 标记本次迁移来源，便于调试
      ;(file as any)._migratedFrom = `${LOG_PATH} (${migrated} entries)`
    }
    return true
  } catch {
    // 迁移失败时仍标记为已完成，避免每次都重试（下次重建会通过 updatePersistedStats 增量补充）
    return true
  }
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/**
 * 将一条新的日志条目增量更新到持久化统计文件。
 * 在 perf-tracker 的 appendLog() 之后调用。
 *
 * 增量先累积在内存副本上（至多每 WRITE_COALESCE_MS 落盘一次），
 * 进程正常退出时由 exit 钩子强制刷盘。
 */
export function updatePersistedStats(entry: LogEntry): void {
  try {
    // 优先在未落盘的内存副本上累积；为空时从磁盘加载（也读入其他宿主进程的写入）
    const file = pending ?? loadStatsFile()
    pending = file
    let acc = file.models[entry.model]
    if (!acc) {
      acc = createAccumulator(entry.model, entry.providerID)
      file.models[entry.model] = acc
    }
    accumulateEntry(acc, entry)
    flushSoon()
  } catch { /* 统计写入失败不影响主流程 */ }
}

/**
 * 读取所有持久化统计，返回 ModelPerfStats 数组（含分位数）。
 * 用于 HTML 报告生成，替代有限窗口的日志聚合方案。
 */
export function readPersistedStats(): ModelPerfStats[] {
  try {
    const file = pending ?? loadStatsFile()
    pending = file
    // 如果尚未迁移（例如首次生成报告前没有任何请求），执行迁移
    // 迁移时先清空 models，以 JSONL 全量数据为唯一权威来源，
    // 避免与 updatePersistedStats 先写入的零散增量数据叠加导致重复计数。
    if (!file.migratedFromLogs) {
      file.models = {}  // 清空，让迁移从零开始重建
      migrateFromLogsIfNeeded(file)
      flushNow()  // 迁移是低频操作，直接同步落盘
    }

    // 旧版本统计文件缺少 last* 字段，finalize 内部统一归一化为 null
    return Object.values(file.models).map((s) => finalizeAccumulator(s))
  } catch {
    return []
  }
}
