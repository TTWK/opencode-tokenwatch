/** @jsxImportSource @opentui/solid */
/**
 * 共享启动器 —— 两代宿主共用的装配逻辑。
 *
 * 职责：把 HostAdapter 提供的事件流接进性能追踪器与会话消息聚合，
 * 侧边栏插槽渲染 TokenWatchPanel，处理 KV 持久化与历史会话重建。
 * v1 / v2 的差异已全部折叠进 adapter，本文件对宿主零感知。
 */
import { createSignal } from "solid-js"
import { TokenWatchPanel } from "../ui/sidebar.js"
import { createPerfTracker } from "../kernel/perf.js"
import type { TokenMessage } from "../kernel/model.js"
import type { HostAdapter, NormalizedMessageEvent, NormalizedPartEvent } from "./types.js"

function kvKey(sessionID: string): string {
  return "tokenwatch-msgs-" + sessionID
}

/** 归一化消息 → 性能追踪器输入（v1 事件形状，追踪器内部约定） */
function toPerfMessageEvent(e: NormalizedMessageEvent) {
  return {
    properties: {
      info: {
        id: e.messageID,
        sessionID: e.sessionID,
        role: e.role,
        providerID: e.providerID,
        modelID: e.modelID,
        tokens: {
          input: e.input,
          output: e.output,
          reasoning: e.reasoning,
          cache: { read: e.cacheRead, write: e.cacheWrite },
          total: e.total,
        },
        cost: e.cost,
        time: { created: e.timeCreated, completed: e.timeCompleted },
      },
    },
  }
}

function toPerfPartEvent(p: NormalizedPartEvent) {
  return {
    message_id: p.messageID,
    type: p.type,
    text: p.text,
    time: { start: p.timeStart },
  }
}

/** 从宿主消息列表重建 TokenMessage（过滤全零 token，与事件路径一致） */
function rebuildFromMessages(sessionID: string, messages: readonly any[]): TokenMessage[] {
  const out: TokenMessage[] = []
  for (const msg of messages) {
    // v1 消息带 role，v2 消息带 type —— 两者都接受
    const kind = msg?.type ?? msg?.role
    if (kind !== "assistant") continue
    const tokens = msg.tokens
    if (!tokens) continue
    // v2 的 TokenUsageInfo 没有 total 字段，按五分量现算
    const total =
      (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) +
      (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
    if (total === 0) continue
    out.push({
      id: msg.id,
      sessionID,
      // v1 平铺 providerID/modelID；v2 嵌套在 model 里
      providerID: msg.model?.providerID ?? msg.providerID ?? "unknown",
      modelID: msg.model?.id ?? msg.modelID ?? "unknown",
      inputTokens: tokens.input ?? 0,
      outputTokens: tokens.output ?? 0,
      reasoningTokens: tokens.reasoning ?? 0,
      cacheRead: tokens.cache?.read ?? 0,
      cacheWrite: tokens.cache?.write ?? 0,
      cost: msg.cost ?? 0,
    })
  }
  return out
}

/**
 * 启动 TokenWatch 共享核心，返回卸载函数。
 *
 * 事件 → 聚合/持久化/性能追踪 → 侧边栏渲染 的整条链路在此装配。
 */
export function startTokenWatch(host: HostAdapter): () => void {
  const perfTracker = createPerfTracker()
  const [sidebarRevision, setSidebarRevision] = createSignal(0)
  const [allTokenMessages, setAllTokenMessages] = createSignal<TokenMessage[]>([])
  let currentSessionID = ""
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const persist = (sessionID: string, msgs: TokenMessage[]): void => {
    try {
      host.store.set(kvKey(sessionID), msgs)
    } catch { /* non-critical */ }
  }

  /** 切换会话：恢复 KV 历史 → 后台轮询重建（历史加载可能是异步的） */
  const switchSession = (sessionID: string): void => {
    if (!sessionID || sessionID === currentSessionID) return
    currentSessionID = sessionID
    perfTracker.loadSession(sessionID)

    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }

    let loaded: TokenMessage[] = []
    try {
      const saved = host.store.get<TokenMessage[] | undefined>(kvKey(sessionID), undefined)
      if (saved && saved.length > 0) loaded = saved
    } catch { /* fall through */ }
    setAllTokenMessages(loaded)

    // 历史会话消息可能尚未加载完成：短周期轮询直到拿到数据或超时
    let pollCount = 0
    const maxPolls = 50 // 最多 10 秒（50 × 200ms）
    pollTimer = setInterval(() => {
      pollCount++
      let existing: readonly any[] = []
      try {
        existing = host.sessionMessages(sessionID)
      } catch { existing = [] }
      if (!existing || existing.length === 0) {
        if (pollCount >= maxPolls && pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        return
      }
      const rebuilt = rebuildFromMessages(sessionID, existing)
      setAllTokenMessages((prev) => {
        if (prev.length >= rebuilt.length) return prev
        persist(sessionID, rebuilt)
        return rebuilt
      })
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }, 200)
  }

  // ── 事件订阅（adapter 已归一化两代差异）──
  const unsubscribe = host.subscribe({
    onMessageUpdated(event) {
      perfTracker.handleMessageUpdated(toPerfMessageEvent(event))

      // 聚合当前 TUI 内存模型（与 rebuildFromMessages 同一套过滤规则）
      if (event.role === "assistant" && event.total > 0) {
        setAllTokenMessages((prev) => {
          const msg: TokenMessage = {
            id: event.messageID,
            sessionID: event.sessionID,
            providerID: event.providerID,
            modelID: event.modelID,
            inputTokens: event.input,
            outputTokens: event.output,
            reasoningTokens: event.reasoning,
            cacheRead: event.cacheRead,
            cacheWrite: event.cacheWrite,
            cost: event.cost,
          }
          const idx = prev.findIndex((m) => m.id === msg.id)
          let next: TokenMessage[]
          if (idx >= 0) {
            next = [...prev]
            next[idx] = msg
          } else {
            next = [...prev, msg]
          }
          // 优先使用事件自带的 sessionID，避免 slot 渲染时序导致的错存
          const target = event.sessionID || currentSessionID
          persist(target, next)
          return next
        })
      }

      setSidebarRevision((v) => v + 1)
    },

    onPartUpdated(event) {
      perfTracker.handlePartUpdated(toPerfPartEvent(event))
    },

    onInvalidate() {
      setSidebarRevision((v) => v + 1)
    },
  })

  // ── 侧边栏插槽 ──
  host.registerSidebar((input) => {
    // 读取 revision 以建立响应式依赖：事件到达时插槽重新渲染
    sidebarRevision()
    switchSession(input.sessionID)

    return (
      <TokenWatchPanel
        host={host}
        perfTracker={perfTracker}
        messages={() => {
          try {
            return host.sessionMessages(currentSessionID)
          } catch {
            return []
          }
        }}
        messageParts={(messageID) => host.messageParts(messageID, currentSessionID)}
        allTokenMessages={allTokenMessages}
      />
    )
  })

  host.onDispose(() => {
    unsubscribe()
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return () => {
    unsubscribe()
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}
