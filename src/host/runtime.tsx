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
    // v1 的 state.session.messages 形状随宿主版本变动：平铺字段可能嵌在 info 层，
    // 逐字段做双层兜底，避免重建得到空数组
    const info = msg?.info ?? {}
    const m = { ...info, ...msg }
    // v1 消息带 role，v2 消息带 type —— 两者都接受
    const kind = m.type ?? m.role
    if (kind !== "assistant") continue
    const tokens = m.tokens
    if (!tokens) continue
    // v2 的 TokenUsageInfo 没有 total 字段，按五分量现算
    const total =
      (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) +
      (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
    if (total === 0) continue
    out.push({
      id: m.id,
      sessionID,
      // v1 平铺 providerID/modelID；v2 嵌套在 model 里
      providerID: m.model?.providerID ?? m.providerID ?? "unknown",
      modelID: m.model?.id ?? m.modelID ?? "unknown",
      inputTokens: tokens.input ?? 0,
      outputTokens: tokens.output ?? 0,
      reasoningTokens: tokens.reasoning ?? 0,
      cacheRead: tokens.cache?.read ?? 0,
      cacheWrite: tokens.cache?.write ?? 0,
      cost: m.cost ?? 0,
    })
  }
  return out
}

/** 消息数组的 KV 写节流窗口：流式期间每条消息更新都会触发，合并为低频落盘 */
const PERSIST_DEBOUNCE_MS = 500
/** KV 中保留消息数组缓存的会话数上限（MRU 淘汰，防止 KV 无界膨胀） */
const KV_SESSION_KEEP = 20
const SESSION_INDEX_KEY = "tokenwatch-session-index"

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

  // 写节流状态：burst 内只保留最新负载，定时器到期一次性落盘
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let persistSession = ""
  let persistMsgs: TokenMessage[] = []

  const persistNow = (sessionID: string, msgs: TokenMessage[]): void => {
    try {
      host.store.set(kvKey(sessionID), msgs)
    } catch { /* non-critical */ }
  }

  /** 尾沿节流：burst 开始后 ≤500ms 必写一次，期间连续更新只保留最后一份 */
  const persistThrottled = (sessionID: string, msgs: TokenMessage[]): void => {
    persistSession = sessionID
    persistMsgs = msgs
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistNow(persistSession, persistMsgs)
    }, PERSIST_DEBOUNCE_MS)
  }

  const flushPersist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    if (persistMsgs.length > 0) persistNow(persistSession, persistMsgs)
  }

  /** 维护会话 MRU 索引并淘汰超出上限的 KV 条目（宿主无 delete 时优雅降级为仅索引封顶） */
  const evictOldSessions = (sessionID: string): void => {
    try {
      const index = host.store.get<string[]>(SESSION_INDEX_KEY, []).filter(Boolean)
      const next = [sessionID, ...index.filter((id) => id !== sessionID)].slice(0, KV_SESSION_KEEP)
      host.store.set(SESSION_INDEX_KEY, next)
      if (typeof host.store.delete === "function") {
        for (const id of index.slice(KV_SESSION_KEEP)) {
          if (!next.includes(id)) {
            try { host.store.delete(kvKey(id)) } catch { /* non-critical */ }
          }
        }
      }
    } catch { /* non-critical */ }
  }

  /** 切换会话：恢复 KV 历史 → 后台轮询重建（历史加载可能是异步的） */
  const switchSession = (sessionID: string): void => {
    if (!sessionID || sessionID === currentSessionID) return
    currentSessionID = sessionID
    // JSONL 重放是异步的（内部有过期令牌，快速切换不会串话）
    void perfTracker.loadSession(sessionID)
    evictOldSessions(sessionID)

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
        return rebuilt
      })
      persistThrottled(sessionID, rebuilt)
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

      // 聚合当前 TUI 内存模型（与 rebuildFromMessages 同一套过滤规则）。
      // 事件处理器是串行的，先读后写不与 updater 副作用混用，保持 setSignal 纯净。
      if (event.role === "assistant" && event.total > 0) {
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
        const prev = allTokenMessages()
        const idx = prev.findIndex((m) => m.id === msg.id)
        const next = idx >= 0
          ? prev.map((m, i) => (i === idx ? msg : m))
          : [...prev, msg]
        setAllTokenMessages(next)
        // 优先使用事件自带的 sessionID，避免 slot 渲染时序导致的错存
        persistThrottled(event.sessionID || currentSessionID, next)
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
    // 会话切换含 KV 读取、信号写入等副作用，不能在渲染上下文里同步执行，
    // 推迟到微任务中（ Solid 会在信号变化后自动重渲染本插槽）
    const sid = input.sessionID
    queueMicrotask(() => switchSession(sid))

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

  const disposeAll = (): void => {
    unsubscribe()
    flushPersist()
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  host.onDispose(disposeAll)

  return disposeAll
}
