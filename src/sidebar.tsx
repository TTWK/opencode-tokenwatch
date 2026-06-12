import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js"
import type { TuiPluginApi, TuiTheme } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import { formatTokens, formatCost, formatDuration } from "./formatter.js"
import { t as baseT, setLanguage } from "./i18n.js"
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

function getVisualWidth(str: string): number {
  let w = 0
  for (const c of str) {
    const code = c.codePointAt(0) ?? 0
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0x1100 && code <= 0x11FF) ||
      (code >= 0x2E80 && code <= 0x2EFF)) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

function centerAlign(text: string, width: number): string {
  const visualW = getVisualWidth(text)
  if (visualW >= width) return text
  const left = Math.floor((width - visualW) / 2)
  const right = width - visualW - left
  return " ".repeat(left) + text + " ".repeat(right)
}

function hitRateColor(rate: number): RGBA {
  if (rate >= 85) return RGBA.fromInts(76, 175, 80, 255)
  if (rate >= 70) return RGBA.fromInts(255, 193, 7, 255)
  return RGBA.fromInts(244, 67, 54, 255)
}

/** 各 Token 分布角色的颜色 */
function distRoleColor(role: string): RGBA {
  const map: Record<string, RGBA> = {
    system: RGBA.fromInts(130, 80, 255, 255),
    user: RGBA.fromInts(88, 166, 255, 255),
    toolCall: RGBA.fromInts(210, 153, 34, 255),
    toolResult: RGBA.fromInts(219, 109, 40, 255),
    output: RGBA.fromInts(63, 185, 80, 255),
    other: RGBA.fromInts(72, 79, 88, 255),
  }
  return map[role] ?? RGBA.fromInts(72, 79, 88, 255)
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
  totalReasoning: number
  cacheRead: number
  cacheWrite: number
  totalCost: number
  requestCount: number
}

interface TokenWatchPanelProps {
  api: TuiPluginApi
  theme: TuiTheme
  perfTracker: PerfTracker
  messages: () => readonly any[]
  allTokenMessages: () => TokenMessage[]
}

