// TPS 口径回归：模拟 opencode2 事件序列，验证真实 dist/tui.js：
// 1. 单步 TPS = (output + reasoning) / (streamed - created)
// 2. TTFT 使用首个 delta，latency 独立使用 completed - created
// 3. 会话平均 TPS = Σ(output + reasoning) / ΣactiveMs，而非单步 TPS 算术平均
// 4. 复现 1472 tokens / 1129ms = 1303.8 的异常样本，修正后为 107.5；
//    同一轮 19 个 steps 的官方加权结果为 75.3。
//
// USERPROFILE/HOME 重定向到临时目录，避免污染真实 JSONL / stats。
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"

const fakeHome = mkdtempSync(join(tmpdir(), "tokenwatch-tps-"))
mkdirSync(join(fakeHome, ".opencode"), { recursive: true })
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const results = []
const check = (name, cond, extra = "") => {
  results.push(!!cond)
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  -- " + extra : ""}`)
}
const near = (actual, expected, tolerance = 0.05) =>
  Math.abs(actual - expected) <= tolerance

const dist = new URL("../dist/tui.js", import.meta.url).href
const mod = await import(dist)

const MSG_ID = "msg_tp"
const SESSION_ID = "ses_tp"
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
const messages = new Map([[MSG_ID, canned]])
const handlersRef = { current: undefined }
const emit = (type, envelope) => {
  const h = handlersRef.current?.get(type)
  if (!h) throw new Error(`no handler for ${type}`)
  h(envelope)
}

