import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"
import { readFileSync } from "node:fs"

/**
 * esbuild build script for opencode-tokenwatch TUI plugin.
 *
 * Bundles src/tui.tsx -> dist/tui.js with SolidJS JSX pre-compiled
 * (JSX -> createComponent calls via esbuild-plugin-solid).
 * Also builds src/server.ts -> dist/server.js (plain JS, no JSX).
 *
 * All runtime deps (solid-js, @opentui/*, @opencode-ai/*) are kept
 * as external imports - the OpenCode TUI host provides them at runtime.
 */

const external = [
  "solid-js",
  "solid-js/*",
  "@opentui/solid",
  "@opentui/solid/*",
  "@opentui/core",
  "@opentui/core/*",
  "@opentui/keymap",
  "@opentui/keymap/*",
  "@opencode-ai/plugin",
  "@opencode-ai/plugin/*",
  "@opencode-ai/sdk",
  "@opencode-ai/sdk/*",
]

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  external,
  logLevel: "info",
}

await Promise.all([
  // TUI module - SolidJS JSX pre-compilation
  build({
    ...common,
    entryPoints: ["src/tui.tsx"],
    outfile: "dist/tui.js",
    plugins: [solidPlugin({
      solid: { moduleName: "@opentui/solid", generate: "universal" },
    })],
  }),
  // Server module - no JSX, 且绝不引用 TUI 代码图。
  // opencode2 的 TUI 进程会按 exports["./tui"] 独立加载 TUI 入口（并在 TUI 进程
  // 调用其 setup），server 进程只执行本文件里的空 setup。若此处把 ./tui.js 内联
  // 或动态 import，@opentui 会被拖进没有运行时改写层的 server 进程，与宿主内嵌
  // 副本重复注册 env 变量（OPENTUI_FORCE_UNICODE）导致插件加载失败。
  build({
    ...common,
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
  }),
])

// ── 产物断言：server 入口必须是"零 TUI 依赖"的空壳 ──
// 这里曾要求 server.js 保留 import("./tui.js")（在 server 进程惰性加载 TUI 代码图）。
// 该设计会让 @opentui 进入 server 进程，与宿主内嵌副本重复注册 env 变量
// （OPENTUI_FORCE_UNICODE）导致插件加载失败。现在 TUI 由宿主按 exports["./tui"]
// 在 TUI 进程独立加载，server 侧引用任何 TUI 代码图都视为构建失败。
const serverJs = readFileSync("dist/server.js", "utf-8")
if (
  serverJs.includes("React.createElement") ||
  serverJs.includes("./tui.js") ||
  /import\s[^;]*["']@opentui\//.test(serverJs)
) {
  console.error("✗ dist/server.js 引用了 TUI 代码图（./tui.js 或 @opentui）——server 入口必须保持纯空壳")
  process.exit(1)
}
if (!serverJs.includes('"opencode-tokenwatch"') || !serverJs.includes("setup")) {
  console.error("✗ dist/server.js 丢失了 v2 契约字段（id / setup）")
  process.exit(1)
}

console.log("✓ esbuild: dist/tui.js + dist/server.js")