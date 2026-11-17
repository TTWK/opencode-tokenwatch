/**
 * verify-full-audit-fixes.mjs
 *
 * 针对 2026-11-13 代码审查报告中确认的全部问题进行防回归端到端验证：
 * 1. P0-1: Server 与 TUI 双写消除与跨进程 ID 去重（同一消息 stats 严禁翻倍）
 * 2. P0-2: 跨会话消息污染阻断（迟到事件不混入前台会话信号，安全落盘自身 KV）
 * 3. P0-3: 失败统计与非零 Token 用量口径统一（finish=error 判失败，非零 Token 保留用量）
 * 4. P1-8: 缺 delta 时 TTFT 诚实为 null，绝不伪造 0ms
 * 5. P1-9 & P1-11: HTML 报告取消 Top 15 截断，对比图堆叠补全 Reasoning + CacheWrite
 */

import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const testHome = mkdtempSync(join(tmpdir(), "tokenwatch-audit-fix-"))
mkdirSync(join(testHome, ".opencode"), { recursive: true })
process.env.HOME = testHome
process.env.USERPROFILE = testHome

// 导入编译后的真实产物
const tuiModule = (await import("../dist/tui.js")).default
const serverModule = (await import("../dist/server.js")).default
const { readPersistedStats, createPerfTracker, getWindowPerfStats } = await import("../dist/server.js")

console.log("=== 开始执行审查修复全量防回归验证套件 ===")

// ─────────────────────────────────────────────────────────────
// 辅助函数：构造真实的 v1 Plugin API（驱动 runtime.tsx 纯逻辑）
// ─────────────────────────────────────────────────────────────
function createMockV1Api() {
  const eventHandlers = new Map()
  const storageMap = new Map()
  let sidebarRenderFn = null

  const emit = (event, data) => {
    const list = eventHandlers.get(event) || []
    for (const fn of list) {
      fn(data)
    }
  }

  const api = {
    event: {
      on: (ev, handler) => {
        const list = eventHandlers.get(ev) || []
        list.push(handler)
        eventHandlers.set(ev, list)
        return () => {
          const idx = list.indexOf(handler)
          if (idx >= 0) list.splice(idx, 1)
        }
      },
    },
    state: {
      session: { messages: () => [] },
      part: () => [],
      config: undefined,
    },
    kv: {
      get: (k, fallback) => (storageMap.has(k) ? storageMap.get(k) : fallback),
      set: (k, v) => storageMap.set(k, v),
      delete: (k) => storageMap.delete(k),
    },
    slots: {
      register: (slots) => {
        if (slots.sidebar_content) {
          sidebarRenderFn = slots.sidebar_content
        }
      },
    },
    command: {
      register: () => {},
    },
  }

  return { api, emit, storageMap, getSidebarRenderFn: () => sidebarRenderFn }
}

// ─────────────────────────────────────────────────────────────
// 1. P0-1 验证：Server 与 TUI 订阅同一事件总线，严禁双写翻倍
// ─────────────────────────────────────────────────────────────
{
  const LOG_PATH = join(testHome, ".opencode", "tokenwatch.jsonl")

  const serverHandlers = new Map()
  const mockServerCtx = {
    data: {
      on: (ev, fn) => {
        serverHandlers.set(ev, fn)
        return () => serverHandlers.delete(ev)
      },
    },
  }
  const serverDispose = await serverModule.setup(mockServerCtx)

  const { api: tuiApi, emit: emitTui } = createMockV1Api()
  tuiModule.tui(tuiApi)

  const msgId = "msg-p0-1-shared"
  const t0 = 2000000

  // 1. 发 part.updated (首 token delta)
  serverHandlers.get("message.part.delta")?.({
    type: "message.part.delta",
    data: { messageID: msgId, timestamp: t0 + 200 },
  })
  emitTui("message.part.updated", {
    messageID: msgId,
    type: "text",
    time: { start: t0 + 200 },
  })

  // 2. 同时向 Server 和 TUI 派发相同的 message.updated 事件
  const sharedMsgEvent = {
    id: msgId,
    sessionID: "session-p0-1",
    role: "assistant",
    model: { providerID: "anthropic", id: "claude-3-7-sonnet" },
    providerID: "anthropic",
    modelID: "claude-3-7-sonnet",
    tokens: {
      input: 600,
      output: 100,
      reasoning: 50,
      cache: { read: 300, write: 40 },
    },
    cost: 0.02,
    time: { created: t0, streamed: t0 + 1500, completed: t0 + 1600 },
  }

  serverHandlers.get("message.updated")?.({
    type: "message.updated",
    data: { info: sharedMsgEvent },
  })

  emitTui("message.updated", {
    info: sharedMsgEvent,
  })

  // 等待持久化文件写入
  await new Promise((r) => setTimeout(r, 1200))

  assert.ok(existsSync(LOG_PATH), "tokenwatch.jsonl 必须存在")
  const logLines = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean)
  assert.equal(logLines.length, 1, `同一消息在跨进程环境下必须幂等去重（实际写入 ${logLines.length} 行，期望 1 行）`)

  const stats = readPersistedStats()
  const modelStat = stats.find((s) => s.model === "anthropic/claude-3-7-sonnet")
  assert.ok(modelStat, "stats 中必须包含该模型")
  assert.equal(modelStat.requestCount, 1, `请求数绝不翻倍，实际 requestCount=${modelStat.requestCount} 期望 1`)
  assert.equal(modelStat.totalInput, 600, `输入 Token 不翻倍，实际=${modelStat.totalInput} 期望 600`)

  serverDispose?.()
  console.log("PASS P0-1: Server 与 TUI 跨进程消息幂等去重生效，stats 绝无翻倍！")
}

