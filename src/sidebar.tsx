import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js"
import type { TuiPluginApi, TuiTheme } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import { formatTokens, formatCost, formatDuration } from "./formatter.js"
import { t, setLanguage } from "./i18n.js"
import type { PerfTracker } from "./perf-tracker.js"
import type { TokenMessage } from "./tui.jsx"

export interface SidebarConfig {
  sidebar: {
    showPerformance: boolean
    showPricing: boolean
    showTokenDistribution: boolean
    showTrend: boolean
  }
  language: "zh" | "en" | "auto"
}

const DEFAULT_CONFIG: SidebarConfig = {
  sidebar: { showPerformance: true, showPricing: true, showTokenDistribution: true, showTrend: true },
  language: "auto",
}

function progressBarWidth(percent: number, width: number): number {
  if (percent >= 100) return width
  return Math.floor((percent / 100) * width)
}
function progressFilled(percent: number, width: number): string {
  return "█".repeat(Math.max(0, progressBarWidth(percent, width)))
}
function progressRemaining(percent: number, width: number): string {
  return "░".repeat(Math.max(0, width - progressBarWidth(percent, width)))
}

function hitRateColor(rate: number): RGBA {
  if (rate >= 85) return RGBA.fromInts(76, 175, 80, 255)
  if (rate >= 70) return RGBA.fromInts(255, 193, 7, 255)
  return RGBA.fromInts(244, 67, 54, 255)
}

