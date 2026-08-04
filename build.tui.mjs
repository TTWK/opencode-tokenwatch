import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

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
  // Server module - no JSX
  build({
    ...common,
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
  }),
])

console.log("✓ esbuild: dist/tui.js + dist/server.js")