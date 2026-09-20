/** @jsxImportSource @opentui/solid */
/**
 * v1 命令注册 —— /usage 菜单（HTML 报告 / JSON 导出 / 文本报告 / 设置）。
 *
 * v1 拥有原生 DialogSelect 对话栈，UX 优于通用 select，因此菜单在此原生实现；
 * 实际动作（取数、装配、落盘、打开）全部委托内核层，与 v2 行为一致。
 */
import type { TuiDialogStack, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport, getPresetRange } from "./data-source.js"
import { makeStore } from "./adapter.js"
import type { UsageFilters } from "../../kernel/format.js"
import { formatUsageReport } from "../../kernel/format.js"
import {
  buildCombinedData,
  ensureReportDir,
  getRangeSlug,
  localDateStr,
  openInBrowser,
  writeHtmlReport,
} from "../../kernel/report.js"
import { t, setLanguage } from "../../kernel/i18n.js"
import type { SupportedLanguage } from "../../kernel/i18n.js"
import type { SidebarConfig, SidebarToggleKey } from "../../kernel/config.js"
import {
  loadConfig as loadConfigKernel,
  setLanguageSetting as setLanguageSettingKernel,
  toggleSidebarSetting as toggleSettingKernel,
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

/** kv store 复用 adapter 的同一份折叠实现（避免两套 kv 语义漂移，审查 #13） */
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
            const today = localDateStr(new Date())
            showHtmlReport(api, { startDate: today, endDate: today }, "today")
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
    // 本地日期命名：toISOString 按 UTC，晚间导出会落错"今天"
    const dateStr = localDateStr(new Date())
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
    const dateStr = localDateStr(new Date())
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

/** 设置动作复用 kernel/config 的单一实现（其 saveConfig 内部已 bumpVersion） */
function setLanguageSetting(api: TuiPluginApi, lang: SupportedLanguage | "auto"): void {
  setLanguageSettingKernel(makeStore(api), lang)
  setLanguage(lang)
}

function toggleSidebarSetting(api: TuiPluginApi, key: SidebarToggleKey): void {
  toggleSettingKernel(makeStore(api), key)
}
