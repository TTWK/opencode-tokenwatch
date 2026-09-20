/**
 * 双宿主冒烟测试：用 mock 宿主对象真实执行 dist 包的两个入口。
 *
 * v1 路径：default.tui(api) —— 模拟 TuiPluginApi
 * v2 路径：default.setup(ctx) —— 模拟 v2 Plugin Context（契约与 beta SDK 一致）
 *
 * 断言：两个入口完整执行、注册了预期的 slot/command/事件订阅，且互不干扰。
 */
import plugin from "../dist/tui.js"
import assert from "node:assert"

// ───────────────────────── v1 mock ─────────────────────────
const v1Events = new Map()
const v1Registered = { commands: 0, slots: [], unsubs: 0 }

const v1api = {
  app: { version: "1.18.25" },
  theme: { current: { primary: "#fff", text: "#eee", textMuted: "#888", background: "#000", border: "#333", success: "#0f0", warning: "#ff0", error: "#f00" } },
  kv: {
    store: new Map(),
    get(k) { return this.store.get(k) },
    set(k, v) { this.store.set(k, v) },
  },
  event: {
    on(type, handler) {
      v1Events.set(type, handler)
      return () => { v1Registered.unsubs++ }
    },
  },
  state: {
    config: {},
    session: { messages: () => [] },
    part: () => [],
  },
  slots: {
    register(reg) { v1Registered.slots.push(reg) },
  },
  command: {
    register(fn) {
      const cmds = fn()
      v1Registered.commands = cmds.length
      assert.equal(cmds[0].slash.name, "usage", "v1 /usage slash command")
      return () => {}
    },
  },
  ui: { toast: () => {} },
  lifecycle: { onDispose(fn) { /* record */ } },
}

await plugin.tui(v1api)

assert.equal(v1Registered.commands, 1, "v1: usage command registered")
assert.equal(v1Registered.slots.length, 1, "v1: slot registered")
assert.ok(v1Registered.slots[0].slots.sidebar_content, "v1: sidebar_content slot")
assert.ok(v1Events.has("message.updated"), "v1: message.updated subscribed")
assert.ok(v1Events.has("message.part.updated"), "v1: message.part.updated subscribed")
assert.ok(v1Events.has("message.removed"), "v1: message.removed subscribed")

// 模拟一条 assistant 消息更新 → 应写入 kv 持久化。
// 注意：KV 写经 500ms 尾沿节流（审查 #6），需等待节流窗口后再断言。
v1Events.get("message.updated")({
  properties: {
    info: {
      id: "msg-1", sessionID: "ses-1", role: "assistant",
      providerID: "anthropic", modelID: "claude",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 30, write: 0 }, total: 180 },
      cost: 0.01,
      time: { created: 1000, completed: 2000 },
    },
  },
})
await new Promise((r) => setTimeout(r, 700))
const persisted = v1api.kv.get("tokenwatch-msgs-ses-1")
assert.ok(Array.isArray(persisted) && persisted[0]?.inputTokens === 100, "v1: message persisted to kv (after 500ms persist throttle)")
console.log("v1 tui(): OK  (commands=%d, slots=%d, events=%d)",
  v1Registered.commands, v1Registered.slots.length, v1Events.size)

// ───────────────────────── v2 mock ─────────────────────────
const v2Events = new Map()
const v2Registered = { slots: [], layer: null, storageInit: false }

const v2ctx = {
  app: { version: "0.0.0-beta-18743", channel: "beta" },
  theme: {
    text: { default: "#fff", subdued: "#888", action: { primary: { default: "#7aa" } } },
    background: { default: "#000" },
    border: { default: "#333" },
    textfeedback: undefined,
    text: { default: "#fff", subdued: "#888" },
  },
  themeMode: "dark",
  data: {
    on(type, handler) {
      v2Events.set(type, handler)
      return () => {}
    },
    session: {
      list: () => [{ id: "ses-1", title: "t", time: { created: 1 } }],
      get: () => undefined,
      sync: async () => {},
      message: {
        list: (sid) => sid === "ses-1" ? [{
          id: "msg-1", type: "assistant", role: "assistant",
          model: { providerID: "anthropic", id: "claude" },
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 30, write: 0 } },
          cost: 0.01, time: { created: 1000, completed: 2000 },
          finish: "stop",
        }] : [],
        get: () => undefined,
        sync: async () => {},
        invalidate: () => {},
      },
    },
    location: { agent: { list: () => [] } },
  },
  ui: {
    slot(claim) {
      v2Registered.slots.push(claim)
      // 模拟宿主挂载：prompt.footer 载体插槽的 render 触发 keymap layer 安装。
      // 真实宿主在 setup() 返回后才挂载插槽，故用微任务推迟，保证注册先于挂载。
      if (claim.append === "prompt.footer") {
        queueMicrotask(() => { try { claim.render?.() } catch { } })
      }
      return () => { }
    },
    toast: { show: () => {} },
    dialog: {
      alert: async () => {},
      select: async (o) => o.options[0]?.value,
    },
  },
  keymap: {
    layer(input) { v2Registered.layer = input() },
  },
  storage: {
    store(key, opts) {
      v2Registered.storageInit = true
      assert.equal(key, "tokenwatch", "v2: storage key")
      let state = { values: {} }
      return [{ get values() { return state.values } }, async (m) => { m(state); }]
    },
  },
  client: {},
}

const cleanup = plugin.setup(v2ctx)

// 等待载体插槽的挂载渲染（微任务）完成，再断言 layer 安装结果
await new Promise((r) => setImmediate(r))

assert.ok(v2Registered.slots.length === 2, "v2: ui.slot registered (panel + keymap vehicle)")
const panelSlot = v2Registered.slots.find((s) => s.append === "sidebar.content")
const vehicleSlot = v2Registered.slots.find((s) => s.append === "prompt.footer")
assert.ok(panelSlot, "v2: slot target sidebar.content")
assert.ok(vehicleSlot, "v2: prompt.footer vehicle slot (keymap mount carrier)")
assert.ok(v2Registered.layer, "v2: keymap.layer installed")
assert.equal(v2Registered.layer.mode, "global", "v2: layer mode global")
const v2cmd = v2Registered.layer.commands[0]
assert.equal(v2cmd.id, "tokenwatch.usage", "v2: command id")
assert.deepEqual(v2cmd.slash, { name: "usage" }, "v2: /usage slash")
assert.ok(v2Registered.storageInit === false, "v2: storage lazy (not touched during setup)")
assert.ok(v2Events.has("session.step.ended"), "v2: session.step.ended subscribed")
assert.ok(v2Events.has("session.text.started"), "v2: session.text.started subscribed")

// 模拟 step.ended → 应走归一化 + 持久化路径
v2Events.get("session.step.ended")({
  data: {
    sessionID: "ses-1", assistantMessageID: "msg-1",
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 30, write: 0 } },
    cost: 0.01, finish: "stop",
  },
})
console.log("v2 setup(): OK  (slots=%d, layer=%s, events=%d)",
  v2Registered.slots.length, v2Registered.layer.commands[0].id, v2Events.size)

// v1 校验器鸭子类型模拟：v1 readV1Plugin 接受 { id, tui, setup }（多余字段忽略）
assert.equal(typeof plugin.id, "string" && plugin.id.length > 0 ? "string" : "fail", "id non-empty string")
assert.equal(typeof plugin.tui, "function")
assert.ok(!("server" in plugin), "v1 约束：tui 模块不得携带 server")
console.log("contract checks: OK")

if (typeof cleanup === "function") cleanup()
console.log("\nALL SMOKE TESTS PASSED")
