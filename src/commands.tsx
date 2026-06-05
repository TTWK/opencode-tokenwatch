import type { TuiDialogStack, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport, getPresetRange } from "./queries.js"
import type { UsageFilters } from "./formatter.js"
import { formatUsageReport } from "./formatter.js"
import type { CombinedReportData, HtmlReportMeta } from "./formatter.js"
import { generateUsageHtml } from "./generate-usage-html.js"
import { t, setLanguage } from "./i18n.js"
import type { SupportedLanguage } from "./i18n.js"
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
      value: "tokenwatch-usage",
      title: "TokenWatch",
      description: "Token usage reports, export, and settings",
      category: "Stats",
      slash: { name: "usage" },
      onSelect: async (dialog) => {
        if (dialog) showUsageMenu(api, dialog)
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

/** 线性插值百分位数，输入须为有序数组 */
function computePercentile(sortedArr: number[], p: number): number | null {
  if (sortedArr.length === 0) return null
  if (sortedArr.length === 1) return sortedArr[0]
  const idx = (p / 100) * (sortedArr.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedArr[lo]
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo)
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
        ttftCount: 0,    // Bug fix: 独立维护有效样本计数
        tpsCount: 0,
        latencyCount: 0,
        totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0, totalCost: 0,
        avgTTFT: null, maxTTFT: null, minTTFT: null,
        p50TTFT: null, p95TTFT: null, p99TTFT: null,
        avgTPS: null, maxTPS: null, minTPS: null,
        avgLatency: null, maxLatency: null, minLatency: null,
        p50Latency: null, p95Latency: null, p99Latency: null,
        cacheHitRate: null,
      }
      map.set(key, s)
    }
    s.requestCount++
    s.totalInput += entry.inputTokens
    s.totalOutput += entry.outputTokens
    s.totalCacheRead += entry.cacheReadTokens
    s.totalCacheWrite += entry.cacheWriteTokens
    s.totalCost += entry.cost

    if (entry.ttft_ms != null) {
      // Bug fix: 分母使用 ttftCount（有效样本数），而非 requestCount（总请求数）
      s.ttftCount++
      const c = s.ttftCount
      s.avgTTFT = s.avgTTFT != null ? s.avgTTFT + (entry.ttft_ms - s.avgTTFT) / c : entry.ttft_ms
      s.maxTTFT = s.maxTTFT != null ? Math.max(s.maxTTFT, entry.ttft_ms) : entry.ttft_ms
      s.minTTFT = s.minTTFT != null ? Math.min(s.minTTFT, entry.ttft_ms) : entry.ttft_ms
    }
    if (entry.tps != null) {
      // Bug fix: 分母使用 tpsCount（有效样本数）
      s.tpsCount++
      const c = s.tpsCount
      s.avgTPS = s.avgTPS != null ? s.avgTPS + (entry.tps - s.avgTPS) / c : entry.tps
      s.maxTPS = s.maxTPS != null ? Math.max(s.maxTPS, entry.tps) : entry.tps
      s.minTPS = s.minTPS != null ? Math.min(s.minTPS, entry.tps) : entry.tps
    }
    if (entry.latency_ms != null) {
      s.latencyCount++
      const c = s.latencyCount
      s.avgLatency = s.avgLatency != null ? s.avgLatency + (entry.latency_ms - s.avgLatency) / c : entry.latency_ms
      s.maxLatency = s.maxLatency != null ? Math.max(s.maxLatency, entry.latency_ms) : entry.latency_ms
      s.minLatency = s.minLatency != null ? Math.min(s.minLatency, entry.latency_ms) : entry.latency_ms
    }
  }

  // 分位数后处理：需要收集每个模型的所有样本然后计算
  // 注： 此处采用单次遍历日志重新收集分数据，需要两次遍历
  const ttftBuckets = new Map<string, number[]>()
  const latBuckets = new Map<string, number[]>()
  for (const entry of logs) {
    const key = entry.model
    if (entry.ttft_ms != null) {
      const arr = ttftBuckets.get(key) ?? []
      arr.push(entry.ttft_ms)
      ttftBuckets.set(key, arr)
    }
    if (entry.latency_ms != null) {
      const arr = latBuckets.get(key) ?? []
      arr.push(entry.latency_ms)
      latBuckets.set(key, arr)
    }
  }

  const result = Array.from(map.values())
  for (const s of result) {
    const ttftArr = [...(ttftBuckets.get(s.model) ?? [])].sort((a, b) => a - b)
    s.p50TTFT = computePercentile(ttftArr, 50)
    s.p95TTFT = computePercentile(ttftArr, 95)
    s.p99TTFT = computePercentile(ttftArr, 99)

    const latArr = [...(latBuckets.get(s.model) ?? [])].sort((a, b) => a - b)
    s.p50Latency = computePercentile(latArr, 50)
    s.p95Latency = computePercentile(latArr, 95)
    s.p99Latency = computePercentile(latArr, 99)

    const denom = s.totalInput + s.totalCacheRead
    s.cacheHitRate = denom > 0 ? (s.totalCacheRead / denom) * 100 : null
  }
  return result
}


