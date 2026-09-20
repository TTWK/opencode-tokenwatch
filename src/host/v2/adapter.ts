/**
 * v2 宿主适配层：把 opencode2 的 `Plugin Context` 折叠为统一 `HostAdapter`。
 *
 * 与 v1 的关键差异（均在此处吸收，上层无感）：
 * - 事件：`message.updated` 被拆成 `session.step.started/ended`、`session.message.content.updated`
 * - 插槽：`sidebar_content` → 点号路径 `sidebar.content`，且为单对象参数
 * - 主题：扁平 RGBA → 嵌套 token 树（`text.default` / `text.subdued` / `text.action.*`）
 * - 存储：`kv.get/set` → 响应式 `storage.store` + 异步 mutate
 * - 命令：`command.register` → `keymap.layer`
 * - 消息 part：需二次查询 → 消息内直接内嵌 `content`
 */
import { getUsageReport, isUsageCacheCold, markUsageCacheDirty } from "./data-source.js"
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

/** v2 插件 Context 的最小结构约束（避免对 beta SDK 的硬类型依赖） */
export interface V2Context {
  readonly app: { readonly version: string; readonly channel: string }
  readonly theme: any
  readonly themeMode: "dark" | "light"
  readonly data: {
    readonly on: (type: string, handler: (event: any) => void) => () => void
    readonly session: {
      list(): any[]
      get(sessionID: string): any | undefined
      readonly message: {
        list(sessionID: string): any[]
        get(sessionID: string, messageID: string): any | undefined
        sync(sessionID: string): Promise<void>
        invalidate(sessionID: string): void
      }
      sync(sessionID: string): Promise<void>
    }
    readonly location: {
      readonly agent: { list(location?: any): any[] | undefined }
    }
  }
  readonly ui: {
    readonly slot: (claim: any) => () => void
    readonly toast: { show(options: { message: string; variant?: string; title?: string }): void }
    readonly dialog: {
      alert(options: { title: string; message: string }): Promise<void>
      select<Value>(options: {
        title: string
        options: readonly { title: string; value: Value; description?: string }[]
      }): Promise<Value | undefined>
    }
  }
  readonly keymap: { layer(input: () => any): void }
  readonly storage: {
    store<Value extends object>(key: string, options: { readonly initial: Value }): readonly [any, (m: (draft: Value) => void) => Promise<void>]
  }
  readonly client: any
}

/** v2 主题是嵌套 token 树，映射到内核使用的扁平色 */
function readTheme(ctx: V2Context): ThemeColors {
  const t = ctx.theme ?? {}
  const fallback = t?.text?.default
  const actionPrimary = t?.text?.action?.primary?.default
  const feedback = t?.text?.feedback ?? {}
  return {
    primary: actionPrimary ?? fallback,
    text: t?.text?.default ?? fallback,
    textMuted: t?.text?.subdued ?? fallback,
    background: t?.background?.default ?? fallback,
    border: t?.border?.default ?? fallback,
    success: feedback?.success?.default ?? fallback,
    warning: feedback?.warning?.default ?? fallback,
    error: feedback?.error?.default ?? fallback,
  }
}

/**
 * 用 v2 的响应式 store 模拟 v1 的 kv 语义。
 *
 * v2 的 `storage.store` 只接受对象初值并提供异步 mutate，
 * 因此这里把所有 kv 键收拢到一个 `values` 映射下面。
 */
function makeStore(ctx: V2Context, dispose: Set<() => void>): KeyValueStore {
  const [state, mutate] = ctx.storage.store<{ values: Record<string, unknown> }>("tokenwatch", {
    initial: { values: {} },
  })
  return {
    get(key, fallback) {
      try {
        const v = state?.values?.[key]
        return (v === undefined || v === null ? fallback : v) as any
      } catch {
        return fallback
      }
    },
    set(key, value) {
      // mutate 是异步的，但调用方不需要等待落盘；失败不应影响 UI
      void mutate((draft) => {
        draft.values[key] = value
      }).catch(() => {})
    },
    delete(key) {
      void mutate((draft) => {
        delete (draft.values as Record<string, unknown>)[key]
      }).catch(() => {})
    },
  }
}

