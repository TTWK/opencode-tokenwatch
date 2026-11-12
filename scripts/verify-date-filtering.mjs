import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRoot } from "solid-js"

const here = dirname(fileURLToPath(import.meta.url))
const dist = pathToFileURL(join(here, "..", "dist", "tui.js")).href

// 切换 HOME 目录到临时隔离环境，防止污染与受真实环境影响
const testDir = join(tmpdir(), `tokenwatch-date-filter-${Math.random().toString(36).slice(2, 8)}`)
mkdirSync(join(testDir, ".opencode"), { recursive: true })
process.env.HOME = testDir
process.env.USERPROFILE = testDir

console.log("=== 开始时间过滤与 HTML 报告内部自洽性专项验证 ===")

// 构造模拟的真实时间戳
const now = new Date()
const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

const d4 = new Date(now)
d4.setDate(d4.getDate() - 4)
const d4Str = `${d4.getFullYear()}-${String(d4.getMonth() + 1).padStart(2, "0")}-${String(d4.getDate()).padStart(2, "0")}`

const d40 = new Date(now)
d40.setDate(d40.getDate() - 40)
const d40Str = `${d40.getFullYear()}-${String(d40.getMonth() + 1).padStart(2, "0")}-${String(d40.getDate()).padStart(2, "0")}`

const fakeSessions = [
  { id: "s_old", title: "Ancient Session", time: { created: d40.getTime() } },
  { id: "s_mid", title: "Mid Session 4d ago", time: { created: d4.getTime() } },
  { id: "s_today", title: "Today Session", time: { created: now.getTime() } },
]

const fakeMessages = {
  s_old: [
    {
      id: "m_old_1",
      role: "assistant",
      model: { providerID: "ancient-ai", id: "dinosaur-1.0" },
      time: { created: d40.getTime() },
      tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.01,
      finish: "stop",
    },
  ],
  s_mid: [
    {
      id: "m_mid_1",
      role: "assistant",
      model: { providerID: "mid-ai", id: "worker-3.5" },
      time: { created: d4.getTime() },
      tokens: { input: 4000, output: 1000, reasoning: 0, cache: { read: 500, write: 0 } },
      cost: 0.04,
      finish: "stop",
    },
    {
      id: "m_mid_fail",
      role: "assistant",
      model: { providerID: "mid-ai", id: "worker-3.5" },
      time: { created: d4.getTime() + 1000 },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      finish: "error",
    },
  ],
  s_today: [
    {
      id: "m_today_1",
      role: "assistant",
      model: { providerID: "today-ai", id: "speedy-4.0" },
      time: { created: now.getTime() },
      tokens: { input: 120000, output: 40000, reasoning: 0, cache: { read: 20000, write: 0 } },
      cost: 0.6,
      finish: "stop",
    },
    {
      id: "m_today_fail",
      role: "assistant",
      model: { providerID: "today-ai", id: "speedy-4.0" },
      time: { created: now.getTime() + 2000 },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      finish: "error",
    },
  ],
}

// 写入模拟的 tokenwatch.jsonl
const logLines = [
  JSON.stringify({
    ts: d40.toISOString(),
    model: "ancient-ai/dinosaur-1.0",
    providerID: "ancient-ai",
    modelID: "dinosaur-1.0",
    sessionID: "s_old",
    ttft_ms: 2000,
    tps: 30,
    latency_ms: 16666,
    active_ms: 16666,
    inputTokens: 1000,
    outputTokens: 500,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0.01,
  }),
  JSON.stringify({
    ts: d4.toISOString(),
    model: "mid-ai/worker-3.5",
    providerID: "mid-ai",
    modelID: "worker-3.5",
    sessionID: "s_mid",
    ttft_ms: 600,
    tps: 80,
    latency_ms: 12500,
    active_ms: 12500,
    inputTokens: 4000,
    outputTokens: 1000,
    reasoningTokens: 0,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
    cost: 0.04,
  }),
  JSON.stringify({
    ts: now.toISOString(),
    model: "today-ai/speedy-4.0",
    providerID: "today-ai",
    modelID: "speedy-4.0",
    sessionID: "s_today",
    ttft_ms: 250,
    tps: 180,
    latency_ms: 222,
    active_ms: 222,
    inputTokens: 120000,
    outputTokens: 40000,
    reasoningTokens: 0,
    cacheReadTokens: 20000,
    cacheWriteTokens: 0,
    cost: 0.6,
  }),
]
writeFileSync(join(testDir, ".opencode", "tokenwatch.jsonl"), logLines.join("\n") + "\n", "utf-8")

