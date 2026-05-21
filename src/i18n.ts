export type SupportedLanguage = "zh" | "en"

const zh: Record<string, string> = {
  panelTitle: "TokenWatch",
  collapse: "折叠",
  expand: "展开",
  sessionSummary: "会话累计",
  input: "输入",
  output: "输出",
  cacheRead: "缓存读",
  cacheWrite: "缓存写",
  cacheMiss: "未命中",
  hitRate: "命中率",
  requests: "请求",
  cost: "成本",
  trendUp: "↑",
  trendDown: "↓",
  cache: "缓存",
  performance: "性能",
  pricing: "Pricing",
  tokenDistribution: "Token 分布",
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
  sessionAccumulated: "Session 累计",
  saving: "节省",
  priceInput: "输入",
  priceCacheRead: "缓存读",
  priceCacheWrite: "缓存写",
  priceOutput: "输出",
  total: "总计",
  system: "系统提示",
  user: "用户",
  agent: "Agent 指令",
  toolCall: "Tool 调用",
  toolResult: "Tool 结果",
  outputTokens: "输出",
  settings: "Settings",
  showCache: "显示缓存统计",
  showPerformance: "显示性能指标",
  showPricing: "显示模型定价",
  showTokenDistribution: "显示 Token 分布",
  showTrend: "显示趋势指示器",
  language: "语言",
  auto: "自动",
}

const en: Record<string, string> = {
  panelTitle: "TokenWatch",
  collapse: "Collapse",
  expand: "Expand",
  sessionSummary: "Session",
  input: "Input",
  output: "Output",
  cacheRead: "Cache Read",
  cacheWrite: "Cache Write",
  cacheMiss: "Cache Miss",
  hitRate: "Hit Rate",
  requests: "Requests",
  cost: "Cost",
  trendUp: "↑",
  trendDown: "↓",
  cache: "Cache",
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
  settings: "Settings",
  showCache: "Show Cache",
  showPerformance: "Show Performance",
  showPricing: "Show Pricing",
  showTokenDistribution: "Show Token Distribution",
  showTrend: "Show Trend",
  language: "Language",
  auto: "Auto",
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