/** v2 消息内嵌 content，归一化为 v1 part 形状以复用上层分布估算 */
function normalizeParts(message: any): any[] {
  const content = message?.content
  if (!Array.isArray(content)) return []
  const out: any[] = []
  for (const part of content) {
    if (part?.type === "text") {
      out.push({ type: "text", text: part.text ?? "" })
    } else if (part?.type === "reasoning") {
      out.push({ type: "reasoning", text: part.text ?? "" })
    } else if (part?.type === "tool") {
      const st = part.state ?? {}
      out.push({
        type: "tool",
        name: part.name,
        state: {
          status: st.status,
          raw: st.input != null ? JSON.stringify(st.input) : undefined,
          input: st.input,
          // v2 工具输出在 content 数组里，需拼接为字符串
          output: st.status === "completed" ? stringifyToolContent(st.content) : undefined,
          error: st.status === "error" ? String(st.error ?? "") : undefined,
        },
      })
    }
  }
  return out
}

function stringifyToolContent(content: any): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  let out = ""
  for (const item of content) {
    if (typeof item === "string") out += item
    else if (item && typeof item.text === "string") out += item.text
    else if (item?.type === "text" && typeof item?.text === "string") out += item.text
  }
  return out
}

/**
 * v2 侧：把 `session.step.ended` + 消息详情折叠为归一化事件。
 *
 * step.ended 自带 tokens/cost/finish，但不含 model（model 在 step.started，
 * 更可靠的是直接查消息对象）。这里以 assistantMessageID 为准回查消息，
 * 拿到 model/provider 后再归一化。
 */
function buildMessageEvent(ctx: V2Context, data: any): NormalizedMessageEvent | null {
  const sessionID = data?.sessionID ?? ""
  const messageID = data?.assistantMessageID ?? ""
  const tokens = data?.tokens ?? {}
  const cache = tokens.cache ?? {}
  const message = messageID ? ctx.data.session.message.get(sessionID, messageID) : undefined
  const model = message?.model ?? {}

  const total =
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (cache.read ?? 0) +
    (cache.write ?? 0)

  return {
    messageID,
    sessionID,
    role: "assistant",
    providerID: model.providerID ?? "unknown",
    modelID: model.id ?? "unknown",
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
    reasoning: tokens.reasoning ?? 0,
    cacheRead: cache.read ?? 0,
    cacheWrite: cache.write ?? 0,
    total,
    cost: typeof data?.cost === "number" ? data.cost : 0,
    // step.ended 事件本身不带时间；从消息对象补齐（性能追踪需要 created/completed）。
    // TPS 的流式终点优先取 time.streamed（provider 响应体接收完毕，剔除收尾
    // settlement 时间），与宿主官方 tok/s 口径一致；缺失时回退 completed。
    timeCreated: message?.time?.created ?? data?.time?.created,
    timeCompleted: message?.time?.streamed ?? message?.time?.completed ?? data?.time?.completed,
    raw: data,
  }
}

