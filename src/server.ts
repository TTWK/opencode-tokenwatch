import type { PluginModule } from "@opencode-ai/plugin"
import { createPerfTracker } from "./kernel/perf.js"
import { markServerActive } from "./kernel/server-state.js"

/**
 * Server 插件入口（v1 用 exports["."]/"./server"，v2 用 exports["./server"]）。
 *
 * 架构演进：采集下沉至 Server，构建统一数据底座。
 *
 * 本模块运行在 OpenCode Server 进程中，负责静默监听所有客户端（CLI TUI、
 * OpenCode Desktop、API / 无头 Agent）发起的会话，提取 TTFT/TPS/延迟/Token 等指标，
 * 并权威持久化写入 ~/.opencode/tokenwatch.jsonl 与 ~/.opencode/tokenwatch-stats.json。
 *
 * 严格约束：
 * 绝不能导入任何 @opentui/* 或 ./tui.js 代码图，保持纯 Node.js / TypeScript 运行环境，
 * 避免破坏 Server 进程的模块隔离与引起单例冲突。
 */

interface PendingStep {
  sessionID: string
  assistantMessageID: string
  providerID: string
  modelID: string
  timeCreated: number
}

function createServerCollector() {
  const cleanupActive = markServerActive()
  const tracker = createPerfTracker({ persistLog: true })
  const pendingSteps = new Map<string, PendingStep>()

  function handleEvent(event: any): void {
    if (!event || typeof event !== "object") return
    const type: string = event.type ?? event.name ?? ""
    const data: any = event.properties ?? event.data ?? event

    switch (type) {
      case "message.updated": {
        const info = data?.info ?? data
        if (info && (info.role === "assistant" || info.type === "assistant")) {
          const modelObj = info.model
          const providerID = modelObj?.providerID ?? info.providerID ?? "unknown"
          const modelID = modelObj?.id ?? info.modelID ?? "unknown"
          tracker.handleMessageUpdated({
            properties: {
              info: {
                id: info.id,
                sessionID: data?.sessionID ?? info.sessionID ?? "",
                role: "assistant",
                providerID,
                modelID,
                tokens: info.tokens,
                cost: info.cost,
                time: info.time,
              },
            },
          })
        }
        break
      }

      case "message.part.updated": {
        const part = data?.part ?? data
        const messageID = data?.messageID ?? part?.messageID ?? part?.message_id
        if (messageID && (part?.time?.start || data?.time?.start)) {
          tracker.handlePartUpdated({
            message_id: messageID,
            type: part?.type ?? data?.type,
            text: part?.text ?? data?.text,
            time: { start: part?.time?.start ?? data?.time?.start },
          })
        }
        break
      }

      case "session.step.started":
      case "session.next.step.started": {
        const messageID = data?.assistantMessageID
        if (messageID) {
          const modelObj = data.model ?? {}
          const providerID = modelObj.providerID ?? "unknown"
          const modelID = modelObj.id ?? "unknown"
          const timeCreated = data.timestamp ?? event.created ?? Date.now()
          pendingSteps.set(messageID, {
            sessionID: data.sessionID ?? "",
            assistantMessageID: messageID,
            providerID,
            modelID,
            timeCreated,
          })
          tracker.handlePartUpdated({
            message_id: messageID,
            type: "step",
            time: { start: timeCreated },
          })
        }
        break
      }

      case "session.text.started":
      case "session.next.text.started":
      case "session.reasoning.started":
      case "session.next.reasoning.started":
      case "session.text.delta":
      case "session.next.text.delta":
      case "message.part.delta": {
        const messageID = data?.assistantMessageID ?? data?.messageID ?? data?.message_id
        const timeStart = data?.timestamp ?? event.created ?? Date.now()
        if (messageID) {
          tracker.handlePartUpdated({
            message_id: messageID,
            type: type.includes("delta") ? "text-delta" : type,
            time: { start: timeStart },
          })
        }
        break
      }

      case "session.step.ended":
      case "session.next.step.ended": {
        const messageID = data?.assistantMessageID
        if (messageID) {
          const pending = pendingSteps.get(messageID)
          pendingSteps.delete(messageID)

          const tokens = data.tokens ?? {}
          const cache = tokens.cache ?? {}
          const timeCreated = pending?.timeCreated ?? data.time?.created ?? (Date.now() - 1000)
          const timeStreamed = data.time?.streamed ?? Date.now()
          const timeCompleted = data.time?.completed ?? timeStreamed

          tracker.handleMessageUpdated({
            properties: {
              info: {
                id: messageID,
                sessionID: data.sessionID ?? pending?.sessionID ?? "",
                role: "assistant",
                providerID: pending?.providerID ?? data.model?.providerID ?? "unknown",
                modelID: pending?.modelID ?? data.model?.id ?? "unknown",
                tokens: {
                  input: tokens.input ?? 0,
                  output: tokens.output ?? 0,
                  reasoning: tokens.reasoning ?? 0,
                  cache: {
                    read: cache.read ?? 0,
                    write: cache.write ?? 0,
                  },
                },
                cost: typeof data.cost === "number" ? data.cost : 0,
                time: {
                  created: timeCreated,
                  streamed: timeStreamed,
                  completed: timeCompleted,
                },
              },
            },
          })
        }
        break
      }

      case "message.removed": {
        const messageID = data?.messageID ?? data?.id
        if (messageID) {
          pendingSteps.delete(messageID)
          tracker.handleMessageRemoved({ properties: { messageID } })
        }
        break
      }
    }
  }

  return {
    handleEvent,
    dispose() {
      cleanupActive()
      pendingSteps.clear()
    },
  }
}

// 维护全局收集器单例
let serverCollector: ReturnType<typeof createServerCollector> | null = null

function getOrCreateCollector(): ReturnType<typeof createServerCollector> {
  if (!serverCollector) {
    serverCollector = createServerCollector()
  }
  return serverCollector
}

const plugin: PluginModule & {
  id: string
  setup?: (ctx: any) => Promise<(() => void) | void>
} = {
  id: "opencode-tokenwatch",

  // v1 Server 插件契约：返回 Hooks，宿主有事件时调用 event({ event })
  server: async () => {
    const collector = getOrCreateCollector()
    return {
      event: async ({ event }: { event: any }) => {
        collector.handleEvent(event)
      },
      dispose: async () => {
        if (serverCollector) {
          serverCollector.dispose()
          serverCollector = null
        }
      },
    }
  },

  // v2 Server 插件契约：接收 ctx，支持事件订阅并返回卸载函数
  setup: async (ctx: any) => {
    const collector = getOrCreateCollector()
    const disposers: Array<() => void> = []

    // 若 v2 ctx 提供了响应式 data.on，直接挂载订阅
    if (typeof ctx?.data?.on === "function") {
      const events = [
        "message.updated",
        "message.part.updated",
        "message.removed",
        "session.step.started",
        "session.step.ended",
        "session.text.started",
        "session.reasoning.started",
      ]
      for (const ev of events) {
        try {
          const off = ctx.data.on(ev, (e: any) => collector.handleEvent(e))
          if (typeof off === "function") disposers.push(off)
        } catch {
          // 忽略不支持的单项订阅
        }
      }
    }

    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* ignore */ }
      }
      if (serverCollector) {
        serverCollector.dispose()
        serverCollector = null
      }
    }
  },
}

export { isServerActive } from "./kernel/server-state.js"
export { createPerfTracker } from "./kernel/perf.js"
export default plugin
