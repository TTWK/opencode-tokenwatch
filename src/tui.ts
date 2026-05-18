import type { TuiDialogStack, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { EventMessageRemoved, EventMessageUpdated } from "@opencode-ai/sdk/v2"
import { createSignal } from "solid-js"
import { createElement, createTextNode, insertNode, setProp, useKeyHandler } from "@opentui/solid"
import {
  formatFilters,
  formatTokens,
  formatUsageReport,
  type SessionTokenData,
  type UsageFilters,
} from "./formatter.js"
import {
  exportReportAsCsv,
  getAvailableModels,
  getAvailableProviders,
  getPresetRange,
  getUsageReport,
} from "./queries.js"
import fs from "node:fs"
import path from "node:path"

type ReportRouteParams = {
  reportJson: string
  filtersJson: string
  lastSessionId?: string
}

function ReportScreen(props: { api: TuiApi; params: ReportRouteParams | undefined }) {
  const reportJson = props.params?.reportJson ?? "{}"
  const filtersJson = props.params?.filtersJson ?? "{}"
  const lastSessionId = props.params?.lastSessionId

  // Add key handler to close report
  useKeyHandler((event) => {
    if (event.name === "escape" || event.name === "q") {
      if (lastSessionId) {
        props.api.route.navigate("session", { sessionID: lastSessionId })
      } else {
        props.api.route.navigate("home")
      }
    }
  })

  let report: any
  let filters: any
  try {
    report = JSON.parse(reportJson)
    filters = JSON.parse(filtersJson)
  } catch {
    report = null
    filters = null
  }

  const output = report && filters
    ? formatUsageReport({ filters, ...report })
    : "Failed to load report data."

  const container = createElement("box")
  setProp(container, "flexDirection", "column")
  setProp(container, "width", "100%")
  setProp(container, "height", "100%")

  const header = createElement("box")
  setProp(header, "flexDirection", "row")
  setProp(header, "justifyContent", "space-between")
  setProp(header, "paddingX", 2)
  setProp(header, "paddingY", 1)

  const titleText = createElement("text")
  setProp(titleText, "fg", "#00ff00")
  setProp(titleText, "bold", true)
  insertNode(titleText, createTextNode("TokenWatch Usage Report"))
  insertNode(header, titleText)

  const hint = createElement("text")
  setProp(hint, "fg", "#888888")
  insertNode(hint, createTextNode("ESC/Q: Close | Ctrl+P: Commands"))
  insertNode(header, hint)

  insertNode(container, header)

  const divider = createElement("text")
  setProp(divider, "fg", "#555555")
  insertNode(divider, createTextNode("─".repeat(80)))
  insertNode(container, divider)

  const scrollbox = createElement("scrollbox")
  setProp(scrollbox, "paddingX", 2)
  setProp(scrollbox, "paddingY", 1)
  setProp(scrollbox, "flex", 1)

  const contentBox = createElement("box")
  setProp(contentBox, "flexDirection", "column")

  for (const line of output.split("\n")) {
    const textNode = createElement("text")
    setProp(textNode, "wrapMode", "none")

    if (line.startsWith("═══") || line.includes("Breakdown") || line.includes("Summary")) {
      setProp(textNode, "fg", props.api.theme.current.primary)
      setProp(textNode, "bold", true)
    } else if (line.match(/^[┌├└│╔╠╚║]/)) {
      setProp(textNode, "fg", props.api.theme.current.textMuted)
    } else {
      setProp(textNode, "fg", props.api.theme.current.text)
    }

    insertNode(textNode, createTextNode(line || " "))
    insertNode(contentBox, textNode)
  }

  insertNode(scrollbox, contentBox)
  insertNode(container, scrollbox)

  return container
}

type SidebarAcc = {
  provider: string
  model: string
  requests: number
  total: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cost: number
}

type ActionValue = "view" | "export-json" | "export-csv"
type PresetValue = "all" | "7d" | "30d" | "month"
type CsvSection = "models" | "providers" | "daily" | "sessions"
type TuiApi = Parameters<NonNullable<TuiPluginModule["tui"]>>[0]

function modelLabel(provider: string, model: string): string {
  const shortModel = model.includes("/") ? model.split("/").pop() ?? model : model
  return provider && provider !== "unknown" ? `${provider}/${shortModel}` : shortModel
}

function sumSidebar(items: SidebarAcc[]): SessionTokenData {
  return items.reduce<SessionTokenData>((acc, item) => {
    acc.modelsUsed.push(modelLabel(item.provider, item.model))
    acc.totalTokens += item.total
    acc.inputTokens += item.input
    acc.outputTokens += item.output
    acc.reasoningTokens += item.reasoning
    acc.cacheRead += item.cacheRead
    acc.totalCost += item.cost
    acc.requestCount += item.requests
    return acc
  }, {
    model: "",
    provider: "",
    modelsUsed: [],
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalCost: 0,
    requestCount: 0,
  })
}

function buildSidebarStats(messages: readonly any[]): SidebarAcc[] {
  const models = new Map<string, SidebarAcc>()

  for (const msg of messages) {
    const info = (msg as any).info ?? msg
    if (info.role !== "assistant" || !info.tokens || !info.tokens.total) continue

    const provider = (info.providerID as string) ?? "unknown"
    const model = (info.modelID as string) ?? info.model ?? "unknown"
    const key = `${provider}::${model}`
    const current = models.get(key) ?? {
      provider,
      model,
      requests: 0,
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cost: 0,
    }

    current.requests += 1
    current.total += (info.tokens.total as number) ?? 0
    current.input += (info.tokens.input as number) ?? 0
    current.output += (info.tokens.output as number) ?? 0
    current.reasoning += (info.tokens.reasoning as number) ?? 0
    current.cacheRead += (info.tokens.cache?.read as number) ?? 0
    current.cost += (info.cost as number) ?? 0
    models.set(key, current)
  }

  return [...models.values()].sort((a, b) => b.total - a.total)
}

function joinExportPath(name: string): string {
  return path.join(process.cwd(), name)
}

async function promptForPreset(api: TuiApi, stack: TuiDialogStack): Promise<PresetValue | undefined> {
  return new Promise((resolve) => {
    stack.replace(() => api.ui.DialogSelect<PresetValue>({
      title: "TokenWatch: Date Range",
      options: [
        { title: "All local sessions", value: "all", description: "Read every local session record" },
        { title: "Last 7 days", value: "7d", description: "Aggregate recent token usage" },
        { title: "Last 30 days", value: "30d", description: "Useful for monthly trend checks" },
        { title: "This month", value: "month", description: "From the first day of this month to today" },
      ],
      onSelect: (option) => {
        resolve(option.value)
      },
    }), () => resolve(undefined))
  })
}

async function promptForAction(api: TuiApi, stack: TuiDialogStack): Promise<ActionValue | "quick" | undefined> {
  return new Promise((resolve) => {
    stack.replace(() => api.ui.DialogSelect<ActionValue | "quick">({
      title: "TokenWatch: Action",
      options: [
        { title: "⚡ Quick View", value: "quick", description: "Show report for all local history immediately" },
        { title: "📊 Custom Report", value: "view", description: "Filter by date, provider, or model" },
        { title: "💾 Export JSON", value: "export-json", description: "Save a full report to JSON" },
        { title: "📄 Export CSV", value: "export-csv", description: "Export one grouped table to CSV" },
      ],
      onSelect: (option) => {
        resolve(option.value)
      },
    }), () => resolve(undefined))
  })
}

async function promptForCsvSection(api: TuiApi, stack: TuiDialogStack): Promise<CsvSection | undefined> {
  return new Promise((resolve) => {
    stack.replace(() => api.ui.DialogSelect<CsvSection>({
      title: "TokenWatch: CSV Section",
      options: [
        { title: "By model", value: "models", description: "provider + model breakdown" },
        { title: "By provider", value: "providers", description: "provider totals" },
        { title: "By day", value: "daily", description: "daily trend table" },
        { title: "By session", value: "sessions", description: "recent session summary rows" },
      ],
      onSelect: (option) => {
        resolve(option.value)
      },
    }), () => resolve(undefined))
  })
}

async function promptForProvider(api: TuiApi, stack: TuiDialogStack): Promise<string | undefined> {
  const providers = await getAvailableProviders()
  return new Promise((resolve) => {
    stack.replace(() => api.ui.DialogSelect<string>({
      title: "TokenWatch: Provider Filter",
      placeholder: "Filter providers",
      options: [
        { title: "All providers", value: "", description: "Do not filter by provider" },
        ...providers.map((provider) => ({
          title: provider,
          value: provider,
          description: `Only include ${provider}`,
        })),
      ],
      onSelect: (option) => {
        resolve(option.value || "")
      },
    }), () => resolve(undefined))
  })
}

async function promptForModel(api: TuiApi, stack: TuiDialogStack): Promise<string | undefined> {
  const models = await getAvailableModels()
  return new Promise((resolve) => {
    stack.replace(() => api.ui.DialogSelect<string>({
      title: "TokenWatch: Model Filter",
      placeholder: "Filter models",
      options: [
        { title: "All models", value: "", description: "Do not filter by model" },
        ...models.map((model) => ({
          title: model,
          value: model,
          description: `Only include ${model}`,
        })),
      ],
      onSelect: (option) => {
        resolve(option.value || "")
      },
    }), () => resolve(undefined))
  })
}

async function collectFilters(api: TuiApi, stack: TuiDialogStack): Promise<UsageFilters | undefined> {
  const preset = await promptForPreset(api, stack)
  if (!preset) return undefined

  const provider = await promptForProvider(api, stack)
  const model = await promptForModel(api, stack)

  return {
    ...getPresetRange(preset),
    provider,
    model,
    limit: preset === "all" ? 60 : 31,
  }
}

const plugin: TuiPluginModule = {
  id: "opencode-tokenwatch",
  tui: async (api) => {
    let lastActiveSessionId: string | undefined
    const [sidebarRevision, setSidebarRevision] = createSignal(0)

    const refreshSidebar = (sessionID?: string) => {
      if (!sessionID || sessionID === lastActiveSessionId) {
        setSidebarRevision((value) => value + 1)
      }
    }

    api.lifecycle.onDispose(api.event.on("message.updated", (event: EventMessageUpdated) => {
      refreshSidebar(event.properties.sessionID)
    }))
    api.lifecycle.onDispose(api.event.on("message.removed", (event: EventMessageRemoved) => {
      refreshSidebar(event.properties.sessionID)
    }))

    api.route.register([{
      name: "tokenwatch-report",
      render: ({ params }) => ReportScreen({ api, params: params as ReportRouteParams | undefined }),
    }])

    api.command?.register(() => [{
      title: "TokenWatch: Usage Stats",
      value: "tokenwatch-usage",
      description: "View or export token usage by model, provider, date, and session",
      slash: { name: "usage", aliases: ["tokens", "tokenwatch"] },
      onSelect: async (cmdDialog) => {
        cmdDialog?.clear()

        const stack = api.ui.dialog
        try {
          const action = await promptForAction(api, stack)
          if (!action) return

          let filters: UsageFilters | undefined
          if (action === "quick") {
            filters = { ...getPresetRange("all"), limit: 60 }
          } else {
            filters = await collectFilters(api, stack)
          }

          if (!filters) return

          api.ui.toast({ variant: "info", message: `TokenWatch is reading local history: ${formatFilters(filters)}` })
          const report = await getUsageReport(filters)

          if (action === "view" || action === "quick") {
            stack.clear()
            const reportData = {
              summary: report.summary,
              models: report.models,
              providers: report.providers,
              daily: report.daily,
              sessions: report.sessions,
            }
            api.route.navigate("tokenwatch-report", {
              reportJson: JSON.stringify(reportData),
              filtersJson: JSON.stringify(filters),
              lastSessionId: lastActiveSessionId,
            })
            return
          }


          if (action === "export-json") {
            stack.clear()
            const filePath = joinExportPath("tokenwatch-usage-report.json")
            fs.writeFileSync(filePath, JSON.stringify(report, null, 2))
            api.ui.toast({ variant: "success", message: `Exported JSON to ${filePath}` })
            return
          }

          const section = await promptForCsvSection(api, stack)
          stack.clear()
          if (!section) return
          const filePath = joinExportPath(`tokenwatch-${section}.csv`)
          fs.writeFileSync(filePath, exportReportAsCsv(report, section))
          api.ui.toast({ variant: "success", message: `Exported CSV to ${filePath}` })
        } catch (error: any) {
          api.ui.toast({ variant: "error", message: `TokenWatch error: ${error.message}` })
        }
      },
    }])

    api.slots.register({
      order: 100,
      slots: {
        sidebar_content: (_ctx, { session_id }): any => {
          sidebarRevision()
          lastActiveSessionId = session_id

          const messages = api.state.session.messages(session_id)
          const stats = buildSidebarStats(messages)
          const total = sumSidebar(stats)

          const container = createElement("box")
          setProp(container, "flexDirection", "column")
          setProp(container, "marginTop", 1)

          const headerText = createElement("text")
          setProp(headerText, "fg", _ctx.theme.current.primary)
          insertNode(headerText, createTextNode("TokenWatch"))
          insertNode(container, headerText)

          if (stats.length === 0) {
            const noData = createElement("text")
            setProp(noData, "fg", _ctx.theme.current.textMuted)
            insertNode(noData, createTextNode("  No assistant data yet"))
            insertNode(container, noData)
            return container
          }

          for (const item of stats) {
            const main = createElement("text")
            setProp(main, "fg", _ctx.theme.current.primary)
            insertNode(main, createTextNode(`  ${modelLabel(item.provider, item.model)}`))
            insertNode(container, main)

            const detail = createElement("text")
            setProp(detail, "fg", _ctx.theme.current.textMuted)
            insertNode(detail, createTextNode(`    ${formatTokens(item.total)} (in:${formatTokens(item.input)} out:${formatTokens(item.output)})`))
            insertNode(container, detail)

            const subDetail = createElement("text")
            setProp(subDetail, "fg", _ctx.theme.current.textMuted)
            insertNode(subDetail, createTextNode(`    req:${item.requests} cache:${formatTokens(item.cacheRead)}`))
            insertNode(container, subDetail)
          }

          if (stats.length > 1) {
            const divider = createElement("text")
            setProp(divider, "fg", _ctx.theme.current.textMuted)
            insertNode(divider, createTextNode("  ───────────────────────────────"))
            insertNode(container, divider)

            const totalLine = createElement("text")
            setProp(totalLine, "fg", _ctx.theme.current.textMuted)
            insertNode(totalLine, createTextNode(`  Total: ${formatTokens(total.totalTokens)}  req:${total.requestCount}`))
            insertNode(container, totalLine)

            const costLine = createElement("text")
            setProp(costLine, "fg", _ctx.theme.current.textMuted)
            insertNode(costLine, createTextNode(`    in:${formatTokens(total.inputTokens)} out:${formatTokens(total.outputTokens)} cache:${formatTokens(total.cacheRead)}`))
            insertNode(container, costLine)
          }

          return container
        },
      },
    })
  },
}

export default plugin
