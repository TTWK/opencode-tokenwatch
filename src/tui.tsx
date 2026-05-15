import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

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

    api.slots.register({
      order: 100,
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

          if (models.size === 0) {
            return (
              <box flexDirection="column" marginTop={1}>
                <text fg={_ctx.theme.current.primary}>TokenWatch</text>
                <text fg={_ctx.theme.current.textMuted}>  No data yet</text>
              </box>
            )
          }

          const modelElements = Array.from(models.entries()).map(([model, s]) => {
            const modelName = model.includes("/") ? model.split("/").pop() ?? model : model
            return (
              <>
                <text fg={_ctx.theme.current.textMuted}>  {modelName}: {fmt(s.total)}</text>
                <text fg={_ctx.theme.current.textMuted}>    In:{fmt(s.input)} Out:{fmt(s.output)} Cache:{fmt(s.cacheRead)}</text>
              </>
            )
          })

          let totalElement = null
          if (models.size > 1) {
            const total = { requests: 0, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0 }
            for (const s of models.values()) {
              total.requests += s.requests
              total.total += s.total
              total.input += s.input
              total.output += s.output
              total.cacheRead += s.cacheRead
            }
            totalElement = (
              <>
                <text fg={_ctx.theme.current.textMuted}>  ──────────────────────────────────</text>
                <text fg={_ctx.theme.current.textMuted}>  Total: {fmt(total.total)}</text>
                <text fg={_ctx.theme.current.textMuted}>    In:{fmt(total.input)} Out:{fmt(total.output)} Cache:{fmt(total.cacheRead)}</text>
              </>
            )
          }

          return (
            <box flexDirection="column" marginTop={1}>
              <text fg={_ctx.theme.current.primary}>TokenWatch</text>
              {modelElements}
              {totalElement}
            </box>
          )
        },
      },
    })
  },
}

export default plugin