export function createV2Adapter(ctx: V2Context, dispose: Set<() => void>): HostAdapter {
  let storeRef: KeyValueStore | undefined
  /** 待挂载的 keymap layer 注册动作，由 registerSidebar 在 slot 渲染时执行 */
  let mountKeymapLayer: (() => void) | undefined

  const clientScanDataSource: UsageDataSource = {
    kind: "client-scan",
    // v2 没有 `opencode db`，历史统计需遍历会话消息重算，首次必须提示用户
    needsFirstRunNotice: true,
    isCold: () => isUsageCacheCold(),
    getUsageReport: (filters) => getUsageReport(ctx, filters),
  }

  return {
    kind: "v2",
    hostVersion: ctx.app?.version ?? "2.x",
    theme: () => readTheme(ctx),
    get store(): KeyValueStore {
      if (!storeRef) storeRef = makeStore(ctx, dispose)
      return storeRef
    },

    subscribe(handlers: HostEventHandlers) {
      const off: Array<() => void> = []

      off.push(
        ctx.data.on("session.step.ended", (event: any) => {
          const normalized = buildMessageEvent(ctx, event?.data)
          if (normalized) handlers.onMessageUpdated(normalized)
          handlers.onInvalidate()
        }),
      )
      // TPS 流式窗口起点（对齐宿主官方 tok/s 口径 output/(streamed−created)）：
      // step.started = LLM 请求起点（reasoning 由此开始流式）。min() 逻辑会
      // 自动取最早锚点，普通模型即 text.started，推理模型即 step/reasoning。
      off.push(
        ctx.data.on("session.step.started", (event: any) => {
          const data = event?.data ?? {}
          const part: NormalizedPartEvent = {
            messageID: data.assistantMessageID,
            type: "step",
            timeStart: event?.created,
            raw: event,
          }
          handlers.onPartUpdated(part)
        }),
      )
      // 推理/文本 part 的"打开"事件：provider 打开占位符即发（≈ step 起点，
      // 恒早于首 token），只作 TPS 流式窗口锚点，不参与 TTFT
      off.push(
        ctx.data.on("session.reasoning.started", (event: any) => {
          const data = event?.data ?? {}
          const part: NormalizedPartEvent = {
            messageID: data.assistantMessageID,
            type: "part-open",
            timeStart: event?.created,
            raw: event,
          }
          handlers.onPartUpdated(part)
        }),
      )
      // 首个内容片段（delta）= 真实"首 token"时刻，用作 TTFT 锚点
      off.push(
        ctx.data.on("session.reasoning.delta", (event: any) => {
          const data = event?.data ?? {}
          const part: NormalizedPartEvent = {
            messageID: data.assistantMessageID,
            type: "reasoning-delta",
            timeStart: event?.created,
            raw: event,
          }
          handlers.onPartUpdated(part)
        }),
      )
      off.push(
        ctx.data.on("session.text.delta", (event: any) => {
          const data = event?.data ?? {}
          const part: NormalizedPartEvent = {
            messageID: data.assistantMessageID,
            type: "text-delta",
            timeStart: event?.created,
            raw: event,
          }
          handlers.onPartUpdated(part)
        }),
      )
      // 文本 part 打开事件：同 reasoning.started，仅作窗口锚点
      off.push(
        ctx.data.on("session.text.started", (event: any) => {
          const data = event?.data ?? {}
          const part: NormalizedPartEvent = {
            messageID: data.assistantMessageID,
            type: "part-open",
            timeStart: event?.created ?? data.time?.start,
            raw: event,
          }
          handlers.onPartUpdated(part)
        }),
      )
      off.push(
        ctx.data.on("session.message.content.updated", () => {
          handlers.onInvalidate()
        }),
      )
      off.push(
        ctx.data.on("session.idle", () => {
          // 空闲 = 一步请求已落库：标记用量缓存脏，下次 /usage 后台重建
          // （stale-while-revalidate，避免报告数据停留在首次扫描时刻）
          markUsageCacheDirty()
          handlers.onInvalidate()
        }),
      )

      const disposeFn = () => {
        for (const fn of off) {
          try { fn() } catch { /* ignore */ }
        }
      }
      return disposeFn
    },

    registerSidebar(render: (input: SidebarInput) => any) {
      // 面板插槽：只负责渲染 TokenWatchPanel
      const offPanel = ctx.ui.slot({
        append: "sidebar.content",
        render: (input: any) => render({ sessionID: input?.sessionID ?? "" }),
      })
      // 命令挂载载体：keymap layer 依赖渲染 owner（见 registerCommands）。
      // prompt.footer 在主屏和会话输入框都会挂载，且不受侧边栏折叠影响；
      // 多会话标签页会挂载多份，宿主按命令 id 去重，重复注册无害。
      const offVehicle = ctx.ui.slot({
        append: "prompt.footer",
        render: () => {
          mountKeymapLayer?.()
          return null
        },
      })
      return () => {
        if (typeof offPanel === "function") offPanel()
        if (typeof offVehicle === "function") offVehicle()
      }
    },

    registerCommands(specs) {
      // v2 的 keymap.layer（= Keymap.createLayer）内部先 useValue() 读 Keymap
      // Provider 上下文，再经 useBindings 调 createEffect —— 两者都要求调用方
      // 处于宿主组件树内且拥有 Solid owner。而 setup() 在无 owner 的 Promise
      // 链中执行，直接调用必抛 "Keymap.Provider is missing"。slot render 由
      // 宿主 createComponent 挂载（body 只跑一次、带 owner、在组件树内），
      // 是插件唯一合法挂载点：把注册动作存起来，由 registerSidebar 在 slot
      // 挂载时执行。
      let mountFailed = false
      const mount = () => {
        try {
          ctx.keymap.layer(() => ({
            mode: "global",
            commands: specs.map((spec) => ({
              id: spec.id,
              title: spec.title,
              description: spec.description,
              group: spec.category ?? "Stats",
              palette: true,
              slash: spec.slash ? { name: spec.slash } : undefined,
              run: () => {
                void spec.run()
              },
            })),
          }))
        } catch (err) {
          // 失败必须可见：命令静默消失比报错更难排查（与 tui.tsx setup 约定一致）
          if (!mountFailed) {
            mountFailed = true
            try {
              const message = err instanceof Error ? err.message : String(err)
              ctx.ui?.toast?.show({ message: `TokenWatch commands unavailable: ${message}`, variant: "error" })
            } catch { /* host may not expose toast */ }
          }
        }
      }
      mountKeymapLayer = mount
      return () => {
        if (mountKeymapLayer === mount) mountKeymapLayer = undefined
      }
    },

    notify(message: string, variant: NotifyVariant = "info") {
      try {
        ctx.ui?.toast?.show({ message, variant })
      } catch { /* non-critical */ }
    },

    async alert(input: { title: string; message: string }) {
      try {
        await ctx.ui.dialog.alert(input)
      } catch { /* non-critical */ }
    },

    async select(input) {
      try {
        return await ctx.ui.dialog.select({
          title: input.title,
          options: input.options,
        })
      } catch {
        return undefined
      }
    },

    onDispose(fn: () => void) {
      dispose.add(fn)
    },

    sessionMessages(sessionID: string) {
      try {
        return ctx.data.session.message.list(sessionID) ?? []
      } catch {
        return []
      }
    },

    messageParts(messageID: string, sessionID?: string) {
      try {
        // part 内嵌在消息里；知道所属会话时 O(1) 直取
        if (sessionID) {
          const message = ctx.data.session.message.get(sessionID, messageID)
          if (message) return normalizeParts(message)
        }
        // 回退：跨会话扫描（慢，仅未知会话时使用）
        for (const session of ctx.data.session.list()) {
          const messages = ctx.data.session.message.list(session.id) ?? []
          for (const message of messages) {
            if (message?.id === messageID) return normalizeParts(message)
          }
        }
      } catch { /* fall through */ }
      return []
    },

    appConfig() {
      try {
        const agents = ctx.data.location.agent.list() ?? []
        return { agent: Object.fromEntries(agents.map((a: any) => [a?.name ?? a?.id ?? "default", a])) }
      } catch {
        return {}
      }
    },

    onPartUpdated(handler: () => void) {
      try {
        return ctx.data.on("session.message.content.updated", () => handler())
      } catch {
        return () => {}
      }
    },

    dataSource: clientScanDataSource,
  }
}