export function TokenWatchPanel(props: TokenWatchPanelProps) {
  const { api, theme, perfTracker } = props
  const getMessages = () => props.messages()
  const [config, setConfig] = createSignal<SidebarConfig>(loadConfig(api))
  // 同步初始化语言以防首帧渲染使用错误的 detectLanguage 默认值
  setLanguage(config().language)
  let knownCfgVer = api.kv?.get?.("tokenwatch-config-version") as number | undefined

  // ── 响应式翻译函数 ──
  const t = (key: string) => {
    // 显式订阅 config 的变化以建立 SolidJS 追踪依赖
    void config().language
    return baseT(key)
  }

  // 检测是否是纯英文标签，用于全大写转换
  const isEnglish = (str: string) => /^[a-zA-Z\s\.\/]+$/.test(str)

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

  // ── 真实面板宽度：通过 ref + onSizeChange 从渲染引擎获取 ──
  // 初始值给一个合理默认，渲染后立即更新为实际值
  const [panelWidth, setPanelWidth] = createSignal(38)
  let outerBoxRef: any = null

  createEffect(() => setLanguage(config().language))

  // ── 颜色 helpers ──
  const primaryColor = (): RGBA => theme.current.primary
  const mutedColor = (): RGBA => theme.current.textMuted
  const dimColor = (): RGBA => RGBA.fromInts(72, 79, 88, 255)
  const greenColor = (): RGBA => RGBA.fromInts(63, 185, 80, 255)
  const borderColor = (): RGBA => RGBA.fromInts(55, 65, 80, 255)

  // ── 数据聚合 ──
  const modelStats = createMemo(() => {
    const map = new Map<string, ModelAgg>()
    for (const msg of props.allTokenMessages()) {
      const key = `${msg.providerID}/${msg.modelID}`
      let e = map.get(key)
      if (!e) {
        e = { providerID: msg.providerID, modelID: msg.modelID, totalInput: 0, totalOutput: 0, totalReasoning: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0, requestCount: 0 }
        map.set(key, e)
      }
      e.totalInput += msg.inputTokens
      e.totalOutput += msg.outputTokens
      e.totalReasoning += msg.reasoningTokens
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
    return { totalInput: i, totalOutput: o, totalReasoning: ir, totalCacheRead: cr, totalCacheWrite: cw, totalRequests: r, totalCost: c, totalTokens: i + o + ir + cr + cw }
  })

  const globalHitRate = createMemo(() => {
    const denom = sessionTotals().totalInput + sessionTotals().totalCacheRead
    return denom > 0 ? (sessionTotals().totalCacheRead / denom) * 100 : -1
  })

  const modelHitRate = createMemo(() => {
    return modelStats().map(([key, stat]) => {
      const denom = stat.totalInput + stat.cacheRead
      if (denom === 0) return { key, rate: 0, msgs: [] as TokenMessage[] }
      const msgs: TokenMessage[] = []
      for (const msg of props.allTokenMessages()) {
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
          sumCache += msgs[i].cacheRead
          sumTotal += msgs[i].inputTokens + msgs[i].cacheRead
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

  const perfStats = createMemo(() => {
    void props.allTokenMessages()
    void partVersion()
    return perfTracker.getSessionStats()
  })

  const tokenDistribution = createMemo(() => {
    void props.allTokenMessages()
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
    } catch { }

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
        let msgEstimatedOutput = 0
        for (const p of parts) {
          if (p.type === "tool") {
            let rawInput = ""
            try { rawInput = p.state?.raw ?? JSON.stringify(p.state?.input) } catch { try { rawInput = JSON.stringify(p.state) } catch { } }
            if (rawInput) dist.toolCall = (dist.toolCall ?? 0) + estimateTokens(rawInput)
            if (p.state?.status === "completed" && p.state?.output) {
              dist.toolResult = (dist.toolResult ?? 0) + estimateTokens(p.state.output)
            } else if (p.state?.status === "error" && p.state?.error) {
              dist.toolResult = (dist.toolResult ?? 0) + estimateTokens(p.state.error)
            }
          } else if (p.type === "text" && p.text) {
            msgEstimatedOutput += estimateTokens(p.text)
          } else if (p.type === "reasoning") {
            msgEstimatedOutput += estimateTokens(p.text ?? "")
          } else if (p.type === "subtask") {
            msgEstimatedOutput += estimateTokens(p.prompt || p.description || "")
          }
        }
        const tokens = (msg as any).tokens
        if (tokens?.output !== undefined || tokens?.reasoning !== undefined) {
          dist.output = (dist.output ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0)
        } else {
          dist.output = (dist.output ?? 0) + msgEstimatedOutput
        }
      }
    }

    const realInput = sessionTotals().totalInput
    if (realInput > 0) {
      const estimated = (dist.system ?? 0) + (dist.user ?? 0)
        + (dist.toolCall ?? 0) + (dist.toolResult ?? 0)
      const other = realInput - estimated
      if (other > 50) dist.other = other
    }

    return dist
  })



  // ── 折叠状态 toggle ──
  const toggle = {
    global: () => setCollapse(p => { const n = { ...p, global: !p.global }; saveCollapseState(api, n); return n }),
    model: (k: string) => setCollapse(p => { const n = { ...p, models: { ...p.models, [k]: !p.models[k] } }; saveCollapseState(api, n); return n }),
    sub: (k: string) => setCollapse(p => { const n = { ...p, subBlocks: { ...p.subBlocks, [k]: !p.subBlocks[k] } }; saveCollapseState(api, n); return n }),
  }

  onMount(() => {
    const unsubPart = api.event?.on?.("message.part.updated", () => setPartVersion(v => v + 1))
    onCleanup(() => { try { unsubPart?.() } catch { } })
  })

  // ── 宽度派生值 ──
  // innerWidth：边框内可用列数 = panelWidth - 2（左右边框各1格）
  // barWidth：进度条宽 = innerWidth - paddingX(1*2) - "Cache: "(7) - " XX%"(4) - "↑X.X%"(最多6) = innerWidth - 19
  // 分隔线：innerWidth - paddingX(1*2) = innerWidth - 2
  const innerWidth = () => panelWidth() - 2
  const barWidth = () => Math.max(8, innerWidth() - 19)
  const divider = () => {
    const w = innerWidth()
    if (w <= 2) return "─".repeat(w)
    return " " + "─".repeat(w - 2) + " "
  }

  return (
    <box
      // ── 不设置固定 width，让外层容器决定宽度 ──
      // ref + onSizeChange：布局完成后获取真实宽度，用于内部字符宽度计算
      ref={(el: any) => { outerBoxRef = el }}
      onSizeChange={() => {
        if (outerBoxRef) setPanelWidth((outerBoxRef as any).width as number)
      }}
      flexDirection="column"
      border={true}
      borderStyle="rounded"
      borderColor={borderColor()}
    >

      {/* ══════════════════════════════════════
          面板 Header：▾ TokenWatch  89.1% hit
          justifyContent="space-between" 左右分布
          ══════════════════════════════════════ */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        onMouseDown={toggle.global}
        paddingX={1}
      >
        <text fg={primaryColor()}>
          {collapse().global ? "▶" : "▾"} {t("panelTitle")}
        </text>
        <text fg={mutedColor()}>
          {collapse().global ? (
            <>
              {formatTokens(sessionTotals().totalTokens)}
              {globalHitRate() >= 0 ? (
                <span style={{ fg: hitRateColor(globalHitRate()) } as any}>
                  {` (${globalHitRate().toFixed(1)}% hit)`}
                </span>
              ) : ""}
            </>
          ) : (
            globalHitRate() >= 0 ? (
              <span style={{ fg: hitRateColor(globalHitRate()) } as any}>
                {`${globalHitRate().toFixed(1)}% hit`}
              </span>
            ) : ""
          )}
        </text>
      </box>

      <Show when={!collapse().global}>

        {/* 标题下分隔线 */}
        <text fg={borderColor()}>{divider()}</text>

        {/* ══════════════════════════════════════
            全局统计：Total / Req / Input / Output 均匀分行排布
            ══════════════════════════════════════ */}
        <box flexDirection="row" paddingX={1}>
          <For each={[
            { val: formatTokens(sessionTotals().totalTokens), lbl: t("total") },
            { val: sessionTotals().totalRequests.toString(), lbl: t("requests") },
            { val: formatTokens(sessionTotals().totalInput), lbl: t("input") },
            { val: formatTokens(sessionTotals().totalOutput), lbl: t("output") }
          ]}>
            {(item, idx) => {
              const colW = () => {
                const totalW = panelWidth() - 4
                const base = Math.floor(totalW / 4)
                return idx() === 3 ? totalW - base * 3 : base
              }
              return (
                <box width={colW()} flexDirection="column">
                  <text fg={primaryColor()}>{centerAlign(item.val, colW())}</text>
                  <text fg={dimColor()}>
                    {centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW())}
                  </text>
                </box>
              )
            }}
          </For>
        </box>

        {/* 成本展示 */}
        <Show when={config().sidebar.showPricing && sessionTotals().totalCost > 0}>
          <box flexDirection="row" justifyContent="center" marginTop={1}>
            <text fg={mutedColor()}>
              {t("cost")}:{" "}
              <span style={{ fg: greenColor() } as any}>
                {formatCost(sessionTotals().totalCost)}
              </span>
            </text>
          </box>
        </Show>

        {/* ══════════════════════════════════════
            各模型块：无分隔线，用 marginTop=1 隔开
            ══════════════════════════════════════ */}
        <For each={modelStats()}>
          {([key, stat]) => {
            const isExpanded = () => collapse().models[key] !== true

            const hitDenom = stat.totalInput + stat.cacheRead
            const hitRate = hitDenom > 0 ? (stat.cacheRead / hitDenom) * 100 : 0

            const trendStr = () => {
              if (!config().sidebar.showTrend) return ""
              const td = modelTrend().find(h => h.key === key)
              if (!td?.trend || td.trend === 0) return ""
              return td.trend > 0
                ? ` ${t("trendUp")}${td.trend.toFixed(1)}%`
                : ` ${t("trendDown")}${Math.abs(td.trend).toFixed(1)}%`
            }
            const trendColor = () => {
              const td = modelTrend().find(h => h.key === key)
              return (td?.trend ?? 0) >= 0
                ? RGBA.fromInts(63, 185, 80, 255)
                : RGBA.fromInts(244, 67, 54, 255)
            }

            // 模型名处理：假如总长超过22字符，且格式为 厂商/模型厂商/模型名称，去除中间模型厂商，只留 provider/modelname 格式
            let fullTitle = `${stat.providerID}/${stat.modelID}`
            if (fullTitle.length > 22) {
              const parts = fullTitle.split("/")
              if (parts.length >= 3) {
                fullTitle = `${parts[0]}/${parts[parts.length - 1]}`
              }
            }

            // 模型名截断：内容宽 - paddingX(2) - "● "(2) - " ×NNN ▾"(最多8) = innerWidth - 12
            const maxNameLen = Math.max(8, innerWidth() - 12)
            const shortTitle = fullTitle.length > maxNameLen
              ? fullTitle.slice(0, maxNameLen - 1) + "…"
              : fullTitle

            // 折叠：右侧显示总 token；展开：右侧显示请求数
            const modelHeaderRight = () => {
              if (!isExpanded()) {
                const total = stat.totalInput + stat.totalOutput + stat.totalReasoning + stat.cacheRead + stat.cacheWrite
                return `${formatTokens(total)} ▶`
              }
              return `×${stat.requestCount} ▾`
            }

            // 计算模型总 tokens
            const modelTotalTokens = stat.totalInput + stat.totalOutput + stat.totalReasoning + stat.cacheRead + stat.cacheWrite

            // 计算对齐标签 (使用 getter 以保持响应式切换)
            const targetW = () => {
              const cacheLabel = t("cache") + ":"
              const costLabel = t("cost") + ":"
              return Math.max(getVisualWidth(cacheLabel), getVisualWidth(costLabel))
            }

            const paddedCachePrefix = () => {
              const label = t("cache") + ":"
              return label + " ".repeat(targetW() - getVisualWidth(label))
            }
            const paddedCostPrefix = () => {
              const label = t("cost") + ":"
              return label + " ".repeat(targetW() - getVisualWidth(label))
            }

            // 缓存进度条宽度：可用宽度 panelWidth() - 4 减去前缀 targetW()，减去百分比(4)，减去趋势(6)
            const modelBarWidth = () => Math.max(8, (panelWidth() - 4) - targetW() - 11)

            return (
              // marginTop=1 提供模型间视觉间距（TUI最小单位为1行）
              <box flexDirection="column" marginTop={1}>

                {/* 模型 Header：左侧 ● 名称，右侧 统计+箭头 */}
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  onMouseDown={() => toggle.model(key)}
                  paddingX={1}
                >
                  <text fg={mutedColor()}>
                    <span style={{ fg: hitRateColor(hitRate) } as any}>●</span>
                    {" "}
                    <span style={{ fg: primaryColor() } as any}>{shortTitle}</span>
                  </text>
                  <text fg={mutedColor()}>{modelHeaderRight()}</text>
                </box>

                <Show when={isExpanded()}>
                  <box flexDirection="column" paddingX={1}>

                    {/* 模型指标三列网格，外带圆角边框 (取消上下间距) */}
                    <box
                      flexDirection="column"
                      border={true}
                      borderStyle="rounded"
                      borderColor={borderColor()}
                    >
                      <box flexDirection="row">
                        <For each={[
                          { val: formatTokens(modelTotalTokens), lbl: t("total") },
                          { val: formatTokens(stat.totalInput), lbl: t("input") },
                          { val: formatTokens(stat.totalOutput), lbl: t("output") }
                        ]}>
                          {(item, idx) => {
                            const colW = () => {
                              const totalW = panelWidth() - 6 // 边框占用 2 列
                              const base = Math.floor(totalW / 3)
                              return idx() === 2 ? totalW - base * 2 : base
                            }
                            return (
                              <box width={colW()} flexDirection="column">
                                <text fg={primaryColor()}>{centerAlign(item.val, colW())}</text>
                                <text fg={dimColor()}>
                                  {centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW())}
                                </text>
                              </box>
                            )
                          }}
                        </For>
                      </box>
                    </box>

                    {/* 缓存进度条 */}
                    <text fg={mutedColor()}>
                      {paddedCachePrefix()}
                      <span style={{ fg: hitRateColor(hitRate) } as any}>
                        {progressFilled(hitRate, modelBarWidth())}{progressRemaining(hitRate, modelBarWidth())}{" "}{hitRate.toFixed(0)}%
                      </span>
                      {trendStr()
                        ? <span style={{ fg: trendColor() } as any}>{trendStr()}</span>
                        : null}
                    </text>

                    {/* 性能指标 */}
                    <Show when={config().sidebar.showPerformance && !!perfStats().models[key]}>
                      <text fg={mutedColor()} marginTop={1}>
                        {t("ttft")} <span style={{ fg: primaryColor() } as any}>{formatDuration(perfStats().models[key]?.avgTTFT ?? null)}</span>
                        {"  "}{t("tps")} <span style={{ fg: primaryColor() } as any}>{perfStats().models[key]?.avgTPS?.toFixed(1) ?? "—"}</span>
                        {"  "}{t("lat")} <span style={{ fg: primaryColor() } as any}>{formatDuration(perfStats().models[key]?.avgLatency ?? null)}</span>
                      </text>
                    </Show>

                    {/* 成本 */}
                    <Show when={config().sidebar.showPricing && stat.totalCost > 0}>
                      <text fg={mutedColor()}>{paddedCostPrefix()}{formatCost(stat.totalCost)}</text>
                    </Show>

                  </box>
                </Show>
              </box>
            )
          }}
        </For>

        {/* ══════════════════════════════════════
            Token 分布区块：左右 space-between 对齐布局 (取消进度条)
            ══════════════════════════════════════ */}
        <Show when={config().sidebar.showTokenDistribution}>
          <box flexDirection="column" marginTop={1}>

            {/* 分隔线 */}
            <text fg={borderColor()}>{divider()}</text>

            {/* Header */}
            <box
              flexDirection="row"
              onMouseDown={() => toggle.sub("token-dist")}
              paddingX={1}
            >
              <text fg={greenColor()}>
                {!collapse().subBlocks["token-dist"] ? "▾" : "▶"} {t("tokenDistribution")}
              </text>
            </box>

            <Show when={!collapse().subBlocks["token-dist"]}>
              <box flexDirection="column" paddingX={1} marginTop={1}>
                <For each={Object.entries(tokenDistribution()).filter(([_, val]) => val > 0)}>
                  {([role, val]) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <box flexDirection="row">
                        <text fg={distRoleColor(role)}>█ </text>
                        <text fg={mutedColor()}>{t(role)}</text>
                      </box>
                      <text fg={mutedColor()}>{formatTokens(val)}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
        </Show>

      </Show>
    </box>
  )
}
