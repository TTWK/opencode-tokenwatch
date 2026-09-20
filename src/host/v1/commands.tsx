/** @jsxImportSource @opentui/solid */
/**
 * v1 命令注册 —— /usage 菜单（HTML 报告 / JSON 导出 / 文本报告 / 设置）。
 *
 * v1 拥有原生 DialogSelect 对话栈，UX 优于通用 select，因此菜单在此原生实现；
 * 实际动作（取数、装配、落盘、打开）全部委托内核层，与 v2 行为一致。
 */
import type { TuiDialogStack, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport, getPresetRange } from "./data-source.js"
import type { UsageFilters } from "../../kernel/format.js"
import { formatUsageReport } from "../../kernel/format.js"
import {
  buildCombinedData,
  ensureReportDir,
  getRangeSlug,
  openInBrowser,
  writeHtmlReport,
} from "../../kernel/report.js"
import { t, setLanguage } from "../../kernel/i18n.js"
import type { SupportedLanguage } from "../../kernel/i18n.js"
import type { SidebarConfig, SidebarToggleKey } from "../../kernel/config.js"
import {
  bumpVersion,
  loadConfig as loadConfigKernel,
  saveConfig,
} from "../../kernel/config.js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

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

/** v1 kv 的 KeyValueStore 折叠（设置逻辑经由内核，与 v2 行为一致） */
function makeStore(api: TuiPluginApi) {
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const v = api.kv?.get?.(key)
        return (v === undefined || v === null ? fallback : v) as T
      } catch {
        return fallback
      }
    },
    set<T>(key: string, value: T): void {
      try {
        api.kv?.set?.(key, value)
      } catch { /* non-critical */ }
    },
  }
}

function loadConfigFromStore(api: TuiPluginApi): SidebarConfig {
  // v1 的 opencode.json 插件配置经 state.config 读取（与 sidebar 同源）
  let pluginConfig: Record<string, any> | undefined
  try {
    pluginConfig = (api.state as any)?.config as Record<string, any> | undefined
  } catch { /* ignore */ }
  return loadConfigKernel(makeStore(api), pluginConfig)
}

function showHtmlReport(api: TuiPluginApi, filters: UsageFilters = {}, presetTag?: string): void {
  void (async () => {
    try {
      const usage = await getUsageReport(filters)
      const data = buildCombinedData(usage)
      const filePath = writeHtmlReport(data, getRangeSlug(filters, presetTag))

      api.ui.toast?.({ message: `Report: ${filePath}`, variant: "info" })
      openInBrowser(filePath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
    }
  })()
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
            showHtmlReport(api, { startDate: s, endDate: s }, "today")
          },
        },
        {
          title: t("menu7d"),
          value: "7d",
          onSelect: () => { dialog.clear(); showHtmlReport(api, getPresetRange("7d"), "7d") },
        },
        {
          title: t("menu30d"),
          value: "30d",
          onSelect: () => { dialog.clear(); showHtmlReport(api, getPresetRange("30d"), "30d") },
        },
        {
          title: t("menuAll"),
          value: "all",
          onSelect: () => { dialog.clear(); showHtmlReport(api, getPresetRange("all"), "all") },
        },
      ]}
      flat={true}
    />
  ))
}

function showUsageMenu(api: TuiPluginApi, dialog: TuiDialogStack): void {
  try { setLanguage(loadConfigFromStore(api).language) } catch {}
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
  const current = loadConfigFromStore(api).language
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
  const store = makeStore(api)
  saveConfig(store, { ...loadConfigFromStore(api), language: lang })
  bumpVersion(store)
  setLanguage(lang)
}

function toggleSidebarSetting(api: TuiPluginApi, key: SidebarToggleKey): void {
  const store = makeStore(api)
  const current = loadConfigFromStore(api)
  current.sidebar[key] = !current.sidebar[key]
  saveConfig(store, current)
  bumpVersion(store)
}