// 模拟 v2 宿主环境
function makeV2Mock() {
  const slotClaims = new Map()
  const layerCalls = []
  const selectCalls = []
  const selectAnswers = []
  const toasts = []

  const ctx = {
    app: { version: "2.0.0-beta-test", channel: "beta" },
    theme: {},
    themeMode: "dark",
    data: {
      on: () => () => {},
      session: { list: () => fakeSessions },
    },
    ui: {
      slot: (claim) => {
        slotClaims.set(claim.append, claim)
        return () => slotClaims.delete(claim.append)
      },
      toast: {
        show: (opts) => toasts.push(opts),
      },
      dialog: {
        select: async (spec) => {
          selectCalls.push(spec)
          return selectAnswers.length ? selectAnswers.shift() : undefined
        },
      },
    },
    client: {
      session: {
        list: async () => ({ data: fakeSessions, cursor: null }),
      },
      message: {
        list: async ({ sessionID }) => ({ data: fakeMessages[sessionID] ?? [], cursor: null }),
      },
    },
    keymap: {
      layer: (factory) => {
        layerCalls.push({ factory })
        return { dispose: () => {} }
      },
    },
    storage: {
      store(key, options) {
        const state = JSON.parse(JSON.stringify(options.initial))
        return [state, async (m) => { m(state) }]
      },
    },
  }

  return { ctx, slotClaims, layerCalls, selectCalls, selectAnswers, toasts }
}

const mod = await import(dist)
const { ctx, slotClaims, layerCalls, selectCalls, selectAnswers, toasts } = makeV2Mock()

const dispose = mod.default.setup(ctx)

// 挂载 prompt.footer 激活命令层
createRoot((d) => {
  slotClaims.get("prompt.footer").render({})
  d()
})

const layer = layerCalls[0]?.factory?.()
const cmd = layer?.commands?.[0]
assert.ok(cmd, "命令必须已注册")

// ── 测试 1: 生成 'today' HTML 报告 ──
console.log("\n[Test 1] 触发 /usage -> html -> today 生成 HTML 报告...")
// 模拟选择：第一级主菜单选 "html"，第二级时间范围选 "today"
selectAnswers.push("html")
selectAnswers.push("today")

await cmd.run()
// 等待扫描与文件生成
await new Promise((r) => setTimeout(r, 800))

const htmlToastToday = toasts.find((t) => t.variant === "success" && t.message.includes(".html") && t.message.includes("-today-"))
assert.ok(htmlToastToday, `必须成功生成今日报告文件，toasts: ${JSON.stringify(toasts)}`)

const filePathToday = htmlToastToday.message.split(": ").pop().trim()
console.log("  今日 HTML 报告路径:", filePathToday)
const htmlContentToday = readFileSync(filePathToday, "utf-8")

// 提取内嵌的完整 JSON 数据
const jsonMatch = htmlContentToday.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)
assert.ok(jsonMatch, "HTML 必须内嵌 report-data JSON")
const reportDataToday = JSON.parse(jsonMatch[1])

// 校验 1: 模型范围
const modelsToday = reportDataToday.models.map((m) => `${m.provider}/${m.model}`)
console.log("  今日报告模型列表:", modelsToday)
assert.deepEqual(modelsToday, ["today-ai/speedy-4.0"])
assert.ok(!modelsToday.includes("ancient-ai/dinosaur-1.0"), "40天前模型不得出现在今日报告中！")
assert.ok(!modelsToday.includes("mid-ai/worker-3.5"), "4天前模型不得出现在今日报告中！")

// 校验 2: 恒等式
const expectedTodayTokens = 120000 + 40000 + 20000 // 180,000
assert.equal(reportDataToday.summary.totalTokens, expectedTodayTokens, "summary.totalTokens 必须等于今日用量")
const sumModels = reportDataToday.models.reduce((acc, m) => acc + m.totalTokens, 0)
const sumProviders = reportDataToday.providers.reduce((acc, p) => acc + p.totalTokens, 0)
const sumDaily = reportDataToday.daily.reduce((acc, d) => acc + d.totalTokens, 0)
const sumSessions = reportDataToday.sessions.reduce((acc, s) => acc + s.totalTokens, 0)

