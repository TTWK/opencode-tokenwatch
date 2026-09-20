/**
 * 报告数据装配与文件落地 —— 与宿主完全无关的内核逻辑。
 *
 * 所有函数不引用任何 opentui / opencode 类型，v1 与 v2 宿主共用同一份实现。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { execSync } from "node:child_process"
import type { LogEntry, ModelPerfStats } from "./format.js"
import { accumulateEntry, createAccumulator, finalizeAccumulator, type ModelAccumulator } from "./perf-aggregate.js"
import type { CombinedReportData, HtmlReportMeta, UsageFilters, UsageReport } from "./format.js"
import { generateUsageHtml } from "./report-html.js"
import { readPersistedStats } from "./store.js"
import { readLogs } from "./perf.js"

/**
 * 从 JSONL 日志聚合性能统计。
 *
 * 分母使用各自独立的样本计数（ttftCount/tpsCount/latencyCount），
 * 而非 requestCount —— 缺失指标的请求不能拉低平均值。
 * 全零 token 条目（失败/未完成请求）被跳过。
 */
export function aggregatePerfStats(logs: LogEntry[]): ModelPerfStats[] {
  const map = new Map<string, ModelAccumulator>()
  for (const entry of logs) {
    let acc = map.get(entry.model)
    if (!acc) {
      acc = createAccumulator(entry.model, entry.providerID)
      map.set(entry.model, acc)
    }
    accumulateEntry(acc, entry)
  }
  return Array.from(map.values()).map(finalizeAccumulator)
}

/** 报告输出目录（~/.opencode/reports） */
export function ensureReportDir(): string {
  const dir = join(homedir(), ".opencode", "reports")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 用系统默认程序打开文件（多平台，失败静默） */
export function openInBrowser(filePath: string): void {
  try {
    const platform = process.platform
    if (platform === "win32") execSync(`start "" "${filePath}"`, { windowsHide: true, timeout: 5000 })
    else if (platform === "darwin") execSync(`open "${filePath}"`, { timeout: 5000 })
    else execSync(`xdg-open "${filePath}"`, { timeout: 5000 })
  } catch { /* silently fail */ }
}

export function getRangeSlug(filters: UsageFilters, presetTag?: string): string {
  if (presetTag) return presetTag
  if (!filters.startDate && !filters.endDate) return "all"
  if (filters.startDate && filters.endDate) {
    if (filters.startDate === filters.endDate) {
      const today = localDateStr(new Date())
      if (filters.startDate === today) return "today"
      return filters.startDate
    }
    return `${filters.startDate.replace(/-/g, "")}_${filters.endDate.replace(/-/g, "")}`
  }
  if (filters.startDate) return `from_${filters.startDate.replace(/-/g, "")}`
  if (filters.endDate) return `until_${filters.endDate.replace(/-/g, "")}`
  return "custom"
}

/** 生成不覆盖已有文件的报告路径（同名追加时间戳，仍冲突则递增后缀） */
export function generateUniqueReportPath(dir: string, rangeSlug: string): string {
  const dateStr = localDateStr(new Date())
  const baseName = `tokenwatch-${rangeSlug}-${dateStr}`
  let targetPath = join(dir, `${baseName}.html`)

  if (!existsSync(targetPath)) return targetPath

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const timeSuffix = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  targetPath = join(dir, `${baseName}_${timeSuffix}.html`)

  let counter = 1
  while (existsSync(targetPath)) {
    targetPath = join(dir, `${baseName}_${timeSuffix}_${counter}.html`)
    counter++
  }
  return targetPath
}

/** 本地时区 YYYY-MM-DD（toISOString 按 UTC，跨时区会偏一天） */
function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nowStamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/**
 * 装配完整报告数据。
 *
 * `usage` 由宿主数据源提供（v1 走 SQL、v2 走客户端遍历），
 * 其余全部来自内核，因此两代宿主产出的报告结构完全一致。
 */
export function buildCombinedData(usage: Omit<UsageReport, "filters">): CombinedReportData {
  // perfLogs: 仅用于 JSON 导出参考，保持适当窗口即可
  const logs = readLogs(200)
  // perfSummary: 持久化聚合统计，覆盖插件安装以来的全量历史，不受 JSONL 轮转影响
  const perfSummary = readPersistedStats()

  const daily = usage.daily ?? []
  const meta: HtmlReportMeta = {
    generatedAt: nowStamp(),
    dateRange: {
      start: daily.length > 0 ? daily[daily.length - 1].day : "—",
      end: daily.length > 0 ? daily[0].day : "—",
    },
  }

  return {
    ...usage,
    perfLogs: logs,
    perfSummary,
    meta,
  }
}

/** 生成 HTML 报告并写入磁盘，返回文件路径 */
export function writeHtmlReport(data: CombinedReportData, rangeSlug: string): string {
  const html = generateUsageHtml(data)
  const dir = ensureReportDir()
  const filePath = generateUniqueReportPath(dir, rangeSlug)
  writeFileSync(filePath, html, "utf-8")
  return filePath
}
