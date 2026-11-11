/**
 * Server 端遥测收集与防重机制专项测试：
 *
 * 验证：
 * 1. Server 收集器独立运行时，能接收 message.updated 与 session.step.ended 事件并正确写入 JSONL 与 stats；
 * 2. 模拟 Desktop/非 TUI 客户端发起的请求被 Server 成功捕获；
 * 3. isServerActive() 能够精确检测 Server 在线状态；
 * 4. TUI 客户端在 Server 在线时自动关闭落盘（persistLog: false），绝无双重计数；
 * 5. Server 进程退出或卸载后，标记被清理，TUI 恢复兜底写入能力。
 */
import assert from "node:assert"
import { readFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import serverPlugin, { isServerActive, createPerfTracker } from "../dist/server.js"

const LOG_PATH = join(homedir(), ".opencode", "tokenwatch.jsonl")

console.log("=== 开始 Server 端遥测收集与防重验证 ===")

// 记录当前日志行数
const initialLineCount = existsSync(LOG_PATH)
  ? readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean).length
  : 0

// 1. 初始化 Server 收集器
const handlers = new Map()
const fakeCtx = {
  data: {
    on(ev, handler) {
      handlers.set(ev, handler)
      return () => handlers.delete(ev)
    },
  },
}

const disposeServer = await serverPlugin.setup(fakeCtx)
assert.equal(typeof disposeServer, "function", "setup() 应返回清理函数")
assert.ok(isServerActive(), "Server 启动后 isServerActive() 必须为 true")
console.log("PASS 1: Server 收集器启动且激活状态就绪")

// 2. 模拟由 OpenCode Desktop 触发的 step.started -> text.started -> step.ended 事件流
const stepStartHandler = handlers.get("session.step.started")
const textStartHandler = handlers.get("session.text.started")
const stepEndHandler = handlers.get("session.step.ended")

assert.ok(stepStartHandler, "session.step.started 监听器必须存在")
assert.ok(textStartHandler, "session.text.started 监听器必须存在")
assert.ok(stepEndHandler, "session.step.ended 监听器必须存在")

const testMsgID = "desktop-msg-" + Date.now()
const t0 = 1000000
stepStartHandler({
  type: "session.step.started",
  data: {
    sessionID: "desktop-session-1",
    assistantMessageID: testMsgID,
    model: { providerID: "anthropic", id: "claude-3-7-sonnet" },
    timestamp: t0,
  },
})

textStartHandler({
  type: "session.text.started",
  data: {
    assistantMessageID: testMsgID,
    timestamp: t0 + 250, // TTFT = 250ms
  },
})

stepEndHandler({
  type: "session.step.ended",
  data: {
    sessionID: "desktop-session-1",
    assistantMessageID: testMsgID,
    finish: "stop",
    cost: 0.015,
    tokens: {
      input: 500,
      output: 120,
      reasoning: 80,
      cache: { read: 200, write: 50 },
    },
    time: {
      created: t0,
      streamed: t0 + 2000, // activeMs = 2000ms, TPS = (120+80)/2 = 100
      completed: t0 + 2100,
    },
  },
})

// 读取并验证刚刚写入的日志条目
assert.ok(existsSync(LOG_PATH), "tokenwatch.jsonl 必须已被写入")
const linesAfterServer = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean)
assert.equal(linesAfterServer.length, initialLineCount + 1, "应恰好新增 1 条来自 Server 的日志")
const lastEntry = JSON.parse(linesAfterServer[linesAfterServer.length - 1])

assert.equal(lastEntry.sessionID, "desktop-session-1")
assert.equal(lastEntry.model, "anthropic/claude-3-7-sonnet")
assert.equal(lastEntry.inputTokens, 500)
assert.equal(lastEntry.outputTokens, 120)
assert.equal(lastEntry.reasoningTokens, 80)
assert.equal(lastEntry.cacheReadTokens, 200)
assert.equal(lastEntry.cacheWriteTokens, 50)
assert.equal(lastEntry.active_ms, 2000)
assert.equal(lastEntry.latency_ms, 2100)
assert.equal(lastEntry.ttft_ms, 250)
assert.equal(lastEntry.tps, 100)
console.log("PASS 2: Server 成功捕获并准确落盘 Desktop 会话性能指标 (TTFT=250ms, TPS=100)")

// 3. 验证去重防护：若同时又收到了同一条消息的 message.updated 事件，不应重复写入
const messageUpdatedHandler = handlers.get("message.updated")
assert.ok(messageUpdatedHandler)
messageUpdatedHandler({
  type: "message.updated",
  properties: {
    info: {
      id: testMsgID,
      sessionID: "desktop-session-1",
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-3-7-sonnet",
      tokens: { input: 500, output: 120, reasoning: 80, cache: { read: 200, write: 50 } },
      cost: 0.015,
      time: { created: t0, streamed: t0 + 2000, completed: t0 + 2100 },
    },
  },
})

const linesAfterDup = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean)
assert.equal(linesAfterDup.length, initialLineCount + 1, "同一消息 ID 绝不应重复写入（内部完成去重）")
console.log("PASS 3: 同一消息的多事件防重拦截生效")

// 4. 验证 TUI 客户端协同（Server 在线时，TUI 不写日志）
const tuiTracker = createPerfTracker({ persistLog: !isServerActive() })
tuiTracker.handleMessageUpdated({
  properties: {
    info: {
      id: "tui-msg-test",
      sessionID: "tui-session-1",
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-4o",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.005,
      time: { created: 1000, streamed: 2000, completed: 2000 },
    },
  },
})

const linesAfterTui = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean)
assert.equal(linesAfterTui.length, initialLineCount + 1, "TUI 客户端识别到 Server 在线，不写入磁盘（仅在内存维护）")
const tuiStats = tuiTracker.getSessionStats()
assert.ok(tuiStats.models["openai/gpt-4o"], "TUI 客户端在内存中仍正常维护会话均值")
console.log("PASS 4: TUI 客户端无感感知 Server 状态，内存计算正常但杜绝双写")

// 5. 卸载 Server，验证状态清理与兜底恢复
disposeServer()
assert.equal(isServerActive(), false, "dispose 后 isServerActive() 应恢复为 false")

const fallbackTracker = createPerfTracker({ persistLog: !isServerActive() })
fallbackTracker.handleMessageUpdated({
  properties: {
    info: {
      id: "fallback-msg-test",
      sessionID: "fallback-session-1",
      role: "assistant",
      providerID: "deepseek",
      modelID: "deepseek-chat",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.001,
      time: { created: 1000, streamed: 2000, completed: 2000 },
    },
  },
})

const linesAfterFallback = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean)
assert.equal(linesAfterFallback.length, initialLineCount + 2, "Server 离线时，客户端自动兜底写入磁盘")
console.log("PASS 5: Server 离线后状态清理干净，客户端兜底机制生效")

console.log("\nALL SERVER TELEMETRY TESTS PASSED!")
