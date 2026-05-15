import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createElement, createTextNode, insertNode, setProp } from "@opentui/solid"

const plugin: TuiPluginModule = {
  id: "opencode-tokenwatch",
  tui: async (api) => {
    const fmt = (n: number): string => {
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
      if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
      return String(n)
    }

    type Acc = {
      requests: number
      total: number
      input: number
      output: number
      reasoning: number
      cacheRead: number
      cost: number
    }

    api.event.on("message.updated", (event) => {
      const info = (event.properties as any).info
      if (info?.role !== "assistant" || !info.tokens) return
      const model = (info.modelID as string) ?? ""
      const short = model.includes("/") ? model.split("/").pop() ?? model : model
      const input = (info.tokens.input as number) ?? 0
      const output = (info.tokens.output as number) ?? 0

      api.ui.toast({
        title: "TokenWatch",
        message: `${short}  \u2191${fmt(input)} \u2193${fmt(output)}`,
        duration: 3000,
      })
    })

    api.slots.register({
      slots: {
        sidebar_content: (_ctx, { session_id }): any => {
          const messages = api.state.session.messages(session_id)
          const models = new Map<string, Acc>()

          for (const msg of messages) {
            const info = (msg as any).info ?? msg
            if (info.role !== "assistant" || !info.tokens) continue

            const model = (info.modelID as string) ?? info.model ?? "unknown"
            const m = models.get(model) ?? {
              requests: 0, total: 0, input: 0, output: 0,
              reasoning: 0, cacheRead: 0, cost: 0,
            }
            m.requests++
            m.total += (info.tokens.total as number) ?? 0
            m.input += (info.tokens.input as number) ?? 0
            m.output += (info.tokens.output as number) ?? 0
            m.reasoning += (info.tokens.reasoning as number) ?? 0
            m.cacheRead += (info.tokens.cache?.read as number) ?? 0
            m.cost += (info.cost as number) ?? 0
            models.set(model, m)
          }

          const container = createElement("box")
          setProp(container, "flexDirection", "column")
          setProp(container, "marginTop", 1)

          const headerText = createElement("text")
          setProp(headerText, "color", _ctx.theme.current.primary)
          insertNode(headerText, createTextNode("TokenWatch"))
          insertNode(container, headerText)

          if (models.size === 0) {
            const noData = createElement("text")
            setProp(noData, "color", _ctx.theme.current.textMuted)
            insertNode(noData, createTextNode("  No data yet"))
            insertNode(container, noData)
            return container
          }

          for (const [model, s] of models) {
            const modelName = model.includes("/") ? model.split("/").pop() ?? model : model
            
            const mText = createElement("text")
            setProp(mText, "color", _ctx.theme.current.textMuted)
            insertNode(mText, createTextNode(`  ${modelName}: ${fmt(s.total)}`))
            insertNode(container, mText)

            const dText = createElement("text")
            setProp(dText, "color", _ctx.theme.current.textMuted)
            insertNode(dText, createTextNode(`    In:${fmt(s.input)} Out:${fmt(s.output)} Cache:${fmt(s.cacheRead)}`))
            insertNode(container, dText)
          }

          return container
        },
      },
    })
  },
}

export default plugin
