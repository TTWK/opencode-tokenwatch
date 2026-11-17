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
import { isServerActive } from "../kernel/server-state.js"
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
        time: { created: e.timeCreated, streamed: e.timeStreamed, completed: e.timeCompleted },
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

/** 按 messageID 幂等增量合并消息列表，只增不减，防止局部残卷覆盖完整历史 */
function mergeMessages(existing: readonly TokenMessage[], incoming: readonly TokenMessage[]): TokenMessage[] {
  const map = new Map<string, TokenMessage>()
  for (const m of existing) {
    if (m?.id) map.set(m.id, m)
  }
  for (const m of incoming) {
    if (m?.id) {
      map.set(m.id, m)
    }
  }
  return Array.from(map.values())
}

/** 比较两个消息列表的内容是否完全一致（用于精准守卫避免冗余更新，且不错漏 Token 变化） */
function areMessagesEqual(a: readonly TokenMessage[], b: readonly TokenMessage[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ma = a[i]
    const mb = b[i]
    if (ma.id !== mb.id) return false
    if (
      ma.inputTokens !== mb.inputTokens ||
      ma.outputTokens !== mb.outputTokens ||
      ma.reasoningTokens !== mb.reasoningTokens ||
      ma.cacheRead !== mb.cacheRead ||
      ma.cacheWrite !== mb.cacheWrite ||
      ma.cost !== mb.cost ||
      ma.modelID !== mb.modelID ||
      ma.providerID !== mb.providerID
    ) {
      return false
    }
  }
  return true
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
  // 必须保持 TUI 进程本地权威落盘（persistLog: true）：
  // OpenCode 2 的流式执行事件（step.started/ended、delta、streamed 耗时）
  // 仅在客户端 TUI 进程的本地总线上派发。Server 进程无法捕获完整的流式首 Token
  // 与活跃耗时，因此 TUI 必须作为权威落盘源，杜绝因进程状态探测导致全端断流。
  const perfTracker = createPerfTracker({ persistLog: true })
  const [sidebarRevision, setSidebarRevision] = createSignal(0)
  const [perfRevision, setPerfRevision] = createSignal(0)
  const [allTokenMessages, setAllTokenMessages] = createSignal<TokenMessage[]>([])
  let currentSessionID = ""
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // 写节流状态：每个会话独立维护 pending payload，burst 内合并低频落盘
  const pendingPersist = new Map<string, TokenMessage[]>()
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const persistNow = (sessionID: string, msgs: TokenMessage[]): void => {
    try {
      host.store.set(kvKey(sessionID), msgs)
    } catch { /* non-critical */ }
  }

  const flushPersist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    for (const [sid, msgs] of pendingPersist) {
      persistNow(sid, msgs)
    }
    pendingPersist.clear()
  }

  /** 尾沿节流：burst 开始后 ≤500ms 必写一次，期间连续更新只保留最后一份 */
  const persistThrottled = (sessionID: string, msgs: TokenMessage[]): void => {
    if (!sessionID) return
    pendingPersist.set(sessionID, msgs)
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      for (const [sid, msgs] of pendingPersist) {
        persistNow(sid, msgs)
      }
      pendingPersist.clear()
    }, PERSIST_DEBOUNCE_MS)
  }

  /** 维护会话 MRU 索引并淘汰超出上限的 KV 条目（修复 off-by-one，精确淘汰不在新索引中的旧会话） */
  const evictOldSessions = (sessionID: string): void => {
    try {
      const index = host.store.get<string[]>(SESSION_INDEX_KEY, []).filter(Boolean)
      const next = [sessionID, ...index.filter((id) => id !== sessionID)].slice(0, KV_SESSION_KEEP)
      host.store.set(SESSION_INDEX_KEY, next)
      if (typeof host.store.delete === "function") {
        const evicted = index.filter((id) => !next.includes(id))
        for (const id of evicted) {
          try { host.store.delete(kvKey(id)) } catch { /* non-critical */ }
        }
      }
    } catch { /* non-critical */ }
  }

  /** 切换会话：恢复 KV 历史 → 后台渐进式合并重建（历史加载可能是异步分页的） */
  const switchSession = (sessionID: string): void => {
    if (!sessionID || sessionID === currentSessionID) return
    currentSessionID = sessionID
    // JSONL 重放是异步的（内部有过期令牌，快速切换不会串话），重放完成时通知 UI 刷新均值
    void perfTracker.loadSession(sessionID).then(() => {
      setPerfRevision((v) => v + 1)
      setSidebarRevision((v) => v + 1)
    }).catch(() => {})
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

    // 历史会话消息由宿主异步拉取，采用渐进式合并：
    // 1. 每 200ms 拉取一次并进行 ID 幂等合并，只增不减，绝不覆灭已有历史
    // 2. 连续 4 次（800ms）消息数量无增长，或达到上限 25 次（5 秒）后停止
    let pollCount = 0
    let lastSeenCount = 0
    let stableCount = 0
    const maxPolls = 25

    pollTimer = setInterval(() => {
      pollCount++
      let existing: readonly any[] = []
      try {
        existing = host.sessionMessages(sessionID)
      } catch { existing = [] }

      if (existing && existing.length > 0) {
        const rebuilt = rebuildFromMessages(sessionID, existing)
        if (rebuilt.length > 0) {
          const current = allTokenMessages()
          const merged = mergeMessages(current, rebuilt)
          if (!areMessagesEqual(current, merged)) {
            setAllTokenMessages(merged)
            persistThrottled(sessionID, merged)
          }

          if (rebuilt.length === lastSeenCount) {
            stableCount++
          } else {
            lastSeenCount = rebuilt.length
            stableCount = 0
          }
        }
      }

      // 稳定无变化达到 4 次（约 800ms 消息总数未变），或者达到轮询总上限
      if ((stableCount >= 4 && lastSeenCount > 0) || pollCount >= maxPolls) {
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      }
    }, 200)
  }

  // ── 事件订阅（adapter 已归一化两代差异）──
  const unsubscribe = host.subscribe({
    onMessageUpdated(event) {
      perfTracker.handleMessageUpdated(toPerfMessageEvent(event))
      const targetSessionID = event.sessionID || currentSessionID
      if (targetSessionID === currentSessionID) {
        setPerfRevision((v) => v + 1)
      }

      // 聚合当前 TUI 内存模型（与 rebuildFromMessages 同一套过滤规则）。
      // 严格会话边界守卫：非当前前台会话事件绝对不混入当前 allTokenMessages 信号，
      // 避免跨会话污染与相互覆盖；非当前会话安全更新其自身的持久化缓存。
      if (event.role === "assistant" && event.total > 0) {
        const msg: TokenMessage = {
          id: event.messageID,
          sessionID: targetSessionID,
          providerID: event.providerID,
          modelID: event.modelID,
          inputTokens: event.input,
          outputTokens: event.output,
          reasoningTokens: event.reasoning,
          cacheRead: event.cacheRead,
          cacheWrite: event.cacheWrite,
          cost: event.cost,
        }

        if (targetSessionID === currentSessionID) {
          const prev = allTokenMessages()
          const idx = prev.findIndex((m) => m.id === msg.id)
          const next = idx >= 0
            ? prev.map((m, i) => (i === idx ? msg : m))
            : [...prev, msg]
          setAllTokenMessages(next)
          persistThrottled(currentSessionID, next)
          setSidebarRevision((v) => v + 1)
        } else if (targetSessionID) {
          // 迟到或后台会话事件：不污染当前前台信号，安全独立落盘目标会话
          try {
            const saved = pendingPersist.get(targetSessionID)
              ?? host.store.get<TokenMessage[] | undefined>(kvKey(targetSessionID), undefined)
              ?? []
            const idx = saved.findIndex((m) => m.id === msg.id)
            const next = idx >= 0
              ? saved.map((m, i) => (i === idx ? msg : m))
              : [...saved, msg]
            persistThrottled(targetSessionID, next)
          } catch { /* non-critical */ }
        }
      }
    },

    onPartUpdated(event) {
      perfTracker.handlePartUpdated(toPerfPartEvent(event))
    },

    onInvalidate() {
      if (currentSessionID) {
        try {
          const existing = host.sessionMessages(currentSessionID)
          if (existing && existing.length > 0) {
            const rebuilt = rebuildFromMessages(currentSessionID, existing)
            if (rebuilt.length > 0) {
              const current = allTokenMessages()
              const merged = mergeMessages(current, rebuilt)
              if (!areMessagesEqual(current, merged)) {
                setAllTokenMessages(merged)
                persistThrottled(currentSessionID, merged)
              }
            }
          }
        } catch { /* non-critical */ }
      }
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
        perfRevision={perfRevision}
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
