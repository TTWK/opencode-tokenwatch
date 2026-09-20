/** @jsxImportSource @opentui/solid */
/**
 * 分发入口 —— 单一包体同时服务两代宿主。
 *
 * default export 同时携带 `tui` 与 `setup`：
 * - opencode 1.x 加载后调用 `tui(api)`（v1 加载器只认 tui，忽略 setup）
 * - opencode2 加载后调用 `setup(ctx)`（v2 校验只查 id + setup，忽略 tui）
 *
 * 宿主调用哪个入口，本身就是 100% 可靠的代际判断，无需任何启发式探测。
 */
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { startTokenWatch } from "./host/runtime.js"
import { createV1Adapter } from "./host/v1/adapter.js"
import { registerCommands as registerV1Commands } from "./host/v1/commands.js"
import { createV2Adapter } from "./host/v2/adapter.js"
import { registerV2Commands } from "./host/v2/commands.js"

const tui: TuiPluginModule["tui"] = async (api) => {
  const host = createV1Adapter(api)
  startTokenWatch(host)
  // v1 用原生 DialogSelect 菜单（UX 优于通用 select）
  await registerV1Commands(api)
}

/**
 * v2 装配入口。
 *
 * 错误必须"可见"：v2 宿主失败时只弹一个不含调用栈的提示，
 * 因此这里捕获装配期异常，用 toast 暴露首行原因，便于定位。
 */
const setup = (ctx: any) => {
  try {
    const dispose = new Set<() => void>()
    const host = createV2Adapter(ctx, dispose)
    startTokenWatch(host)
    registerV2Commands(host)
    return () => {
      for (const fn of dispose) {
        try { fn() } catch { /* ignore */ }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message).split("\n")[0] : String(err)
    try {
      ctx?.ui?.toast?.show({ message: `TokenWatch setup failed: ${message}`, variant: "error" })
    } catch { /* host may not expose toast */ }
    return () => {}
  }
}

const plugin: TuiPluginModule & { id: string; setup?: (ctx: any) => (() => void) | void } = {
  id: "opencode-tokenwatch",
  tui,
  setup,
}

export default plugin
