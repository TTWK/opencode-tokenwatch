/**
 * 报告数据装配与文件落地 —— 与宿主完全无关的内核逻辑。
 *
 * 所有函数不引用任何 opentui / opencode 类型，v1 与 v2 宿主共用同一份实现。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import type { CombinedReportData, HtmlReportMeta, UsageFilters, UsageReport } from "./format.js"
import { generateUsageHtml } from "./report-html.js"
import { readLogs, getWindowPerfStats } from "./perf.js"

/** 本地时区 YYYY-MM-DD（toISOString 按 UTC，跨时区会偏一天）—— 全项目统一日期出口 */
export function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 报告输出目录（~/.opencode/reports） */
export function ensureReportDir(): string {
  const dir = join(homedir(), ".opencode", "reports")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 用系统默认程序打开文件（多平台，失败静默；spawn detached 不阻塞 TUI） */
export function openInBrowser(filePath: string): void {
  try {
    const platform = process.platform
    let child
    if (platform === "win32") {
      // start 是 cmd 内建命令，须经 cmd.exe 调起
      child = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", filePath], {
        detached: true, stdio: "ignore", windowsHide: true,
      })
    } else if (platform === "darwin") {
      child = spawn("open", [filePath], { detached: true, stdio: "ignore" })
    } else {
      child = spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" })
    }
    // detached + unref：浏览器启动失败/挂起都不影响 TUI（错误事件静默吞掉）
    child.once("error", () => { })
    child.unref()
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

function nowStamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function localDayOfTs(ts: string | number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * 装配完整报告数据。
 *
 * `usage` 由宿主数据源提供（v1 走 SQL、v2 走客户端遍历），
 * 其余全部来自内核，因此两代宿主产出的报告结构完全一致。
 */
export function buildCombinedData(usage: UsageReport): CombinedReportData {
  const activeModels = new Set(usage.models.map((m) => `${m.provider}/${m.model}`))
  const perfSummary = getWindowPerfStats(usage.filters ?? {}, activeModels)

  // perfLogs: 仅用于 JSON 导出参考，严格按当前窗口与活跃模型过滤，避免历史日志泄漏
  const rawLogs = readLogs(500)
  const hasFilter = !!(
    usage.filters?.startDate ||
    usage.filters?.endDate ||
    usage.filters?.sessionId ||
    usage.filters?.model ||
    usage.filters?.provider
  )
  const logs = hasFilter
    ? rawLogs.filter((entry) => {
        if (usage.filters?.sessionId && entry.sessionID !== usage.filters.sessionId) return false
        if (usage.filters?.provider && entry.providerID !== usage.filters.provider) return false
        if (usage.filters?.model && entry.modelID !== usage.filters.model) return false
        if (activeModels.size > 0 && !activeModels.has(entry.model)) return false
        const day = localDayOfTs(entry.ts)
        if (usage.filters?.startDate && day < usage.filters.startDate) return false
        if (usage.filters?.endDate && day > usage.filters.endDate) return false
        return true
      })
    : rawLogs

  const daily = usage.daily ?? []
  let startDate = usage.filters?.startDate
  let endDate = usage.filters?.endDate
  if (!startDate) {
    startDate = daily.length > 0 ? daily[daily.length - 1].day : "—"
  }
  if (!endDate) {
    endDate = daily.length > 0 ? daily[0].day : "—"
  }

  const meta: HtmlReportMeta = {
    generatedAt: nowStamp(),
    dateRange: {
      start: startDate,
      end: endDate,
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
