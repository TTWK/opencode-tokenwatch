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
  // Server module - no JSX.
  // ./tui.js 必须保持 external：若被 bundle 进来，esbuild 会把整个 TUI 代码图
  // （含未走 solidPlugin 的 .tsx JSX，回退 classic transform 生成未导入的
  // React.createElement）内联进 server.js，并把 @opentui/solid-js 导入提升到
  // 文件顶部 —— server 进程的惰性加载设计即被破坏。
  // external 后产物保留 import("./tui.js")，运行时才解析 dist/tui.js。
  build({
    ...common,
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
    external: [...external, "./tui.js"],
  }),
])

// ── 产物断言：防止 server.js 再次吞下 TUI 代码图（曾因未加 external 而发生过） ──
const serverJs = readFileSync("dist/server.js", "utf-8")
if (serverJs.includes("React.createElement") || /import\s[^;]*["@']@opentui\//.test(serverJs)) {
  console.error("✗ dist/server.js 泄漏了 TUI 代码图（React.createElement 或 @opentui 静态导入）——惰性加载已失效")
  process.exit(1)
}
if (!serverJs.includes('import("./tui.js")')) {
  console.error('✗ dist/server.js 丢失了对 ./tui.js 的动态 import')
  process.exit(1)
}

console.log("✓ esbuild: dist/tui.js + dist/server.js")