async function buildCombinedData(api: TuiPluginApi, filters: UsageFilters = {}): Promise<CombinedReportData> {
  const report = await getUsageReport(filters)
  const logs = readLogs(1000)

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const meta: HtmlReportMeta = {
    generatedAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
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

async function showHtmlReport(api: TuiPluginApi, filters: UsageFilters = {}): Promise<void> {
  try {
    const data = await buildCombinedData(api, filters)
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

function showHtmlReportRangeMenu(api: TuiPluginApi, dialog: TuiDialogStack): void {
  dialog.replace(() => (
    <api.ui.DialogSelect
      title={t("cmdTitleHtml")}
      placeholder="Select date range..."
      options={[
        {
          title: t("menuToday"),
          value: "today",
          onSelect: () => {
            dialog.clear()
            const d = new Date()
            const pad = (n: number) => String(n).padStart(2, "0")
            const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
            showHtmlReport(api, { startDate: s, endDate: s })
          },
        },
        {
          title: t("menu7d"),
          value: "7d",
          onSelect: () => { dialog.clear(); showHtmlReport(api, getPresetRange("7d")) },
        },
        {
          title: t("menu30d"),
          value: "30d",
          onSelect: () => { dialog.clear(); showHtmlReport(api, getPresetRange("30d")) },
        },
        {
          title: t("menuAll"),
          value: "all",
          onSelect: () => { dialog.clear(); showHtmlReport(api, getPresetRange("all")) },
        },
      ]}
      flat={true}
    />
  ))
}

function showUsageMenu(api: TuiPluginApi, dialog: TuiDialogStack): void {
  dialog.replace(() => (
    <api.ui.DialogSelect
      title={t("panelTitle")}
      placeholder="Select an action..."
      options={[
        {
          title: `${t("cmdTitleHtml")} ▸`,
          value: "html",
          description: t("cmdDescHtml"),
          onSelect: () => showHtmlReportRangeMenu(api, dialog),
        },
        {
          title: t("cmdTitleJson"),
          value: "json",
          description: t("cmdDescJson"),
          onSelect: () => { dialog.clear(); showJsonExport(api) },
        },
        {
          title: t("cmdTitleText"),
          value: "text",
          description: t("cmdDescText"),
          onSelect: () => { dialog.clear(); showTextReport(api) },
        },
        {
          title: `${t("cmdTitleSettings")} ▸`,
          value: "settings",
          description: t("cmdDescSettings"),
          onSelect: () => showSettingsDialog(api, dialog),
        },
      ]}
      flat={true}
    />
  ))
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
    const dir = ensureReportDir()
    const dateStr = new Date().toISOString().slice(0, 10)
    const filePath = join(dir, `tokenwatch-${dateStr}.md`)
    writeFileSync(filePath, formatted, "utf-8")
    api.ui.toast?.({ message: `Report saved to ${filePath}`, variant: "info" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}

function saveConfigToStore(api: TuiPluginApi, cfg: SidebarConfig): void {
  api.kv?.set?.("tokenwatch-config", cfg)
}

let lastSelectedSetting: string | undefined

function showSettingsDialog(api: TuiPluginApi, dialog?: TuiDialogStack): void {
  if (!dialog) return

  const reopen = (value: string) => {
    lastSelectedSetting = value
    setTimeout(() => showSettingsDialog(api, dialog), 0)
  }

  const cfg = loadConfigFromStore(api).sidebar

  dialog.replace(() => (
    <api.ui.DialogSelect
      title={t("settingsTitle")}
      placeholder={t("settingsPlaceholder")}
      options={[
        {
          title: `${cfg.showPerformance ? "✓ " : "  "}${t("showPerformance")}`,
          value: "showPerformance",
          description: t("descShowPerformance"),
          onSelect: () => { toggleSidebarSetting(api, "showPerformance"); reopen("showPerformance") },
        },
        {
          title: `${cfg.showPricing ? "✓ " : "  "}${t("showPricing")}`,
          value: "showPricing",
          description: t("descShowPricing"),
          onSelect: () => { toggleSidebarSetting(api, "showPricing"); reopen("showPricing") },
        },
        {
          title: `${cfg.showTokenDistribution ? "✓ " : "  "}${t("showTokenDistribution")}`,
          value: "showTokenDistribution",
          description: t("descShowTokenDistribution"),
          onSelect: () => { toggleSidebarSetting(api, "showTokenDistribution"); reopen("showTokenDistribution") },
        },
        {
          title: `${cfg.showTrend ? "✓ " : "  "}${t("showTrend")}`,
          value: "showTrend",
          description: t("descShowTrend"),
          onSelect: () => { toggleSidebarSetting(api, "showTrend"); reopen("showTrend") },
        },
        {
          title: `${t("settingsLanguage")} ▸`,
          value: "language",
          description: t("descSettingsLanguage"),
          onSelect: () => showLanguageMenu(api, dialog),
        },
        {
          title: t("done"),
          value: "done",
          description: t("closeSettings"),
          onSelect: () => { lastSelectedSetting = undefined; dialog.clear() },
        },
      ]}
      flat={true}
      current={lastSelectedSetting}
    />
  ))
}

function showLanguageMenu(api: TuiPluginApi, dialog: TuiDialogStack): void {
  const current = (api.kv?.get?.("tokenwatch-config") as Partial<SidebarConfig>)?.language ?? "auto"
  dialog.replace(() => (
    <api.ui.DialogSelect
      title={t("settingsLanguage")}
      placeholder={t("settingsLanguage")}
      options={[
        {
          title: `${current === "auto" ? "✓ " : "  "}${t("langAuto")}`,
          value: "auto",
          description: "自动检测 / Auto-detect",
          onSelect: () => { setLanguageSetting(api, "auto"); lastSelectedSetting = "language"; dialog.clear(); showSettingsDialog(api, dialog) },
        },
        {
          title: `${current === "zh" ? "✓ " : "  "}中文`,
          value: "zh",
          description: "简体中文",
          onSelect: () => { setLanguageSetting(api, "zh"); lastSelectedSetting = "language"; dialog.clear(); showSettingsDialog(api, dialog) },
        },
        {
          title: `${current === "en" ? "✓ " : "  "}English`,
          value: "en",
          description: "English",
          onSelect: () => { setLanguageSetting(api, "en"); lastSelectedSetting = "language"; dialog.clear(); showSettingsDialog(api, dialog) },
        },
      ]}
      flat={true}
    />
  ))
}

function setLanguageSetting(api: TuiPluginApi, lang: SupportedLanguage | "auto"): void {
  setLanguage(lang)
  const current = loadConfigFromStore(api)
  current.language = lang
  saveConfigToStore(api, current)
  const v = (api.kv?.get?.("tokenwatch-config-version") as number ?? 0) + 1
  api.kv?.set?.("tokenwatch-config-version", v)
}

function toggleSidebarSetting(api: TuiPluginApi, key: keyof SidebarConfig["sidebar"]): void {
  const current = loadConfigFromStore(api)
  current.sidebar[key] = !current.sidebar[key]
  saveConfigToStore(api, current)
  const v = (api.kv?.get?.("tokenwatch-config-version") as number ?? 0) + 1
  api.kv?.set?.("tokenwatch-config-version", v)
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
