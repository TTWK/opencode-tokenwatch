import { createSignal } from "solid-js"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { registerCommands } from "./commands.js"
import { createPerfTracker } from "./perf-tracker.js"
import { TokenWatchPanel } from "./sidebar.jsx"

const tui: TuiPluginModule["tui"] = async (api) => {
  const perfTracker = createPerfTracker()
  const [sidebarRevision, setSidebarRevision] = createSignal(0)
  let currentSessionID = ""
  const cleanups: (() => void)[] = []

  registerCommands(api)

  const unsubMsgUpdated = api.event.on("message.updated", (event: any) => {
    const sessionID = event.properties?.info?.sessionID ?? ""
    if (sessionID && sessionID !== currentSessionID) {
      currentSessionID = sessionID
      perfTracker.reset()
    }
    perfTracker.handleMessageUpdated(event)
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
        const messages = api.state.session.messages(session_id)
        return <TokenWatchPanel api={api} theme={api.theme} perfTracker={perfTracker} messages={messages} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-tokenwatch",
  tui,
}

export default plugin
