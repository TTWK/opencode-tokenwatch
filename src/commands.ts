import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport } from "./queries.js"
import { formatUsageReport } from "./formatter.js"
import { t } from "./i18n.js"
import type { SidebarConfig } from "./sidebar.jsx"

const DEFAULT_CONFIG: SidebarConfig = {
  sidebar: { showPerformance: true, showPricing: true, showTokenDistribution: true, showTrend: true },
  language: "auto",
}

export async function registerCommands(api: TuiPluginApi): Promise<void> {
  api.command?.register(() => [
    {
      value: "tokenwatch-usage",
      title: "Token Usage & Performance",
      description: "View detailed token usage and performance report",
      category: "Stats",
      slash: { name: "usage", aliases: ["tokens", "tokenwatch"] },
      onSelect: async () => {
        await showUsageReport(api)
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

async function showUsageReport(api: TuiPluginApi): Promise<void> {
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
