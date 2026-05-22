import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport } from "./queries.js"
import { formatUsageReport } from "./formatter.js"
import type { CombinedReportData, HtmlReportMeta } from "./formatter.js"
import { generateUsageHtml } from "./generate-usage-html.js"
import { t } from "./i18n.js"
import type { SidebarConfig } from "./sidebar.jsx"
import { readLogs } from "./perf-tracker.js"
import type { LogEntry, ModelPerfStats } from "./formatter.js"
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

function aggregatePerfStats(logs: LogEntry[]): ModelPerfStats[] {
  const map = new Map<string, ModelPerfStats>()
  for (const entry of logs) {
    const key = entry.model
    let s = map.get(key)
    if (!s) {
      s = {
        model: key,
        providerID: entry.providerID,
        requestCount: 0,
        totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0, totalCost: 0,
        avgTTFT: null, maxTTFT: null, minTTFT: null,
        avgTPS: null, maxTPS: null, minTPS: null,
        avgLatency: null, maxLatency: null, minLatency: null,
      }
      map.set(key, s)
    }
    s.requestCount++
    s.totalInput += entry.inputTokens
    s.totalOutput += entry.outputTokens
    s.totalCacheRead += entry.cacheReadTokens
    s.totalCacheWrite += entry.cacheWriteTokens
    s.totalCost += entry.cost

    const c = s.requestCount
    if (entry.ttft_ms != null) {
      s.avgTTFT = s.avgTTFT != null ? s.avgTTFT + (entry.ttft_ms - s.avgTTFT) / c : entry.ttft_ms
      s.maxTTFT = s.maxTTFT != null ? Math.max(s.maxTTFT, entry.ttft_ms) : entry.ttft_ms
      s.minTTFT = s.minTTFT != null ? Math.min(s.minTTFT, entry.ttft_ms) : entry.ttft_ms
    }
    if (entry.tps != null) {
      s.avgTPS = s.avgTPS != null ? s.avgTPS + (entry.tps - s.avgTPS) / c : entry.tps
      s.maxTPS = s.maxTPS != null ? Math.max(s.maxTPS, entry.tps) : entry.tps
      s.minTPS = s.minTPS != null ? Math.min(s.minTPS, entry.tps) : entry.tps
    }
    if (entry.latency_ms != null) {
      s.avgLatency = s.avgLatency != null ? s.avgLatency + (entry.latency_ms - s.avgLatency) / c : entry.latency_ms
      s.maxLatency = s.maxLatency != null ? Math.max(s.maxLatency, entry.latency_ms) : entry.latency_ms
      s.minLatency = s.minLatency != null ? Math.min(s.minLatency, entry.latency_ms) : entry.latency_ms
    }
  }
  return Array.from(map.values())
}

async function buildCombinedData(api: TuiPluginApi): Promise<CombinedReportData> {
  const report = await getUsageReport({})
  const logs = readLogs(1000)

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
    perfSummary: aggregatePerfStats(logs),
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
    api.ui.toast?.({ message: formatted, variant: "info" })
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
