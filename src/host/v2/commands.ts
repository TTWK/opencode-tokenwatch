/**
 * v2 命令注册 —— 通过 keymap.layer 暴露 /usage 斜杠命令与面板命令。
 *
 * 菜单用宿主通用 `dialog.select` 实现（v2 无 DialogSelect 对话栈），
 * 动作复用两代共享的 command-actions，行为与 v1 菜单一致。
 */
import type { HostAdapter, CommandSpec, SelectOption } from "../types.js"
import { createCommandActions, rangePresets } from "../command-actions.js"
import type { SidebarToggleKey } from "../../kernel/config.js"
import { t, setLanguage } from "../../kernel/i18n.js"
import type { SupportedLanguage } from "../../kernel/i18n.js"

const TOGGLE_KEYS: readonly SidebarToggleKey[] = [
  "showPerformance",
  "showPricing",
  "showTokenDistribution",
  "showTrend",
]

const TOGGLE_LABELS: Record<SidebarToggleKey, () => string> = {
  showPerformance: () => t("showPerformance"),
  showPricing: () => t("showPricing"),
  showTokenDistribution: () => t("showTokenDistribution"),
  showTrend: () => t("showTrend"),
}

/** 主菜单：与 v1 showUsageMenu 的四个入口一一对应 */
async function showUsageMenu(host: HostAdapter): Promise<void> {
  const actions = createCommandActions(host)
  setLanguage(actions.config().language)

  type MenuValue = "html" | "json" | "text" | "settings"
  const choice = await host.select<MenuValue>({
    title: t("panelTitle"),
    options: [
      { title: t("cmdTitleHtml"), value: "html", description: t("cmdDescHtml") },
      { title: t("cmdTitleJson"), value: "json", description: t("cmdDescJson") },
      { title: t("cmdTitleText"), value: "text", description: t("cmdDescText") },
      { title: t("cmdTitleSettings"), value: "settings", description: t("cmdDescSettings") },
    ],
  })
  if (choice === undefined) return

  switch (choice) {
    case "html": {
      const presets = rangePresets()
      const picked = await host.select<string>({
        title: t("cmdTitleHtml"),
        options: presets.map((p) => ({ title: p.label, value: p.id })),
      })
      if (picked === undefined) return
      const preset = presets.find((p) => p.id === picked)
      if (preset) await actions.htmlReport(preset.filters, preset.tag)
      return
    }
    case "json":
      return actions.jsonExport()
    case "text":
      return actions.textReport()
    case "settings":
      return showSettingsMenu(host)
  }
}

/** 设置菜单：与 v1 showSettingsDialog 等价的开关 + 语言选择 */
async function showSettingsMenu(host: HostAdapter): Promise<void> {
  const actions = createCommandActions(host)

  type SettingValue = SidebarToggleKey | "language" | "done"
  const options: readonly SelectOption<SettingValue>[] = [
    ...TOGGLE_KEYS.map((key): SelectOption<SettingValue> => ({
      title: `${actions.config().sidebar[key] ? "✓ " : "  "}${TOGGLE_LABELS[key]()}`,
      value: key,
    })),
    { title: t("settingsLanguage"), value: "language" as SettingValue },
    { title: t("done"), value: "done" as SettingValue },
  ]

  const choice = await host.select<SettingValue>({ title: t("settingsTitle"), options })
  if (choice === undefined || choice === "done") return

  if (choice === "language") {
    type LangValue = "auto" | "zh" | "en"
    const current = actions.config().language
    const lang = await host.select<LangValue>({
      title: t("settingsLanguage"),
      options: [
        { title: `${current === "auto" ? "✓ " : "  "}${t("langAuto")}`, value: "auto" as LangValue },
        { title: `${current === "zh" ? "✓ " : "  "}中文`, value: "zh" as LangValue },
        { title: `${current === "en" ? "✓ " : "  "}English`, value: "en" as LangValue },
      ],
    })
    if (lang !== undefined) actions.setLanguage(lang)
    return
  }

  actions.toggle(choice)
  // 重开菜单以刷新勾选状态
  await showSettingsMenu(host)
}

export function registerV2Commands(host: HostAdapter): void {
  const specs: readonly CommandSpec[] = [
    {
      id: "tokenwatch.usage",
      title: "TokenWatch",
      description: "Token usage reports, export, and settings",
      category: "Stats",
      slash: "usage",
      run: () => showUsageMenu(host),
    },
  ]
  host.registerCommands(specs)
}
