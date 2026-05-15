import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createElement, createTextNode, insertNode, setProp } from "@opentui/solid"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import { fileURLToPath } from "url"

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

    // Register a local command in the TUI (Command Palette)
    api.command?.register(() => [{
      title: "TokenWatch: Usage Stats",
      value: "tokenwatch-usage",
      description: "Show global token usage statistics",
      slash: {
        name: "usage",
      },
      onSelect: async (dialog) => {
        dialog?.setSize("xlarge")
        dialog?.replace(() => {
          const container = createElement("box")
          setProp(container, "padding", 2)
          setProp(container, "flexDirection", "column")
          
          const titleBox = createElement("box")
          setProp(titleBox, "marginBottom", 1)
          const text = createElement("text")
          setProp(text, "fg", api.theme.current.primary)
          insertNode(text, createTextNode("Loading token usage statistics..."))
          insertNode(titleBox, text)
          insertNode(container, titleBox)
          
          const scriptPath = path.join(__dirname, "../assets/usage.ps1")
          exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { env: process.env }, (error, stdout, stderr) => {
             dialog?.replace(() => {
               const root = createElement("box")
               setProp(root, "width", "100%")
               setProp(root, "height", "100%")
               setProp(root, "padding", 1)
               
               const scrollbox = createElement("scrollbox")
               setProp(scrollbox, "width", "100%")
               setProp(scrollbox, "height", "100%")
               
               const resultText = createElement("text")
               if (error || stderr) {
                 setProp(resultText, "fg", api.theme.current.error)
                 insertNode(resultText, createTextNode(String(error) + "\n" + stderr))
               } else {
                 setProp(resultText, "fg", api.theme.current.text)
                 insertNode(resultText, createTextNode(stdout))
               }
               
               insertNode(scrollbox, resultText)
               insertNode(root, scrollbox)
               return root
             })
          })
          return container
        })
      }
    }])

    api.slots.register({
      order: 100, // Put it near the bottom of content
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
          setProp(headerText, "fg", _ctx.theme.current.primary)
          insertNode(headerText, createTextNode("TokenWatch"))
          insertNode(container, headerText)

          if (models.size === 0) {
            const noData = createElement("text")
            setProp(noData, "fg", _ctx.theme.current.textMuted)
            insertNode(noData, createTextNode("  No data yet"))
            insertNode(container, noData)
            return container
          }

          for (const [model, s] of models) {
            const modelName = model.includes("/") ? model.split("/").pop() ?? model : model
            
            const mText = createElement("text")
            setProp(mText, "fg", _ctx.theme.current.textMuted)
            insertNode(mText, createTextNode(`  ${modelName}: ${fmt(s.total)}`))
            insertNode(container, mText)

            const dText = createElement("text")
            setProp(dText, "fg", _ctx.theme.current.textMuted)
            insertNode(dText, createTextNode(`    In:${fmt(s.input)} Out:${fmt(s.output)} Cache:${fmt(s.cacheRead)}`))
            insertNode(container, dText)
          }

          if (models.size > 1) {
            const total = { requests: 0, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0 }
            for (const s of models.values()) {
              total.requests += s.requests
              total.total += s.total
              total.input += s.input
              total.output += s.output
              total.cacheRead += s.cacheRead
            }
            
            const divider = createElement("text")
            setProp(divider, "fg", _ctx.theme.current.textMuted)
            insertNode(divider, createTextNode("  ───────────────────────────────"))
            insertNode(container, divider)
            
            const tText = createElement("text")
            setProp(tText, "fg", _ctx.theme.current.textMuted)
            insertNode(tText, createTextNode(`  Total: ${fmt(total.total)}`))
            insertNode(container, tText)
            
            const tdText = createElement("text")
            setProp(tdText, "fg", _ctx.theme.current.textMuted)
            insertNode(tdText, createTextNode(`    In:${fmt(total.input)} Out:${fmt(total.output)} Cache:${fmt(total.cacheRead)}`))
            insertNode(container, tdText)
          }

          return container
        },
      },
    })
  },
}

export default plugin