assert.equal(sumModels, expectedTodayTokens, "Σ(models) 恒等")
assert.equal(sumProviders, expectedTodayTokens, "Σ(providers) 恒等")
assert.equal(sumDaily, expectedTodayTokens, "Σ(daily) 恒等")
assert.equal(sumSessions, expectedTodayTokens, "Σ(sessions) 恒等")

// 校验 3: 错误统计
assert.equal(reportDataToday.errors.failedCount, 1, "今日失败次数应为 1")
assert.equal(reportDataToday.errors.successCount, 1, "今日成功次数应为 1")
assert.equal(reportDataToday.errors.errorRate, 0.5, "今日错误率应为 50%")

// 校验 4: 性能指标与页面各图表严格收敛
const perfModelsToday = reportDataToday.perfSummary.map((p) => p.model)
console.log("  今日性能模型列表:", perfModelsToday)
assert.deepEqual(perfModelsToday, ["today-ai/speedy-4.0"], "性能数据只能包含今日活跃模型！")

// 页面 DOM 断言
assert.ok(htmlContentToday.includes(`TokenWatch Usage Report · ${todayStr} · generated`), "Meta 必须展示今日单日日期")
assert.ok(!htmlContentToday.includes("ancient-ai/dinosaur-1.0"), "页面中严禁泄漏历史模型 ancient-ai/dinosaur-1.0")
assert.ok(!htmlContentToday.includes("mid-ai/worker-3.5"), "页面中严禁泄漏历史模型 mid-ai/worker-3.5")
assert.ok(htmlContentToday.includes("id=\"model-chart\""), "柱状图即使总量 <1M 也必须正常展示")
assert.ok(!htmlContentToday.includes("No models with &ge;1M tokens"), "不得出现 1M 拦截提示")

console.log("PASS 1: 今日 HTML 报告完全收敛自洽！")

// ── 测试 2: 生成 '7d' HTML 报告 ──
console.log("\n[Test 2] 触发 /usage -> html -> 7d 生成 7 天 HTML 报告...")
selectAnswers.push("html")
selectAnswers.push("7d")

await cmd.run()
await new Promise((r) => setTimeout(r, 800))

const htmlToast7d = toasts.find((t) => t.variant === "success" && t.message.includes(".html") && t.message.includes("-7d-"))
assert.ok(htmlToast7d, `必须成功生成 7 天报告文件，toasts: ${JSON.stringify(toasts)}`)

const filePath7d = htmlToast7d.message.split(": ").pop().trim()
console.log("  7天 HTML 报告路径:", filePath7d)
const htmlContent7d = readFileSync(filePath7d, "utf-8")
const jsonMatch7d = htmlContent7d.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)
const reportData7d = JSON.parse(jsonMatch7d[1])

const models7d = reportData7d.models.map((m) => `${m.provider}/${m.model}`)
console.log("  7天内活跃模型:", models7d)
assert.ok(!models7d.includes("ancient-ai/dinosaur-1.0"), "40天前模型绝不能出现在 7 天报告中！")
assert.ok(models7d.includes("today-ai/speedy-4.0"))
assert.ok(models7d.includes("mid-ai/worker-3.5"))

// 恒等式校验
const midTokens = 4000 + 1000 + 500 // 5,500
const expected7dTokens = expectedTodayTokens + midTokens
assert.equal(reportData7d.summary.totalTokens, expected7dTokens, "7天 TotalTokens 必须精确对齐")
assert.equal(reportData7d.errors.failedCount, 2, "7天失败次数应为 2 (4天前1次 + 今天1次)")
assert.equal(reportData7d.errors.successCount, 2, "7天成功次数应为 2")
assert.equal(reportData7d.errors.errorRate, 0.5, "7天错误率应为 50%")

console.log("PASS 2: 7 天 HTML 报告完全收敛自洽！")

// 清理临时目录
try { rmSync(testDir, { recursive: true, force: true }) } catch {}

console.log("\nALL VERIFICATION TESTS COMPLETED SUCCESSFULLY! 🎉")
