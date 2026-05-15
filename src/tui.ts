import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

const plugin: TuiPluginModule = {
  id: "opencode-tokenwatch",
  tui: async (api) => {
    const fmt = (n: number): string => {
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
      if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
      return String(n)
    }

    const fmtCost = (n: number): string => {
      if (n === 0) return "$0"
      if (n < 0.01) return "$" + n.toFixed(4)
      return "$" + n.toFixed(2)
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
      const cost = (info.cost as number) ?? 0

      api.ui.toast({
        title: "TokenWatch",
        message: `${short}  \u2191${fmt(input)} \u2193${fmt(output)}  ${fmtCost(cost)}`,
        duration: 3000,
      })
    })

    api.slots.register({
      slots: {
        sidebar_content: (_ctx, { session_id }) => {
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

          if (models.size === 0) {
            return "TokenWatch\nNo data yet"
          }

          const lines: string[] = ["TokenWatch"]
          for (const [model, s] of models) {
            const short = model.length > 18 ? model.slice(0, 16) + ".." : model
            lines.push(
              `  ${short.padEnd(18)} ${String(s.requests).padStart(2)}r ${fmt(s.total).padStart(7)} ${fmtCost(s.cost).padStart(6)}`
            )
          }

          const total = { requests: 0, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cost: 0 }
          for (const s of models.values()) {
            total.requests += s.requests
            total.total += s.total
            total.input += s.input
            total.output += s.output
            total.cacheRead += s.cacheRead
            total.cost += s.cost
          }

          lines.push(`  ${"\u2500".repeat(34)}`)
          lines.push(
            `  ${"Total".padEnd(18)} ${String(total.requests).padStart(2)}r ${fmt(total.total).padStart(7)} ${fmtCost(total.cost).padStart(6)}`
          )

          return lines.join("\n")
        },
      },
    })
  },
}

export default plugin
