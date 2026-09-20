/** @jsxImportSource @opentui/solid */
/**
 * v1 宿主适配层：把 opencode 1.x 的 `TuiPluginApi` 折叠为统一 `HostAdapter`。
 */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { getUsageReport } from "./data-source.js"
import type {
  HostAdapter,
  HostEventHandlers,
  KeyValueStore,
  NormalizedMessageEvent,
  NormalizedPartEvent,
  NotifyVariant,
  SidebarInput,
  ThemeColors,
  UsageDataSource,
} from "../types.js"

/**
 * v1 走 `opencode db` 执行 SQL，速度快且维度完整，
 * 因此不需要首次运行提示。
 */
const sqlDataSource: UsageDataSource = {
  kind: "sql",
  needsFirstRunNotice: false,
  isCold: () => false,
  getUsageReport: (filters) => getUsageReport(filters),
}

/** v1 kv 的 KeyValueStore 折叠（v1/commands.tsx 复用同一份，避免两套实现漂移） */
export function makeStore(api: TuiPluginApi): KeyValueStore {
  return {
    get(key, fallback) {
      try {
        const v = api.kv?.get?.(key)
        return (v === undefined || v === null ? fallback : v) as any
      } catch {
        return fallback
      }
    },
    set(key, value) {
      try {
        api.kv?.set?.(key, value)
      } catch { /* non-critical */ }
    },
    delete(key) {
      // 旧版宿主 kv 可能没有 delete：淘汰策略在此类宿主上优雅降级（仅索引封顶）
      try { (api.kv as any)?.delete?.(key) } catch { /* non-critical */ }
    },
  }
}

function readTheme(api: TuiPluginApi): ThemeColors {
  const c = (api.theme as any)?.current ?? {}
  const fallback = c.text ?? c.primary
  return {
    primary: c.primary ?? fallback,
    text: c.text ?? fallback,
    textMuted: c.textMuted ?? fallback,
    background: c.background ?? fallback,
    border: c.border ?? c.borderSubtle ?? fallback,
    success: c.success ?? fallback,
    warning: c.warning ?? fallback,
    error: c.error ?? fallback,
  }
}

function normalizeMessageUpdated(event: any): NormalizedMessageEvent | null {
  const info = event?.properties?.info ?? event?.info
  if (!info) return null
  const tokens = info.tokens ?? {}
  const cache = tokens.cache ?? {}
  return {
    messageID: info.id ?? "",
    sessionID: info.sessionID ?? "",
    role: info.role ?? "",
    providerID: info.providerID ?? "unknown",
    modelID: info.modelID ?? "unknown",
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
    reasoning: tokens.reasoning ?? 0,
    cacheRead: cache.read ?? 0,
    cacheWrite: cache.write ?? 0,
    total: tokens.total ?? 0,
    cost: info.cost ?? 0,
    timeCreated: info.time?.created,
    timeCompleted: info.time?.completed,
    raw: event,
  }
}

function normalizePartUpdated(event: any): NormalizedPartEvent {
  const part = event?.properties?.part ?? event?.part ?? {}
  return {
    messageID: part.messageID,
    type: part.type,
    text: part.type === "text" ? part.text : undefined,
    timeStart: part.time?.start,
    raw: event,
  }
}

export function createV1Adapter(api: TuiPluginApi): HostAdapter {
  return {
    kind: "v1",
    hostVersion: (api as any)?.app?.version ?? "1.x",
    theme: () => readTheme(api),
    store: makeStore(api),

    subscribe(handlers: HostEventHandlers) {
      const off: Array<() => void> = []
      // 每次消息更新都触发重算：v1 的 state 非响应式，侧边栏依赖 revision 刷新
      off.push(
        api.event.on("message.updated", (event: any) => {
          const normalized = normalizeMessageUpdated(event)
          if (normalized) handlers.onMessageUpdated(normalized)
          handlers.onInvalidate()
        }),
      )
      off.push(
        api.event.on("message.part.updated", (event: any) => {
          handlers.onPartUpdated(normalizePartUpdated(event))
        }),
      )
      off.push(
        api.event.on("message.removed", () => {
          handlers.onInvalidate()
        }),
      )
      return () => {
        for (const fn of off) {
          try { fn() } catch { /* ignore */ }
        }
      }
    },

    registerSidebar(render: (input: SidebarInput) => any) {
      try {
        api.slots.register({
          order: 50,
          slots: {
            sidebar_content: (_ctx: any, input: any) => render({ sessionID: input?.session_id ?? "" }),
          },
        })
      } catch { /* host may not expose this slot */ }
      return () => {}
    },

    // registerCommands 不在此实现（审查 #13）：v1 的命令经由 host/v1/commands.tsx
    // 用原生 DialogSelect 实现（UX 优于通用 select），HostAdapter.registerCommands
    // 在 v1 下不可达，契约中已改为可选 —— 详见 docs/CODE-REVIEW-2026-09-13.md

    notify(message: string, variant: NotifyVariant = "info") {
      try {
        api.ui?.toast?.({ message, variant })
      } catch { /* non-critical */ }
    },

    async alert(input: { title: string; message: string }) {
      // v1 的模态对话框需要 dialog stack 上下文，此处降级为 toast
      try {
        api.ui?.toast?.({ message: `${input.title}: ${input.message}`, variant: "info" })
      } catch { /* non-critical */ }
    },

    async select() {
      // v1 的选择菜单依赖 dialog stack，由 host/v1/commands.tsx 直接用原生 API 实现
      return undefined
    },

    onDispose(fn: () => void) {
      try {
        api.lifecycle?.onDispose?.(fn)
      } catch { /* non-critical */ }
    },

    sessionMessages(sessionID: string) {
      try {
        return api.state?.session?.messages?.(sessionID) ?? []
      } catch {
        return []
      }
    },

    messageParts(messageID: string) {
      try {
        return (api.state as any)?.part?.(messageID) ?? []
      } catch {
        return []
      }
    },

    appConfig() {
      try {
        return ((api.state as any)?.config ?? {}) as Record<string, unknown>
      } catch {
        return {}
      }
    },

    onPartUpdated(handler: () => void) {
      try {
        return api.event.on("message.part.updated", () => handler())
      } catch {
        return () => {}
      }
    },

    dataSource: sqlDataSource,
  }
}
