export type SupportedLanguage = "zh" | "en"

const zh: Record<string, string> = {
  panelTitle: "TokenWatch",
  collapse: "折叠",
  expand: "展开",
  sessionSummary: "会话累计",
  input: "输入",
  output: "输出",
  cacheRead: "缓存",
  cacheWrite: "缓存写",
  cacheMiss: "未命中",
  hitRate: "命中率",
  requests: "请求",
  cost: "成本",
  trendUp: "↑",
  trendDown: "↓",
  cache: "缓存",
  lat: "延迟",
  performance: "性能",
  pricing: "Pricing",
  tokenDistribution: "Token分布",
  modelLabel: "模型",
  provider: "提供商",
  ttft: "TTFT",
  tps: "TPS",
  latency: "延迟",
  avg: "平均",
  max: "最大",
  min: "最小",
  read: "读",
  write: "写",
  sessionAccumulated: "Session累计",
  saving: "节省",
  priceInput: "输入",
  priceCacheRead: "缓存读",
  priceCacheWrite: "缓存写",
  priceOutput: "输出",
  total: "总计",
  system: "系统提示",
  user: "用户",
  agent: "Agent指令",

  toolCall: "Tool调用",

  toolResult: "Tool结果",
  outputTokens: "输出",
  showPerformance: "显示性能指标",
  showPricing: "显示模型定价",
  showTokenDistribution: "显示Token分布",
  showTrend: "显示趋势指示器",
  language: "语言",
  auto: "自动",
  cmdTitleHtml: "HTML报告",
  cmdDescHtml: "生成交互式HTML仪表盘，展示Token用量、缓存和性能图表",
  cmdTitleJson: "JSON导出",
  cmdDescJson: "导出原始用量数据为JSON文件",
  cmdTitleText: "文本报告",
  cmdDescText: "生成纯文本报告文件",
  cmdTitleSettings: "设置",
  cmdDescSettings: "配置侧边栏显示选项",
  descShowPerformance: "在侧边栏显示TPS、TTFT、延迟等指标",
  descShowPricing: "在侧边栏显示成本估算",
  descShowTokenDistribution: "在侧边栏显示输入/输出/推理Token细分",
  descShowTrend: "在侧边栏显示Token用量趋势",
  settingsLanguage: "语言",
  descSettingsLanguage: "切换显示语言",
  settingsTitle: "TokenWatch设置",
  settingsPlaceholder: "切换设置项...",
  langAuto: "自动",
  done: "完成",
  closeSettings: "关闭设置",
  menuToday: "今天",
  menu7d: "最近 7 天",
  menu30d: "最近 30 天",
  menuAll: "全部时间",
}

const en: Record<string, string> = {
  panelTitle: "TokenWatch",
  collapse: "Collapse",
  expand: "Expand",
  sessionSummary: "Session",
  input: "Input",
  output: "Output",
  cacheRead: "Cache",
  cacheWrite: "C.Write",
  cacheMiss: "Cache Miss",
  hitRate: "Hit Rate",
  requests: "Req",
  cost: "Cost",
  trendUp: "↑",
  trendDown: "↓",
  cache: "Cache",
  lat: "Lat",
  performance: "Performance",
  pricing: "Pricing",
  tokenDistribution: "Token Distribution",
  modelLabel: "Model",
  provider: "Provider",
  ttft: "TTFT",
  tps: "TPS",
  latency: "Latency",
  avg: "Avg",
  max: "Max",
  min: "Min",
  read: "Read",
  write: "Write",
  sessionAccumulated: "Session Accumulated",
  saving: "Saving",
  priceInput: "Input",
  priceCacheRead: "Cache Read",
  priceCacheWrite: "Cache Write",
  priceOutput: "Output",
  total: "Total",
  system: "System",
  user: "User",
  agent: "Agent",
  toolCall: "Tool Call",
  toolResult: "Tool Result",
  outputTokens: "Output",
  showPerformance: "Show Performance",
  showPricing: "Show Pricing",
  showTokenDistribution: "Show Token Distribution",
  showTrend: "Show Trend",
  language: "Language",
  auto: "Auto",
  cmdTitleHtml: "HTML Report",
  cmdDescHtml: "Generate interactive HTML dashboard with token usage, cache, and performance charts",
  cmdTitleJson: "JSON Export",
  cmdDescJson: "Export raw usage data as JSON file",
  cmdTitleText: "Text Report",
  cmdDescText: "Generate plain text report file",
  cmdTitleSettings: "Settings",
  cmdDescSettings: "Configure sidebar display options",
  descShowPerformance: "Display TPS, TTFT, latency metrics in sidebar",
  descShowPricing: "Display cost estimates in sidebar",
  descShowTokenDistribution: "Display input/output/reasoning token breakdown in sidebar",
  descShowTrend: "Display token usage trend in sidebar",
  settingsLanguage: "Language",
  descSettingsLanguage: "Switch display language",
  settingsTitle: "TokenWatch Settings",
  settingsPlaceholder: "Toggle settings...",
  langAuto: "Auto",
  done: "Done",
  closeSettings: "Close settings",
  menuToday: "Today",
  menu7d: "Last 7 Days",
  menu30d: "Last 30 Days",
  menuAll: "All Time",
}

let currentLang: SupportedLanguage = detectLanguage()

export function detectLanguage(): SupportedLanguage {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    if (locale.startsWith("zh")) return "zh"
  } catch {
    // Intl may not be available in restricted environments
  }
  return "en"
}

export function setLanguage(lang: SupportedLanguage | "auto"): void {
  if (lang === "auto") {
    currentLang = detectLanguage()
  } else {
    currentLang = lang
  }
}

export function getCurrentLanguage(): SupportedLanguage {
  return currentLang
}

export function t(key: string): string {
  const table = currentLang === "zh" ? zh : en
  return table[key] ?? key
}
