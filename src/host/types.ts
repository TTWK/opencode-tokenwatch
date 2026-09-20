/**
 * 宿主无关的能力契约。
 *
 * v1（opencode 1.x，TuiPluginApi）与 v2（opencode2，Plugin Context）在
 * 事件模型、插槽命名、主题结构、命令注册、存储 API 上全都不同。
 * 本文件定义两者共同能力的交集，由各自的 adapter 负责映射。
 *
 * 上层 UI / 命令逻辑只依赖本接口，因此可以在两代宿主间完全复用。
 */
import type { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type { UsageFilters, UsageReport } from "../kernel/format.js"

export type HostKind = "v1" | "v2"

/** 归一化主题色。v1 扁平、v2 嵌套，由 adapter 各自映射。 */
export interface ThemeColors {
  readonly primary: RGBA
  readonly text: RGBA
  readonly textMuted: RGBA
  readonly background: RGBA
  readonly border: RGBA
  readonly success: RGBA
  readonly warning: RGBA
  readonly error: RGBA
}

/** 归一化消息事件（由两代各自的事件形状折叠而来） */
export interface NormalizedMessageEvent {
  readonly messageID: string
  readonly sessionID: string
  readonly role: string
  readonly providerID: string
  readonly modelID: string
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
  readonly cost: number
  /** 请求开始时间（epoch ms），供性能追踪计算延迟/TPS */
  readonly timeCreated?: number
  /** 请求完成时间（epoch ms），缺失时性能追踪跳过该样本 */
  readonly timeCompleted?: number
  /** 原始事件对象，供性能追踪器读取时间戳等宿主专属字段 */
  readonly raw: any
}

/** 归一化 part 事件（用于 TTFT 计时） */
export interface NormalizedPartEvent {
  readonly messageID?: string
  readonly type?: string
  readonly text?: string
  readonly timeStart?: number
  readonly raw: any
}

export interface HostEventHandlers {
  onMessageUpdated(event: NormalizedMessageEvent): void
  onPartUpdated(event: NormalizedPartEvent): void
  /** 消息被删除 / 会话数据失效，UI 应重算 */
  onInvalidate(): void
}

/** 侧边栏渲染入参（归一化：两代宿主都提供 sessionID） */
export interface SidebarInput {
  readonly sessionID: string
}

/** 键值存储（配置与折叠状态） */
export interface KeyValueStore {
  get<T>(key: string, fallback: T): T
  set<T>(key: string, value: T): void
  /** 删除条目；v1 宿主可能不提供（调用方需判空），用于会话消息 KV 的淘汰 */
  delete?(key: string): void
}

export interface CommandSpec {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly category?: string
  /** 斜杠命令名（不含前导斜杠） */
  readonly slash?: string
  readonly run: () => void | Promise<void>
}

export interface SelectOption<Value> {
  readonly title: string
  readonly value: Value
  readonly description?: string
}

export type NotifyVariant = "info" | "success" | "warning" | "error"

/**
 * 历史用量数据源。
 *
 * v1 通过 `opencode db` 执行 SQL（快、功能完整）；
 * v2 移除了 db 子命令，只能在客户端遍历会话消息重算（慢、需要缓存与进度提示）。
 */
export interface UsageDataSource {
  readonly kind: "sql" | "client-scan"
  /**
   * 首次取数是否需要显著耗时。
   * v2 为 true —— 宿主应在调用前提示用户。
   */
  readonly needsFirstRunNotice: boolean
  /**
   * 本次取数是否会触发冷启动全量扫描。
   * SQL 数据源恒为 false；client-scan 在缓存为空时返回 true。
   */
  readonly isCold: () => boolean
  getUsageReport(filters: UsageFilters): Promise<UsageReport>
}

/** 宿主能力统一抽象 */
export interface HostAdapter {
  readonly kind: HostKind
  /** 宿主版本号，用于诊断与报告元信息 */
  readonly hostVersion: string

  theme(): ThemeColors
  store: KeyValueStore

  /** 订阅事件，返回取消订阅函数 */
  subscribe(handlers: HostEventHandlers): () => void

  /** 挂载侧边栏 UI，返回卸载函数 */
  registerSidebar(render: (input: SidebarInput) => JSX.Element): () => void

  /**
   * 注册命令，返回注销函数。
   * v1 经由 host/v1/commands.tsx 用原生 DialogSelect 实现菜单，不走此方法。
   */
  registerCommands?(specs: readonly CommandSpec[]): () => void

  notify(message: string, variant?: NotifyVariant): void
  alert(input: { title: string; message: string }): Promise<void>
  select<Value>(input: {
    title: string
    options: readonly SelectOption<Value>[]
  }): Promise<Value | undefined>

  /** 宿主退出 / 插件卸载时调用 */
  onDispose(fn: () => void): void

  /** 当前会话消息列表（用于侧边栏 token 分布估算与历史重建） */
  sessionMessages(sessionID: string): readonly any[]

  /**
   * 指定消息的 part 列表，归一化到 v1 part 形状。
   *
   * v1 需要二次查询 `api.state.part(id)`（会话无关，sessionID 忽略）；
   * v2 传入 sessionID 时走 O(1) 的 `message.get(sessionID, id)`，
   * 避免跨全部会话线性扫描。
   */
  messageParts(messageID: string, sessionID?: string): readonly any[]

  /** 宿主应用配置（读取 agent prompt 用于 system token 估算） */
  appConfig(): Record<string, unknown>

  /** 订阅 part 级更新（用于 token 分布重算），返回取消订阅函数 */
  onPartUpdated(handler: () => void): () => void

  readonly dataSource: UsageDataSource
}
