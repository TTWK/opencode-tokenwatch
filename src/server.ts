import type { PluginModule } from "@opencode-ai/plugin"

/**
 * Server 插件入口。
 *
 * v1 契约禁止 server 与 tui 同时出现，因此 TUI 入口在 ./tui（dist/tui.js）。
 * 这里额外携带 setup，使 opencode2 在以包主入口解析时也能找到 v2 入口：
 * - v1 加载器忽略多余字段，不受影响
 * - setup 内部用动态 import 惰性加载 TUI 装配代码，
 *   避免 server 进程在加载阶段就解析 @opentui 依赖
 */
const plugin: PluginModule & {
  id: string
  setup?: (ctx: any) => Promise<(() => void) | void>
} = {
  id: "opencode-tokenwatch",
  server: async () => {
    return {}
  },
  setup: async (ctx: any) => {
    const mod = await import("./tui.js")
    return mod.default.setup?.(ctx)
  },
}

export default plugin
