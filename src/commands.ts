import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport } from "./queries.js"
import { formatUsageReport } from "./formatter.js"
import type { CombinedReportData, HtmlReportMeta } from "./formatter.js"
import { generateUsageHtml } from "./generate-usage-html.js"
import { t } from "./i18n.js"
import type { SidebarConfig } from "./sidebar.jsx"
import { createPerfTracker, readLogs } from "./perf-tracker.js"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { execSync } from "node:child_process"

const DEFAULT_CONFIG: SidebarConfig = {
  sidebar: { showPerformance: true, showPricing: true, showTokenDistribution: true, showTrend: true },
  language: "auto",
}

export async function registerCommands(api: TuiPluginApi): Promise<void> {
  api.command?.register(() => [
    {
      value: "tokenwatch-html-report",
      title: "Generate HTML report",
      description: "Generate an HTML dashboard with token usage, cache efficiency, and performance charts",
      category: "Stats",
      slash: { name: "usage-html", aliases: ["usage"] },
      onSelect: async () => {
        await showHtmlReport(api)
      },
    },
    {
      value: "tokenwatch-json-export",
      title: "Export as JSON",
      description: "Export usage data as JSON file",
      category: "Stats",
      slash: { name: "usage-json" },
      onSelect: async () => {
        await showJsonExport(api)
      },
    },
    {
      value: "tokenwatch-text-report",
      title: "Text report (legacy)",
      description: "View plain text usage report in terminal",
      category: "Stats",
      slash: { name: "usage-text" },
      onSelect: async () => {
        await showTextReport(api)
      },
    },
    {
      value: "tokenwatch-settings",
      title: "TokenWatch Settings",
      description: "Configure sidebar display options",
      category: "Stats",
      slash: { name: "usage-settings", aliases: ["tokenwatch-settings"] },
      onSelect: async () => {
        await showSettingsDialog(api)
      },
    },
  ])
}

function ensureReportDir(): string {
  const dir = join(homedir(), ".opencode", "reports")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function openInBrowser(filePath: string): void {
  try {
    const platform = process.platform
    if (platform === "win32") execSync(`start "" "${filePath}"`, { windowsHide: true, timeout: 5000 })
    else if (platform === "darwin") execSync(`open "${filePath}"`, { timeout: 5000 })
    else execSync(`xdg-open "${filePath}"`, { timeout: 5000 })
  } catch { /* silently fail */ }
}

async function buildCombinedData(api: TuiPluginApi): Promise<CombinedReportData> {
  const report = await getUsageReport({})
  const logs = readLogs(1000)
  const perfSummary = createPerfTracker().getSessionStats()

  const now = new Date()
  const meta: HtmlReportMeta = {
    generatedAt: now.toISOString().slice(0, 10) + " " + now.toISOString().slice(11, 19),
    dateRange: {
      start: report.daily.length > 0 ? report.daily[report.daily.length - 1].day : "—",
      end: report.daily.length > 0 ? report.daily[0].day : "—",
    },
  }

  return {
    ...report,
    perfLogs: logs,
    perfSummary: Object.values(perfSummary.models),
    meta,
  }
}

async function showHtmlReport(api: TuiPluginApi): Promise<void> {
  try {
    const data = await buildCombinedData(api)
    const html = generateUsageHtml(data)
    const dir = ensureReportDir()
    const dateStr = new Date().toISOString().slice(0, 10)
    const filePath = join(dir, `tokenwatch-${dateStr}.html`)
    writeFileSync(filePath, html, "utf-8")

    api.ui.toast?.({ message: `Report: ${filePath}`, variant: "info" })
    openInBrowser(filePath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}

async function showJsonExport(api: TuiPluginApi): Promise<void> {
  try {
    const report = await getUsageReport({})
    const dir = ensureReportDir()
    const dateStr = new Date().toISOString().slice(0, 10)
    const filePath = join(dir, `tokenwatch-${dateStr}.json`)
    writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8")
    api.ui.toast?.({ message: `JSON: ${filePath}`, variant: "info" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}

async function showTextReport(api: TuiPluginApi): Promise<void> {
  try {
    const report = await getUsageReport({})
    const formatted = formatUsageReport(report)
    api.ui.toast?.({ message: "Usage report generated", variant: "info" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}

async function showSettingsDialog(api: TuiPluginApi): Promise<void> {
  const currentConfig = loadConfigFromStore(api)
  const cfg = currentConfig.sidebar
  const options = [
    `[${cfg.showPerformance ? "x" : " "}] ${t("showPerformance")}`,
    `[${cfg.showPricing ? "x" : " "}] ${t("showPricing")}`,
    `[${cfg.showTokenDistribution ? "x" : " "}] ${t("showTokenDistribution")}`,
    `[${cfg.showTrend ? "x" : " "}] ${t("showTrend")}`,
    `---`,
    `${t("language")}: ${currentConfig.language}`,
  ].join("\n")

  api.ui.toast?.({ message: `TokenWatch settings:\n${options}`, variant: "info" })
}

function loadConfigFromStore(api: TuiPluginApi): SidebarConfig {
  const base = { sidebar: { ...DEFAULT_CONFIG.sidebar }, language: DEFAULT_CONFIG.language }
  try {
    const stored = api.kv?.get?.("tokenwatch-config") as Partial<SidebarConfig> | undefined
    if (stored) {
      if (stored.sidebar) Object.assign(base.sidebar, stored.sidebar)
      if (stored.language) base.language = stored.language
    }
  } catch { /* defaults */ }
  return base
}
