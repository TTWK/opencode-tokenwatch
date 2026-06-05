import { createSignal } from "solid-js"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { registerCommands } from "./commands.jsx"
import { createPerfTracker } from "./perf-tracker.js"
import { TokenWatchPanel } from "./sidebar.jsx"

export interface TokenMessage {
  id: string
  sessionID: string
  providerID: string
  modelID: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

function kvKey(sessionID: string): string {
  return "tokenwatch-msgs-" + sessionID
}

const tui: TuiPluginModule["tui"] = async (api) => {
  const perfTracker = createPerfTracker()
  const [sidebarRevision, setSidebarRevision] = createSignal(0)
  const [allTokenMessages, setAllTokenMessages] = createSignal<TokenMessage[]>([])
  let currentSlotSessionID = ""
  const cleanups: (() => void)[] = []

  registerCommands(api)

  function persistToKv(sessionID: string, msgs: TokenMessage[]): void {
    try {
      api.kv?.set?.(kvKey(sessionID), msgs)
    } catch { /* non-critical */ }
  }

  const unsubMsgUpdated = api.event.on("message.updated", (event: any) => {
    const info = event.properties?.info

    perfTracker.handleMessageUpdated(event)

    if (info?.role === "assistant" && info?.tokens?.total > 0) {
      setAllTokenMessages(prev => {
        const msg: TokenMessage = {
          id: info.id,
          sessionID: info.sessionID ?? "",
          providerID: info.providerID ?? "unknown",
          modelID: info.modelID ?? "unknown",
          inputTokens: info.tokens?.input ?? 0,
          outputTokens: info.tokens?.output ?? 0,
          reasoningTokens: info.tokens?.reasoning ?? 0,
          cacheRead: info.tokens?.cache?.read ?? 0,
          cacheWrite: info.tokens?.cache?.write ?? 0,
          cost: info.cost ?? 0,
        }
        const idx = prev.findIndex(m => m.id === msg.id)
        let next: TokenMessage[]
        if (idx >= 0) {
          next = [...prev]
          next[idx] = msg
        } else {
          next = [...prev, msg]
        }
        // Bug fix: 优先使用事件自带的 sessionID，而非 currentSlotSessionID
        // currentSlotSessionID 在 slot 首次渲染时才更新，session 切换瞬间可能落后
        const targetSessionID = info.sessionID ?? currentSlotSessionID
        persistToKv(targetSessionID, next)
        return next
      })
    }


    setSidebarRevision((v) => v + 1)
  })
  cleanups.push(unsubMsgUpdated)

  const unsubPartUpdated = api.event.on("message.part.updated", (event: any) => {
    perfTracker.handlePartUpdated({
      message_id: event.properties?.part?.messageID,
      type: event.properties?.part?.type,
      text: event.properties?.part?.type === "text" ? event.properties?.part?.text : undefined,
      time: { start: event.properties?.part?.time?.start },
    })
  })
  cleanups.push(unsubPartUpdated)

  const unsubRemoved = api.event.on("message.removed", () => {
    setSidebarRevision((v) => v + 1)
  })
  cleanups.push(unsubRemoved)

  api.lifecycle?.onDispose?.(() => {
    for (const cleanup of cleanups) cleanup()
  })

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content: (_ctx, { session_id }) => {
        sidebarRevision()

        if (session_id && session_id !== currentSlotSessionID) {
          currentSlotSessionID = session_id
          perfTracker.reset()

          let loaded: TokenMessage[] = []
          try {
            const saved = api.kv?.get?.(kvKey(session_id)) as TokenMessage[] | undefined
            if (saved && saved.length > 0) loaded = saved
          } catch {}

          if (loaded.length === 0) {
            const existing = api.state.session.messages(session_id)
            for (const msg of existing) {
              if ((msg as any).role !== "assistant") continue
              const tokens = (msg as any).tokens
              if (!tokens) continue
              loaded.push({
                id: (msg as any).id,
                sessionID: session_id,
                providerID: (msg as any).providerID ?? "unknown",
                modelID: (msg as any).modelID ?? "unknown",
                inputTokens: tokens?.input ?? 0,
                outputTokens: tokens?.output ?? 0,
                reasoningTokens: tokens?.reasoning ?? 0,
                cacheRead: tokens?.cache?.read ?? 0,
                cacheWrite: tokens?.cache?.write ?? 0,
                cost: (msg as any).cost ?? 0,
              })
            }
          }
          setAllTokenMessages(loaded)
        }

        const messages = api.state.session.messages(session_id)
        return <TokenWatchPanel api={api} theme={api.theme} perfTracker={perfTracker} messages={messages} allTokenMessages={allTokenMessages()} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-tokenwatch",
  tui,
}

export default plugin