function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0
  let ascii = 0, cjk = 0
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0x1100 && code <= 0x11FF) ||
        (code >= 0x2E80 && code <= 0x2EFF)) cjk++
    else ascii++
  }
  const trimmed = text.trimStart()
  const jsonLike = (trimmed.startsWith("{") || trimmed.startsWith("[")) && /"[^"]+"\s*:/.test(text)
  const codeLike = !jsonLike && /```|^import |^export |^function |^const |^let |^var |^class |^interface |^type |^def |^fn |^pub |^use |^mod |^package /m.test(text)
  const asciiPerToken = jsonLike ? 2 : codeLike ? 2.5 : 4
  return Math.max(1, Math.ceil(ascii / asciiPerToken + cjk / 1.5))
}

interface CollapseState { global: boolean; models: Record<string, boolean>; subBlocks: Record<string, boolean> }

function loadCollapseState(api: TuiPluginApi): CollapseState {
  try { return (api.kv?.get?.("tokenwatch-collapse") as CollapseState) ?? { global: false, models: {}, subBlocks: {} } }
  catch { return { global: false, models: {}, subBlocks: {} } }
}
function saveCollapseState(api: TuiPluginApi, state: CollapseState): void {
  try { api.kv?.set?.("tokenwatch-collapse", state) } catch { /* non-critical */ }
}

export function loadConfig(api: TuiPluginApi): SidebarConfig {
  const base = { sidebar: { ...DEFAULT_CONFIG.sidebar }, language: DEFAULT_CONFIG.language }
  try {
    const pluginCfg = (api as any).config?.pluginConfig?.["opencode-tokenwatch"]
    if (pluginCfg?.sidebar) Object.assign(base.sidebar, pluginCfg.sidebar)
    if (pluginCfg?.language) base.language = pluginCfg.language
    const overrides = api.kv?.get?.("tokenwatch-config") as Partial<SidebarConfig> | undefined
    if (overrides?.sidebar) Object.assign(base.sidebar, overrides.sidebar)
    if (overrides?.language) base.language = overrides.language
  } catch { /* defaults */ }
  return base
}

interface ModelAgg {
  providerID: string
  modelID: string
  totalInput: number
  totalOutput: number
  totalReasoning: number   // Bug fix: 补全 reasoning 分量
  cacheRead: number
  cacheWrite: number
  totalCost: number
  requestCount: number
}

interface TokenWatchPanelProps {
  api: TuiPluginApi
  theme: TuiTheme
  perfTracker: PerfTracker
  messages: readonly any[]
  allTokenMessages: TokenMessage[]
}

export function TokenWatchPanel(props: TokenWatchPanelProps) {
  const { api, theme, perfTracker } = props
  const getMessages = () => props.messages
  const [config, setConfig] = createSignal<SidebarConfig>(loadConfig(api))
  let knownCfgVer = api.kv?.get?.("tokenwatch-config-version") as number | undefined

  createEffect(() => {
    const timer = setInterval(() => {
      const v = api.kv?.get?.("tokenwatch-config-version") as number | undefined
      if (v != null && v !== knownCfgVer) {
        knownCfgVer = v
        setConfig(loadConfig(api))
      }
    }, 500)
    onCleanup(() => clearInterval(timer))
  })
  const [collapse, setCollapse] = createSignal<CollapseState>(loadCollapseState(api))
  const [panelWidth, setPanelWidth] = createSignal(40)

  createEffect(() => setLanguage(config().language))

  const primaryColor = (): RGBA => theme.current.primary
  const mutedColor = (): RGBA => theme.current.textMuted
  const textColor = (): RGBA => theme.current.text

  const modelStats = createMemo(() => {
    const map = new Map<string, ModelAgg>()
    for (const msg of props.allTokenMessages) {
      const key = `${msg.providerID}/${msg.modelID}`
      let e = map.get(key)
      if (!e) {
        // Bug fix: 初始化时加入 totalReasoning 字段
        e = { providerID: msg.providerID, modelID: msg.modelID, totalInput: 0, totalOutput: 0, totalReasoning: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0, requestCount: 0 }
        map.set(key, e)
      }
      e.totalInput += msg.inputTokens
      e.totalOutput += msg.outputTokens
      e.totalReasoning += msg.reasoningTokens   // Bug fix: 聚合 reasoning
      e.cacheRead += msg.cacheRead
      e.cacheWrite += msg.cacheWrite
      e.totalCost += msg.cost
      e.requestCount++
    }
    return Array.from(map.entries()).sort((a, b) => (b[1].totalInput + b[1].totalOutput) - (a[1].totalInput + a[1].totalOutput))
  })

  const sessionTotals = createMemo(() => {
    let i = 0, o = 0, ir = 0, cr = 0, cw = 0, r = 0, c = 0
    for (const [, s] of modelStats()) {
      i += s.totalInput; o += s.totalOutput; ir += s.totalReasoning
      cr += s.cacheRead; cw += s.cacheWrite; r += s.requestCount; c += s.totalCost
    }
    // Bug fix: totalTokens 改为 5 分量（含 reasoning），与官方一致
    return { totalInput: i, totalOutput: o, totalReasoning: ir, totalCacheRead: cr, totalCacheWrite: cw, totalRequests: r, totalCost: c, totalTokens: i + o + ir + cr + cw }
  })

  const modelHitRate = createMemo(() => {
    return modelStats().map(([key, stat]) => {
      const denom = stat.totalInput + stat.cacheRead
      if (denom === 0) return { key, rate: 0, msgs: [] as TokenMessage[] }

      const msgs: TokenMessage[] = []
      for (const msg of props.allTokenMessages) {
        const pk = `${msg.providerID}/${msg.modelID}`
        if (pk !== key) continue
        msgs.push(msg)
      }

      return { key, rate: (stat.cacheRead / denom) * 100, msgs }
    })
  })

  const modelTrend = createMemo(() => {
    return modelHitRate().map(({ key, msgs }) => {
      if (msgs.length < 6) return { key, trend: null as number | null }

      const sumSlice = (start: number, end: number) => {
        let sumCache = 0, sumTotal = 0
        for (let i = start; i < end && i < msgs.length; i++) {
          const input = msgs[i].inputTokens
          const cache = msgs[i].cacheRead
          sumCache += cache
          sumTotal += input + cache
        }
        return { sumCache, sumTotal }
      }

      const n = msgs.length
      const recent = sumSlice(n - 3, n)
      const prev = sumSlice(n - 6, n - 3)
      const rateRecent = recent.sumTotal > 0 ? (recent.sumCache / recent.sumTotal) * 100 : 0
      const ratePrev = prev.sumTotal > 0 ? (prev.sumCache / prev.sumTotal) * 100 : 0

      return { key, trend: rateRecent - ratePrev }
    })
  })

  const [partVersion, setPartVersion] = createSignal(0)

  const tokenDistribution = createMemo(() => {
    void partVersion()
    const dist: Record<string, number> = {}

    try {
      const cfg = api.state.config as Record<string, unknown>
      const agents = cfg?.agent as Record<string, unknown> | undefined
      if (agents) {
        for (const ac of Object.values(agents)) {
          const a = ac as Record<string, unknown>
          if (typeof a?.prompt === "string" && a.prompt) {
            dist.system = estimateTokens(a.prompt)
            break
          }
        }
      }
    } catch {}

    for (const msg of getMessages()) {
      const role = (msg as any).role
      if (role === "user") {
        if ((msg as any).system) dist.system = (dist.system ?? 0) + estimateTokens((msg as any).system)
        let parts: readonly any[] = []
        try { parts = api.state.part((msg as any).id) } catch { continue }
        for (const p of parts) {
          if (p.type === "text" && !p.synthetic && !p.ignored) {
            dist.user = (dist.user ?? 0) + estimateTokens(p.text ?? "")
          } else if (p.type === "file" && p.source?.text?.value) {
            dist.user = (dist.user ?? 0) + estimateTokens(p.source.text.value)
          }
        }
      } else if (role === "assistant") {
        let parts: readonly any[] = []
        try { parts = api.state.part((msg as any).id) } catch { continue }
        for (const p of parts) {
          if (p.type === "tool") {
            let rawInput = ""
            try { rawInput = p.state?.raw ?? JSON.stringify(p.state?.input) } catch { try { rawInput = JSON.stringify(p.state) } catch {} }
            if (rawInput) dist.toolCall = (dist.toolCall ?? 0) + estimateTokens(rawInput)
            if (p.state?.status === "completed" && p.state?.output) {
              dist.toolResult = (dist.toolResult ?? 0) + estimateTokens(p.state.output)
            } else if (p.state?.status === "error" && p.state?.error) {
              dist.toolResult = (dist.toolResult ?? 0) + estimateTokens(p.state.error)
            }
          } else if (p.type === "text" && p.text) {
            // Bug fix: assistant text part（主要 LLM 回复内容）之前未计入分布
            // 此处用 estimateTokens 估算，最终 dist.output 会被下方真实 tokens.output 覆盖
            dist.output = (dist.output ?? 0) + estimateTokens(p.text)
          } else if (p.type === "reasoning") {
            dist.agent = (dist.agent ?? 0) + estimateTokens(p.text ?? "")
          } else if (p.type === "subtask") {
            dist.agent = (dist.agent ?? 0) + estimateTokens(p.prompt || p.description || "")
          }
        }
        const tokens = (msg as any).tokens
        // 真实 output token 数优先：覆盖上面的 text part 估算
        if (tokens?.output) dist.output = (dist.output ?? 0) + tokens.output
      }
    }

    // Bug fix: 添加 other 兜底桶（参考官方 session-context-breakdown.ts）
    // 使用真实 input token 数减去各桶估算值，确保分布总和对齐
    const realInput = sessionTotals().totalInput
    if (realInput > 0) {
      const estimated = (dist.system ?? 0) + (dist.user ?? 0)
        + (dist.agent ?? 0) + (dist.toolCall ?? 0) + (dist.toolResult ?? 0)
      const other = realInput - estimated
      // 只在差值超过 50 token 时展示，避免估算误差噪音
      if (other > 50) dist.other = other
    }

    return dist
  })


  const toggle = {
    global: () => setCollapse(p => { const n = { ...p, global: !p.global }; saveCollapseState(api, n); return n }),
    model: (k: string) => setCollapse(p => { const n = { ...p, models: { ...p.models, [k]: !p.models[k] } }; saveCollapseState(api, n); return n }),
    sub: (k: string) => setCollapse(p => { const n = { ...p, subBlocks: { ...p.subBlocks, [k]: !p.subBlocks[k] } }; saveCollapseState(api, n); return n }),
  }

  onMount(() => {
    const unsubPart = api.event?.on?.("message.part.updated", () => setPartVersion(v => v + 1))
    const unsubMsg = api.event?.on?.("message.updated", () => setPartVersion(v => v + 1))
    onCleanup(() => { try { unsubPart?.(); unsubMsg?.() } catch {} })
  })

  return (
    <box flexDirection="column" width={panelWidth()}>
      <box onMouseDown={toggle.global}>
        <text fg={primaryColor()}>
          {collapse().global ? "▶" : "▼"} {t("panelTitle")}
          {collapse().global ? `  ${t("cacheRead")}:${formatTokens(sessionTotals().totalCacheRead)}  ${t("requests")}:${sessionTotals().totalRequests}` : ""}
        </text>
      </box>

      <Show when={!collapse().global}>
        <text fg={mutedColor()}>
          {t("total")}:{formatTokens(sessionTotals().totalTokens)}  {t("requests")}:{sessionTotals().totalRequests}
        </text>
        <text fg={mutedColor()}>
          {t("input")}:{formatTokens(sessionTotals().totalInput)}  {t("output")}:{formatTokens(sessionTotals().totalOutput)}  {t("cacheRead")}:{formatTokens(sessionTotals().totalCacheRead)}
        </text>
        <Show when={sessionTotals().totalCost > 0}>
          <text fg={mutedColor()}>
            {t("cost")}:{formatCost(sessionTotals().totalCost)}
          </text>
        </Show>

        <For each={modelStats()}>
          {([key, stat]) => {
            const modelCollapsed = () => collapse().models[key] !== true
            const totalInput = stat.totalInput + stat.cacheRead
            const hitRate = totalInput > 0 ? (stat.cacheRead / totalInput) * 100 : 0
            const trendData = modelTrend().find(h => h.key === key)
            const trendStr = trendData?.trend !== null && trendData?.trend !== undefined && trendData.trend !== 0
              ? (trendData.trend >= 0 ? `${t("trendUp")}${trendData.trend.toFixed(1)}%` : `${t("trendDown")}${Math.abs(trendData.trend).toFixed(1)}%`)
              : ""

            const title = `${stat.providerID}/${stat.modelID}`
            const shortTitle = title.length > 32 ? title.slice(0, 30) + "…" : title

            return (
              <box flexDirection="column">
                <box onMouseDown={() => toggle.model(key)}>
                  <text fg={primaryColor()}>{modelCollapsed() ? "▼" : "▶"} {shortTitle}</text>
                </box>
                <text fg={mutedColor()}>
                  {/* Bug fix: total 改为 5 分量（含 reasoning） */}
                  {t("total")}:{formatTokens(stat.totalInput + stat.totalOutput + stat.totalReasoning + stat.cacheRead + stat.cacheWrite)}  {t("requests")}:{stat.requestCount}
                </text>
                <text fg={mutedColor()}>
                  {t("input")}:{formatTokens(stat.totalInput)}  {t("output")}:{formatTokens(stat.totalOutput)}
                </text>
                <text fg={mutedColor()}>
                    {t("cache")}:{formatTokens(stat.cacheRead + stat.cacheWrite)}(
                    <span style={({ fg: hitRateColor(hitRate) } as any)}>
                      {progressFilled(hitRate, Math.max(3, Math.floor(panelWidth() / 3)))}
                      {progressRemaining(hitRate, Math.max(3, Math.floor(panelWidth() / 3)))}
                      {" "}{hitRate.toFixed(0)}%
                    </span>
                    {trendStr ? ` ${trendStr}` : ""})
                </text>
                <Show when={stat.totalCost > 0}>
                  <text fg={mutedColor()}>
                    {t("cost")}:{formatCost(stat.totalCost)}
                  </text>
                </Show>

                <Show when={modelCollapsed()}>
                  <Show when={config().sidebar.showPerformance}>
                    <box flexDirection="column">
                      <box onMouseDown={() => toggle.sub(`perf-${key}`)}>
                        <text fg={textColor()}>{!collapse().subBlocks[`perf-${key}`] ? "▼" : "▶"}  ── {t("performance")} ──</text>
                      </box>
                      <Show when={!collapse().subBlocks[`perf-${key}`]}>
                        <text fg={mutedColor()}>
                          {t("ttft")}:{formatDuration(perfTracker.getSessionStats().models[key]?.avgTTFT ?? null)}  {t("tps")}:{perfTracker.getSessionStats().models[key]?.avgTPS?.toFixed(1) ?? "—"}  {t("latency")}:{formatDuration(perfTracker.getSessionStats().models[key]?.avgLatency ?? null)}
                        </text>
                      </Show>
                    </box>
                  </Show>

                  <Show when={config().sidebar.showPricing && stat.totalCost > 0}>
                    <box flexDirection="column">
                      <box onMouseDown={() => toggle.sub(`pricing-${key}`)}>
                        <text fg={textColor()}>{!collapse().subBlocks[`pricing-${key}`] ? "▼" : "▶"}  ── {t("pricing")} ──</text>
                      </box>
                      <Show when={!collapse().subBlocks[`pricing-${key}`]}>
                        <text fg={mutedColor()}>    {t("cost")}:{formatCost(stat.totalCost)}</text>
                        <text fg={mutedColor()}>    {t("modelLabel")}:{stat.providerID}/{stat.modelID}</text>
                      </Show>
                    </box>
                  </Show>
                </Show>
              </box>
            )
          }}
        </For>

        <Show when={config().sidebar.showTokenDistribution}>
          <box flexDirection="column">
            <box onMouseDown={() => toggle.sub("token-dist")}>
              <text fg={primaryColor()}>{!collapse().subBlocks["token-dist"] ? "▼" : "▶"}  ── {t("tokenDistribution")} ──</text>
            </box>
            <Show when={!collapse().subBlocks["token-dist"]}>
              <For each={Object.entries(tokenDistribution())}>
                {([role, tokens]) => (
                  <text fg={mutedColor()}>    {t(role)}:{formatTokens(tokens)}</text>
                )}
              </For>
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}