// ─────────────────────────────────────────────────────────────
// 2. P0-2 验证：跨会话消息污染阻断
// ─────────────────────────────────────────────────────────────
{
  const { api, emit, storageMap } = createMockV1Api()
  tuiModule.tui(api)

  // 1. 会话 1 收到消息 m1
  emit("message.updated", {
    info: {
      id: "m1",
      sessionID: "session-1",
      role: "assistant",
      providerID: "p1",
      modelID: "model-1",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.001,
      time: { created: 1000, streamed: 2000, completed: 2100 },
    },
  })

  // 2. 会话 2 收到消息 m2
  emit("message.updated", {
    info: {
      id: "m2",
      sessionID: "session-2",
      role: "assistant",
      providerID: "p2",
      modelID: "model-2",
      tokens: { input: 200, output: 80, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.002,
      time: { created: 3000, streamed: 4000, completed: 4100 },
    },
  })

  // 3. 产生会话 1 的迟到事件 late-m1
  emit("message.updated", {
    info: {
      id: "late-m1",
      sessionID: "session-1",
      role: "assistant",
      providerID: "p1",
      modelID: "model-1",
      tokens: { input: 300, output: 60, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.003,
      time: { created: 5000, streamed: 6000, completed: 6100 },
    },
  })

  // 等待节流刷盘
  await new Promise((r) => setTimeout(r, 600))

  // 验证 Session 2 的存储中绝对没有 Session 1 的消息
  const s2Msgs = storageMap.get("tokenwatch-msgs-session-2") || []
  assert.ok(s2Msgs.every((m) => m.sessionID === "session-2"), "Session 2 缓存中严禁混入 Session 1 的迟到消息")
  assert.equal(s2Msgs.length, 1, "Session 2 消息数严格为 1")
  assert.equal(s2Msgs[0].id, "m2")

  // 验证 Session 1 的存储中包含自身的更新
  const s1Msgs = storageMap.get("tokenwatch-msgs-session-1") || []
  assert.ok(s1Msgs.some((m) => m.id === "late-m1"), "Session 1 自身的迟到消息必须安全落盘自身 KV")

  // 验证跨会话性能统计隔离：切换到 session-2 后，迟到的 session-1 事件不污染前台内存 stats
  const tracker = createPerfTracker({ persistLog: false })
  await tracker.loadSession("session-2")
  tracker.handleMessageUpdated({
    properties: {
      info: {
        id: "late-s1-msg",
        sessionID: "session-1",
        role: "assistant",
        providerID: "p-late",
        modelID: "m-late",
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.001,
        time: { created: 1000, streamed: 2000, completed: 2100 },
      },
    },
  })
  tracker.handleMessageUpdated({
    properties: {
      info: {
        id: "missing-session-id-msg",
        sessionID: "",
        role: "assistant",
        providerID: "p-current",
        modelID: "m-current",
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.001,
        time: { created: 3000, streamed: 4000, completed: 4100 },
      },
    },
  })
  const s2Stats = tracker.getSessionStats()
  assert.equal(s2Stats.models["p-late/m-late"], undefined, "前台会话 session-2 绝不混入 session-1 的迟到性能统计")
  assert.equal(s2Stats.models["p-current/m-current"]?.requestCount, 1, "缺失 sessionID 的事件必须按当前前台会话兜底，不得丢失性能样本")

  console.log("PASS P0-2: 跨会话消息污染彻底阻断，各会话缓存与内存性能严格隔离！")
}

// ─────────────────────────────────────────────────────────────
// 3. P0-3 & P1-9 & P1-11 验证：黑盒端到端 /usage 报告导出
// ─────────────────────────────────────────────────────────────
{
  const slotClaims = new Map()
  let keymapRun = null
  const toasts = []

  // 构造包含 18 个模型的会话与消息数据（包含非零 token 的 error 消息）
  const fakeSessions = []
  const fakeMessagesBySession = {}

  for (let i = 1; i <= 18; i++) {
    const sId = `session-${i}`
    fakeSessions.push({
      id: sId,
      title: `Session ${i}`,
      time: { created: Date.now() - i * 1000 },
    })

    fakeMessagesBySession[sId] = [
      {
        id: `m-normal-${i}`,
        type: "assistant",
        finish: "stop",
        model: { providerID: "test-prov", id: `model-${i}` },
        tokens: {
          input: i * 20,
          output: i * 20,
          reasoning: i * 20,
          cache: { read: i * 20, write: i * 10 },
        },
        cost: 0.001 * i,
        time: { created: Date.now() - 500 },
      },
      // 其中一个模型带有 finish="error"，但具有非零 Token
      ...(i === 1 ? [{
        id: "m-err-with-tokens",
        type: "assistant",
        finish: "error",
        model: { providerID: "test-prov", id: "model-1" },
        tokens: {
          input: 100,
          output: 50,
          reasoning: 10,
          cache: { read: 20, write: 5 },
        },
        cost: 0.005,
        time: { created: Date.now() - 400 },
      }] : []),
      // 无 tokens 对象的真实失败消息（网络/鉴权直接中断）
      ...(i === 2 ? [{
        id: "m-err-without-tokens",
        type: "assistant",
        finish: "error",
        error: { message: "Connection refused" },
        model: { providerID: "test-prov", id: "model-2" },
        time: { created: Date.now() - 350 },
      }] : []),
      // 正常空响应不是失败；进行中消息不参与成功/失败统计
      ...(i === 2 ? [
        {
          id: "m-empty-stop",
          type: "assistant",
          finish: "stop",
          model: { providerID: "test-prov", id: "model-2" },
          time: { created: Date.now() - 340, completed: Date.now() - 330 },
        },
        {
          id: "m-in-progress",
          type: "assistant",
          model: { providerID: "test-prov", id: "model-2" },
          time: { created: Date.now() - 320 },
        },
      ] : []),
      // 缺少错误状态的历史完成消息保留零 Token 失败兜底
      ...(i === 2 ? [{
        id: "m-zero-token-completed-fallback",
        type: "assistant",
        model: { providerID: "test-prov", id: "model-2" },
        time: { created: Date.now() - 310, completed: Date.now() - 300 },
      }] : []),
    ]
  }

  const v2Ctx = {
    app: { version: "2.0.0-beta", channel: "beta" },
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
        show: (opts) => { toasts.push(opts.message) },
      },
      dialog: {
        select: async (spec) => {
          if (spec.options.some((o) => o.value === "html")) return "html"
          if (spec.options.some((o) => o.value === "all")) return "all"
          return undefined
        },
      },
    },
    storage: {
      store: () => {
        const state = { values: {} }
        return [state, async (m) => m(state)]
      },
    },
    keymap: {
      layer: (claim) => {
        const layer = typeof claim === "function" ? claim() : claim
        keymapRun = layer?.commands?.[0]?.run
      },
    },
    client: {
      session: {
        list: async () => ({ data: fakeSessions, cursor: null }),
      },
      message: {
        list: async ({ sessionID }) => ({
          data: fakeMessagesBySession[sessionID] || [],
          cursor: null,
        }),
      },
    },
  }

  const dispose = await tuiModule.setup(v2Ctx)

  // 挂载 prompt.footer 插槽以激活 keymap.layer（不挂载无 renderer 的 sidebar）
  const footerSlot = slotClaims.get("prompt.footer")
  assert.ok(footerSlot, "prompt.footer 插槽必须注册")
  footerSlot.render({})

  assert.ok(keymapRun, "keymap.layer 的 run 必须就绪")

  // 执行 /usage 导出 HTML
  await keymapRun()
  // 等待后台异步全量扫描与 HTML 生成落盘
  let htmlToast = null
  for (let i = 0; i < 40; i++) {
    htmlToast = toasts.find((m) => m && m.includes(".html"))
    if (htmlToast) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(htmlToast, `应该弹出包含 HTML 路径的 toast 提示，当前全部 toasts: ${JSON.stringify(toasts)}`)

  // 读取生成的 HTML 文件
  const htmlPathMatch = htmlToast.match(/([A-Z]:\\[^\s]+\.html|\/[^\s]+\.html)/)
  assert.ok(htmlPathMatch, `Toast 中应包含 HTML 文件路径: ${htmlToast}`)
  const htmlPath = htmlPathMatch[1]
  assert.ok(existsSync(htmlPath), "HTML 报告必须存在于磁盘")

  const htmlContent = readFileSync(htmlPath, "utf-8")

  // 精确验证失败边界：2 个显式 error + 1 个完成态零 Token 兜底；
  // 18 个正常请求 + 1 个正常空响应计成功，进行中消息完全不计入。
  const reportMatch = htmlContent.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)
  assert.ok(reportMatch, "HTML 必须内嵌 report-data JSON")
  const reportData = JSON.parse(reportMatch[1])
  assert.equal(reportData.errors.failedCount, 3, "失败数必须只包含显式错误与完成态零 Token 兜底")
  assert.equal(reportData.errors.successCount, 19, "正常空响应不得计失败，进行中消息不得计成功")
  assert.equal(reportData.summary.requestCount, 19, "18 个正常非零请求 + 1 个非零 Token error 必须全部保留用量")

  // 验证 P1-9: 18 个模型全部展示在图表中，没有 Top 15 截断！
  for (let i = 1; i <= 18; i++) {
    assert.ok(htmlContent.includes(`model-${i}`), `模型 model-${i} 必须包含在 HTML 图表中（不得截断）`)
  }

  // 验证 P1-11: 对比图必须完整包含 Reasoning 与 Cache Write
  assert.ok(htmlContent.includes("modelReasoning"), "HTML 必须包含 modelReasoning 数据")
  assert.ok(htmlContent.includes("modelCacheWrite"), "HTML 必须包含 modelCacheWrite 数据")
  assert.ok(htmlContent.includes("name: 'Reasoning'"), "图表必须包含 Reasoning series")
  assert.ok(htmlContent.includes("name: 'Cache Write'"), "图表必须包含 Cache Write series")

  dispose?.()
  console.log("PASS P0-3, P1-9, P1-11: 端到端 /usage 报告导出完美通过，五分量完整无截断！")
}

