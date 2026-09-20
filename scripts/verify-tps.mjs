// TPS 口径回归：模拟 opencode2 事件序列（step → reasoning → text → step.ended），
// 断言插件 TPS 与宿主官方口径 output/(time.streamed - time.created) 一致，
// 且 TTFT = 首个可见输出 part（reasoning）- step 起点。
//
// USERPROFILE 重定向到临时目录，避免污染真实的 tokenwatch.jsonl / stats。
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const fakeHome = mkdtempSync(join(tmpdir(), "tokenwatch-tps-"))
mkdirSync(join(fakeHome, ".opencode"), { recursive: true })
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const results = []
const check = (name, cond, extra = "") => {
  results.push(cond)
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  -- " + extra : ""}`)
}

const dist = new URL("../dist/tui.js", import.meta.url).href
const mod = await import(dist)

const MSG_ID = "msg_tp"
const SESSION_ID = "ses_tp"
// 消息：step 1000 开始；reasoning 首 token 1200；text 首 token 2500；
// 响应体接收完 4000；step 收尾 4100。可见输出 810 tokens。
const canned = {
  id: MSG_ID,
  sessionID: SESSION_ID,
  type: "assistant",
  role: "assistant",
  model: { id: "mimo-v2.5", providerID: "huoshan" },
  tokens: { input: 50, output: 810, reasoning: 2000, cache: { read: 0, write: 0 } },
  cost: 0.1,
  time: { created: 1000, streamed: 4000, completed: 4100 },
}

const handlersRef = { current: undefined }
const emit = (type, envelope) => {
  const h = handlersRef.current?.get(type)
  if (!h) throw new Error(`no handler for ${type}`)
  h(envelope)
}

const ctx = {
  app: { version: "2.0.0-beta-test", channel: "beta" },
  theme: {},
  themeMode: "dark",
  data: {
    on(type, handler) {
      const map = (handlersRef.current ??= new Map())
      map.set(type, handler)
      return () => map.delete(type)
    },
    session: {
      list: () => [],
      get: () => undefined,
      sync: async () => {},
      message: {
        list: () => [],
        get: (_s, id) => (id === MSG_ID ? canned : undefined),
        sync: async () => {},
        invalidate: () => {},
      },
    },
    location: { agent: { list: () => [] } },
  },
  ui: {
    slot: () => () => {},
    toast: { show: () => {} },
    dialog: { alert: async () => {}, select: async () => undefined },
  },
  keymap: { layer: () => {} },
  storage: {
    store(_key, options) {
      const state = JSON.parse(JSON.stringify(options.initial))
      return [state, async (m) => { m(state) }]
    },
  },
  client: {},
}

const dispose = mod.default.setup(ctx)

const env = (created, data) => ({ id: "evt", created, data })

// 事件时序（推理模型：reasoning 先行；started 为占位符打开 ≈ step 起点，
// 首个 delta 才是真实"首 token"时刻）
emit("session.step.started", env(1000, { sessionID: SESSION_ID, assistantMessageID: MSG_ID }))
emit("session.reasoning.started", env(1050, { sessionID: SESSION_ID, assistantMessageID: MSG_ID }))
emit("session.reasoning.delta", env(1200, { sessionID: SESSION_ID, assistantMessageID: MSG_ID, delta: "…" }))
emit("session.text.started", env(2500, { sessionID: SESSION_ID, assistantMessageID: MSG_ID }))
emit("session.text.delta", env(2600, { sessionID: SESSION_ID, assistantMessageID: MSG_ID, delta: "o" }))
emit("session.step.ended", env(4100, {
  sessionID: SESSION_ID,
  assistantMessageID: MSG_ID,
  finish: "stop",
  cost: 0.1,
  tokens: canned.tokens,
}))

const logPath = join(fakeHome, ".opencode", "tokenwatch.jsonl")
if (!existsSync(logPath)) {
  check("TPS 日志已写入", false, logPath)
} else {
  const entry = JSON.parse(readFileSync(logPath, "utf-8").trim().split("\n").at(-1))
  const expectedTps = (810 / (4000 - 1000)) * 1000 // 270 —— 宿主官方口径（窗口起点=step 开始）
  const ttftExpected = 1200 - 1000 // 首个 reasoning delta - step 开始 = 200ms
  const oldBuggyTps = (810 / (4100 - 2500)) * 1000 // 506.25 —— 旧口径（剔除 reasoning）
  check("TPS 日志已写入", true)
  check("TPS 对齐宿主官方口径（≈270）", Math.abs(entry.tps - expectedTps) < 0.5, `tps=${entry.tps?.toFixed(1)} expect=${expectedTps}（旧口径应为 ${oldBuggyTps.toFixed(1)}）`)
  check("TPS 不再虚高（远离旧口径 506）", Math.abs(entry.tps - oldBuggyTps) > 100, `diff=${Math.abs(entry.tps - oldBuggyTps).toFixed(1)}`)
  check("TTFT = 首个 delta(reasoning@1200) - step起点(1000) = 200ms", entry.ttft_ms === ttftExpected, `ttft=${entry.ttft_ms}（part 占位符打开@1050 不应计入）`)
  check("outputTokens 只计可见输出（不含 reasoning）", entry.outputTokens === 810 && entry.reasoningTokens === 2000)
}

dispose()
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