const ctx = {
  app: { version: "2.2.6-test", channel: "beta" },
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
        get: (_s, id) => messages.get(id),
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

// step@1000；首个 reasoning delta@1200；text delta@2600；
// streamed@4000；completed@4100。官方单步分子为 810+2000。
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
check("TPS 日志已写入", existsSync(logPath), logPath)
if (existsSync(logPath)) {
  const entry = JSON.parse(readFileSync(logPath, "utf-8").trim().split("\n").at(-1))
  const expectedTps = ((810 + 2000) / (4000 - 1000)) * 1000 // 936.7
  check(
    "单步 TPS 包含 output+reasoning 且窗口为 created→streamed",
    near(entry.tps, expectedTps) && entry.active_ms === 3000,
    `tps=${entry.tps?.toFixed(1)} active_ms=${entry.active_ms} expect=${expectedTps.toFixed(1)}`,
  )
  check(
    "latency 独立于 TPS，保留 completed→streamed 收尾时间",
    entry.latency_ms === 3100,
    `latency_ms=${entry.latency_ms} expect=3100`,
  )
  check(
    "TTFT 仍取首个 reasoning delta，不取占位符打开事件",
    entry.ttft_ms === 200,
    `ttft_ms=${entry.ttft_ms} expect=200`,
  )
  check(
    "原始 output/reasoning 字段不被合并覆盖",
    entry.outputTokens === 810 && entry.reasoningTokens === 2000,
  )
}

// 来自真实异常会话的 19 个 steps：[output, reasoning, streamed-created]。
// 总分子 10366，总分母 137575ms，官方整轮 TPS = 75.346…。
const SESSION2 = "ses_weighted"
const MODEL2 = { id: "deepseek-v4-flash-free", providerID: "opencode" }
const steps = [
  [136, 101, 2146], [187, 0, 11685], [219, 0, 5458],
  [484, 0, 35925], [522, 0, 3684], [114, 408, 4497],
  [338, 0, 2091], [219, 0, 1735], [200, 221, 3432],
  [209, 0, 5374], [501, 0, 3057], [1472, 0, 13687],
  [618, 0, 6572], [893, 0, 7689], [150, 0, 730],
  [137, 891, 9398], [149, 442, 5069], [84, 35, 1140],
  [1636, 0, 14206],
]
for (let i = 0; i < steps.length; i++) {
  const [output, reasoning, activeMs] = steps[i]
  const id = `msg_weighted_${i}`
  const created = 100000 + i * 200000
  const tokens = { input: 1, output, reasoning, cache: { read: 0, write: 0 } }
  messages.set(id, {
    id,
    sessionID: SESSION2,
    type: "assistant",
    model: MODEL2,
    tokens,
    cost: 0,
    time: { created, streamed: created + activeMs, completed: created + activeMs + 100 },
  })
  // 故意不发 step.started / delta：TPS 必须只依赖完成消息中的可靠时间。
  emit("session.step.ended", env(created + activeMs + 100, {
    sessionID: SESSION2,
    assistantMessageID: id,
    finish: "stop",
    cost: 0,
    tokens,
  }))
}

const entries = readFileSync(logPath, "utf-8").trim().split("\n").map(JSON.parse)
const weightedEntries = entries.filter((e) => e.sessionID === SESSION2)
const formerSpike = weightedEntries[11]
check("19 个无 part 锚点的 steps 均产生有效 TPS", weightedEntries.length === 19 && weightedEntries.every((e) => e.tps != null))
check(
  "1303.8 异常单步修正为 107.5",
  near(formerSpike.tps, 1472 / 13.687) && formerSpike.active_ms === 13687,
  `tps=${formerSpike.tps?.toFixed(1)} active_ms=${formerSpike.active_ms}`,
)

// 等待 store 的 1 秒合并落盘，检查侧边栏/报告共用的 accumulator。
await new Promise((resolve) => setTimeout(resolve, 1200))
const statsPath = join(fakeHome, ".opencode", "tokenwatch-stats.json")
check("加权统计已落盘", existsSync(statsPath), statsPath)
if (existsSync(statsPath)) {
  const stats = JSON.parse(readFileSync(statsPath, "utf-8"))
  const model = stats.models["opencode/deepseek-v4-flash-free"]
  const expected = 10366 / 137.575
  const arithmeticMean = weightedEntries.reduce((sum, e) => sum + e.tps, 0) / weightedEntries.length
  check(
    "会话 TPS 按活跃耗时加权为 75.3",
    model && near(model.avgTPS, expected),
    `avgTPS=${model?.avgTPS?.toFixed(1)} expect=${expected.toFixed(1)}`,
  )
  check(
    "加权分子/分母完整累计全部 19 步",
    model?.totalTpsTokens === 10366 && model?.totalTpsMs === 137575 && model?.tpsCount === 19,
    `tokens=${model?.totalTpsTokens} ms=${model?.totalTpsMs} count=${model?.tpsCount}`,
  )
  check(
    "会话值不再退化为单步 TPS 算术平均",
    model && Math.abs(model.avgTPS - arithmeticMean) > 20,
    `weighted=${model?.avgTPS?.toFixed(1)} arithmetic=${arithmeticMean.toFixed(1)}`,
  )
}

// 旧版 JSONL 没有 active_ms，且旧 tps 可能是错误口径。会话重放必须用
// latency_ms（v2 即 streamed-created）与 output+reasoning 重算，而不是沿用旧 tps。
{
  const aggregatePath = join(fakeHome, ".opencode", "perf-aggregate-test.mjs")
  await build({
    entryPoints: ["src/kernel/perf-aggregate.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: aggregatePath,
    logLevel: "silent",
  })
  const { accumulateEntry, createAccumulator, finalizeAccumulator } =
    await import(pathToFileURL(aggregatePath).href)
  const legacyAcc = createAccumulator("opencode/deepseek-v4-flash-free", "opencode")
  for (let i = 0; i < steps.length; i++) {
    const [output, reasoning, latencyMs] = steps[i]
    accumulateEntry(legacyAcc, {
      ts: new Date(1000 + i).toISOString(),
      model: "opencode/deepseek-v4-flash-free",
      providerID: "opencode",
      modelID: "deepseek-v4-flash-free",
      sessionID: SESSION2,
      ttft_ms: null,
      tps: 9999, // 旧错误值必须被忽略
      latency_ms: latencyMs,
      inputTokens: 1,
      outputTokens: output,
      reasoningTokens: reasoning,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    })
  }
  const legacyStats = finalizeAccumulator(legacyAcc)
  check(
    "旧 JSONL 重放时忽略旧 tps 并重算为 75.3",
    near(legacyStats.avgTPS, 10366 / 137.575),
    `avgTPS=${legacyStats.avgTPS?.toFixed(1)}`,
  )
  check(
    "旧 JSONL 重放完整累计加权分子/分母",
    legacyStats.totalTpsTokens === 10366 && legacyStats.totalTpsMs === 137575,
    `tokens=${legacyStats.totalTpsTokens} ms=${legacyStats.totalTpsMs}`,
  )
}

dispose()
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
