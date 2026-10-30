import type { PluginModule } from "@opencode-ai/plugin"

/**
 * Server 插件入口（v1 用 exports["."]/"./server"，v2 用 exports["./server"]）。
 *
 * 本插件是纯 TUI 插件：opencode2 的 TUI 进程会按 exports["./tui"] 独立加载 TUI
 * 入口并调用其中的 setup(ctx)，server 进程无需装配任何东西。
 *
 * 这里绝不能导入 ./tui.js：server 进程没有宿主给 TUI 插件准备的 @opentui 运行时
 * 改写层（bun-plugin-opentui-runtime-modules），一旦把 TUI 代码图拖进来，插件侧与
 * 宿主内嵌的 @opentui 就会在同一进程里各注册一次 OPENTUI_FORCE_UNICODE
 * （@opentui 的 env 注册表挂在 globalThis 的 Symbol.for 单例上，跨副本共享），
 * description 不一致时 registerEnvVar 直接抛错，整个插件加载失败。
 *
 * 空 setup 只为满足 v2 契约：模块必须有 id，且带 effect 或 setup。
 */
const plugin: PluginModule & {
  id: string
  setup?: (ctx: any) => Promise<(() => void) | void>
} = {
  id: "opencode-tokenwatch",
  server: async () => {
    return {}
  },
  setup: async () => {
    // 纯 TUI 插件，server 侧不做任何装配（TUI 侧由 ./tui 入口负责）
  },
}

export default plugin