// ─────────────────────────────────────────────────────────────
// 4. P1-8 验证：缺 delta 时 TTFT 诚实为 null，绝不伪造 0ms
// ─────────────────────────────────────────────────────────────
{
  const tracker = createPerfTracker({ persistLog: false })
  const testId = "msg-no-delta-test"
  const t0 = 6000000

  // 仅有 step.started 窗口锚点，无任何 delta
  tracker.handlePartUpdated({
    message_id: testId,
    type: "step",
    time: { start: t0 },
  })

  tracker.handleMessageUpdated({
    properties: {
      info: {
        id: testId,
        sessionID: "s-p1-8-test",
        role: "assistant",
        providerID: "p",
        modelID: "m",
        tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: t0, streamed: t0 + 500, completed: t0 + 600 },
      },
    },
  })

  const stats = tracker.getSessionStats()
  const mStat = stats.models["p/m"]
  assert.ok(mStat)
  assert.equal(mStat.ttftCount, 0, "无首 token delta 时 ttftCount 必须为 0")
  assert.equal(mStat.avgTTFT, null, "无首 token delta 时 avgTTFT 必须诚实为 null，绝不伪造 0ms")

  console.log("PASS P1-8: 缺 delta 时 TTFT 诚实为 null，杜绝伪造 0ms！")
}

// ─────────────────────────────────────────────────────────────
// 5. 验证：无日志文件时带过滤条件的查询严禁回退全量持久化统计
// ─────────────────────────────────────────────────────────────
{
  // 真正删除当前隔离 HOME 中的日志，覆盖 files.length === 0 分支
  const logPath = join(testHome, ".opencode", "tokenwatch.jsonl")
  rmSync(logPath, { force: true })
  rmSync(logPath + ".1", { force: true })
  assert.ok(!existsSync(logPath) && !existsSync(logPath + ".1"), "测试前置条件：日志文件必须不存在")
  const res = getWindowPerfStats({ sessionId: "non-existent-session" }, new Set(["anthropic/claude-3-7-sonnet"]))
  assert.equal(res.length, 0, "无日志重放时带窗口过滤严禁回退全量持久化统计（必须返回空数组）")
  console.log("PASS Issue-1: 无日志文件时窗口过滤保护生效，绝不回退全量历史！")
}

console.log("\n🎉 ALL AUDIT FIXES VERIFICATION PASSED SUCCESSFULLY! 🎉")
