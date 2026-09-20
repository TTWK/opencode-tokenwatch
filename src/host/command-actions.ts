/**
 * 命令动作 —— 两代宿主共享的报告/设置逻辑。
 *
 * 只依赖 `HostAdapter`，不含任何 dialog 代码：
 * 菜单导航由各宿主实现（v1 用 DialogSelect，v2 用 dialog.select），
 * 具体动作（生成报告、改设置）在这里统一，保证两代行为一致。
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HostAdapter } from "./types.js"
import type { SidebarConfig, SidebarToggleKey } from "../kernel/config.js"
import { loadConfig, toggleSidebarSetting, setLanguageSetting } from "../kernel/config.js"
import {
  buildCombinedData,
  ensureReportDir,
  getRangeSlug,
  openInBrowser,
  writeHtmlReport,
} from "../kernel/report.js"
import { formatUsageReport } from "../kernel/format.js"
import type { UsageFilters, UsageReport } from "../kernel/format.js"
import { setLanguage, t } from "../kernel/i18n.js"

/**
 * 取用量数据，必要时先告知用户。
 *
 * v2 没有 `opencode db`，历史统计要遍历全部会话消息重算，
 * 首次可达数秒；若不提示，TUI 会表现为"点了没反应"。
 */
async function fetchUsage(host: HostAdapter, filters: UsageFilters): Promise<UsageReport> {
  if (host.dataSource.needsFirstRunNotice && host.dataSource.isCold()) {
    host.notify(t("noticeFirstScan"), "info")
  }
  return host.dataSource.getUsageReport(filters)
}

function errMsg(err: unknown): string {
  return `${t("toastError")}: ${err instanceof Error ? err.message : String(err)}`
}

function stamp(): string {
  // 本地日期（与报告 range 过滤的本地分桶一致，避免晚间导出落错"今天"）
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface CommandActions {
  htmlReport(filters?: UsageFilters, presetTag?: string): Promise<void>
  jsonExport(): Promise<void>
  textReport(): Promise<void>
  config(): SidebarConfig
  toggle(key: SidebarToggleKey): SidebarConfig
  setLanguage(language: SidebarConfig["language"]): SidebarConfig
}

export function createCommandActions(host: HostAdapter): CommandActions {
  return {
    async htmlReport(filters = {}, presetTag) {
      try {
        const usage = await fetchUsage(host, filters)
        const data = buildCombinedData(usage)
        const filePath = writeHtmlReport(data, getRangeSlug(filters, presetTag))
        host.notify(`${t("toastReportSaved")}: ${filePath}`, "success")
        openInBrowser(filePath)
      } catch (err) {
        host.notify(errMsg(err), "error")
      }
    },

    async jsonExport() {
      try {
        const usage = await fetchUsage(host, {})
        const filePath = join(ensureReportDir(), `tokenwatch-${stamp()}.json`)
        writeFileSync(filePath, JSON.stringify(usage, null, 2), "utf-8")
        host.notify(`${t("toastJsonSaved")}: ${filePath}`, "success")
      } catch (err) {
        host.notify(errMsg(err), "error")
      }
    },

    async textReport() {
      try {
        const usage = await fetchUsage(host, {})
        const filePath = join(ensureReportDir(), `tokenwatch-${stamp()}.md`)
        writeFileSync(filePath, formatUsageReport(usage), "utf-8")
        host.notify(`${t("toastReportSaved")}: ${filePath}`, "success")
      } catch (err) {
        host.notify(errMsg(err), "error")
      }
    },

    config: () => loadConfig(host.store, host.appConfig() as Record<string, any>),
    toggle: (key) => toggleSidebarSetting(host.store, key),
    setLanguage(language) {
      const cfg = setLanguageSetting(host.store, language)
      setLanguage(language)
      return cfg
    },
  }
}

/** 报告时间范围预设，供两代宿主菜单共用 */
export interface RangePreset {
  readonly id: string
  readonly label: string
  readonly tag: string
  readonly filters: UsageFilters
}

export function rangePresets(): RangePreset[] {
  const today = stamp()
  const daysAgo = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toISOString().slice(0, 10)
  }
  return [
    { id: "all", label: t("menuAll"), tag: "all", filters: {} },
    { id: "today", label: t("menuToday"), tag: "today", filters: { startDate: today, endDate: today } },
    { id: "7d", label: t("menu7d"), tag: "7d", filters: { startDate: daysAgo(6) } },
    { id: "30d", label: t("menu30d"), tag: "30d", filters: { startDate: daysAgo(29) } },
  ]
}
