# opencode-tokenwatch 项目深度审查文档 v2

> 审查时间：2026-06-05
> 审查范围：项目全部源码（v0.2.0）+ OpenCode 官方仓库 (anomalyco/opencode) desktop 统计实现参考
> 文档版本：v2（基于 PROJECT-REVIEW.md v1 更新，补充代码实证与修复方案）

---

## 一、项目概述

`opencode-tokenwatch` 是 OpenCode CLI 的实时 Token 用量统计与性能监控 TUI 插件（v0.2.0）。

**核心功能架构：**
- **实时侧边栏**（`sidebar.tsx`）：基于 SolidJS，显示会话级 & 按模型的 Token/Cache/Cost/Perf 统计
- **性能追踪**（`perf-tracker.ts`）：TTFT / TPS / 端到端延迟，写入 JSONL 日志
- **SQL 报告层**（`queries.ts`）：通过 `opencode db` CLI 查询 SQLite，支持多维度聚合
- **HTML 仪表盘**（`generate-usage-html.ts`）：ECharts 交互式图表报告
- **命令系统**（`commands.tsx`）：`/usage` 命令 + 子菜单（HTML / JSON / 文本 / 设置）

---

## 二、OpenCode 官方实现对照（v2 更新）

> 注：`anomalyco/opencode` 仓库结构为 monorepo，关键文件在 `packages/app/src/components/session/`。

### 2.1 关键文件

| 文件 | 作用 |
|---|---|
| `session-context-metrics.ts` | 核心指标计算（context usage、cost、tokens） |
| `session-context-metrics.test.ts` | 单元测试 |
| `session-context-tab.tsx` | 完整 stats 表格 + 分布条 + 原始 messages |
| `session-context-breakdown.ts` | Token 按 role 分桶（5桶） |
| `session-context-format.ts` | i18n 数字/百分比/时间格式化 |

### 2.2 官方 tokenTotal 公式（权威 5 分量）

```typescript
const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning
    + msg.tokens.cache.read + msg.tokens.cache.write
}
```

**5个分量全部相加**，包含 reasoning 和 cache.write。

### 2.3 官方 context window 占用率定义

```typescript
const message = lastAssistantWithTokens(messages)  // 最后一条有 token 的 assistant
const limit = model?.limit.context                  // 来自 models.dev
const total = tokenTotal(message)
usage: limit ? Math.round((total / limit) * 100) : null
```

- **不是"累计已用 context 窗口"**，而是**最近一次请求 of context window 占用率**
- 用于判断何时该 `/compact`
- 没有 limit 时返回 `null`（不是 0）
- limit 来自 models.dev 数据（provider → models[id] → limit.context）

### 2.4 官方 totalCost 实现

```typescript
const totalCost = messages.reduce(
  (sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0
)
```

- 直接用 SDK 上报的 `msg.cost`，不做单价反推
- **不过滤** `tokens.total == 0` 的消息（包含失败/重试请求）

### 2.5 官方 Token 分布（5桶）

| 桶 | 内容来源 | 估算方式 |
|---|---|---|
| system | 最后一条带 system 字段 of user message 的 system 文本 | chars / 4 |
| user | user message 的 text + file.source.text.value + agent.source.value | chars / 4 |
| assistant | assistant message 的 text + reasoning | chars / 4 |
| tool | tool part：input keys x16 + raw/output/error 长度 | chars / 4 |
| other | input - (system + user + assistant + tool)，分不到桶里的部分 | 直接相减兜底 |

关键特性：**估算总和 > input 时按比例缩放**，保证总和等于 input。

---

## 三、Bug 详细分析与修复方案

### 3.1 严重 Bug（P0）

#### Bug 1：PerfTracker 平均值分母用错（两处）

**位置 A**：`src/perf-tracker.ts:155-184`
**位置 B**：`src/commands.tsx:76-91`（`aggregatePerfStats`）

```typescript
// 当前错误代码（perf-tracker.ts:162-167）
stats.requestCount++  // 每条消息都 +1

if (entry.ttft_ms !== null) {
  const c = stats.requestCount  // 错误：用的是总请求数，含没有 TTFT 的请求
  const prev = stats.avgTTFT
  stats.avgTTFT = prev !== null ? prev + (entry.ttft_ms - prev) / c : entry.ttft_ms
}
```

**复现示例：**
- 请求 1：TTFT=100ms
- 请求 2：TTFT=null（流式响应未捕获到 part 事件）
- 请求 3：TTFT=200ms
- 当前结果：c=3, avg = 100 + (200-100)/3 = **133.3ms**
- 正确结果：c=2, avg = 100 + (200-100)/2 = **150.0ms**（误差 12%）

**修复方案：** 在 `ModelPerfStats` 中独立维护有效计数字段：

```typescript
// 在 ModelPerfStats 接口中添加
ttftCount: number   // 有 TTFT 的请求数
tpsCount: number    // 有 TPS 的请求数

// 修复后的更新逻辑
if (entry.ttft_ms !== null) {
  stats.ttftCount++
  const c = stats.ttftCount  // 使用有效计数
  stats.avgTTFT = stats.avgTTFT !== null
    ? stats.avgTTFT + (entry.ttft_ms - stats.avgTTFT) / c
    : entry.ttft_ms
}
```

`aggregatePerfStats`（commands.tsx）有完全相同的 bug，需同步修复。

---

#### Bug 2：TTFT 取最后一个 part 的时间而非第一个

**位置**：`src/perf-tracker.ts:49-52`

```typescript
// 当前错误代码
handlePartUpdated(event: PartEvent): void {
  if (!event.time?.start || !event.message_id) return
  this.firstPartTimes.set(event.message_id, event.time.start)  // 每次都覆盖
}
```

**修复方案：**

```typescript
handlePartUpdated(event: PartEvent): void {
  if (!event.time?.start || !event.message_id) return
  const cur = this.firstPartTimes.get(event.message_id) ?? Number.POSITIVE_INFINITY
  if (event.time.start < cur) {
    this.firstPartTimes.set(event.message_id, event.time.start)  // 只保留最早时间
  }
}
```

---

#### Bug 3：persistToKv 使用错误的 session key

**位置**：`src/tui.tsx:66`

```typescript
// currentSlotSessionID 只在 slot 渲染时更新，但消息事件可能先到达
persistToKv(currentSlotSessionID, next)  // 可能写入旧 session 的 KV key
```

**修复方案：**

```typescript
// 优先使用事件携带的 sessionID
const msgSessionID = info.sessionID ?? currentSlotSessionID
persistToKv(msgSessionID, next)
```

---

#### Bug 4：sidebar.tsx sessionTotals 缺少 reasoningTokens

**位置**：`src/sidebar.tsx:81-90`（ModelAgg 接口）和 `src/sidebar.tsx:144-148`

```typescript
// 当前 ModelAgg 缺少 reasoningTokens 字段
interface ModelAgg {
  providerID: string; modelID: string
  totalInput: number; totalOutput: number
  // 没有 totalReasoning!
  cacheRead: number; cacheWrite: number; totalCost: number; requestCount: number
}

// 当前 sessionTotals 计算
totalTokens: i + o + cr + cw  // 缺 reasoning
```

官方 5 分量：`input + output + reasoning + cache.read + cache.write`

---

### 3.2 中等 Bug（P1）

#### Bug 5：TPS Fallback 使用 latencyMs（含排队时间）

**位置**：`src/perf-tracker.ts:88-90`

```typescript
const tpsFallback = (tps === null && latencyMs > 0 && outputTokens > 0)
  ? (outputTokens / latencyMs) * 1000  // latencyMs = completed - created（含排队+TTFT）
  : null
```

**示例：** TTFT=2000ms，实际生成时间 3000ms，outputTokens=200
- Fallback 结果：200 / 5000 * 1000 = **40 TPS**
- 真实 TPS：200 / 3000 * 1000 = **66.7 TPS**（低估 40%）

**修复方案：** 移除 fallback，null 表示"无可靠数据"。

---

#### Bug 6：assistant text part 未计入 tokenDistribution

**位置**：`src/sidebar.tsx:224-244`

```typescript
for (const p of parts) {
  if (p.type === "tool") { /* ... */ }
  else if (p.type === "reasoning") { dist.agent += ... }
  else if (p.type === "subtask") { dist.agent += ... }
  // 缺少: else if (p.type === "text") { dist.output += estimateTokens(p.text) }
}
```

---

#### Bug 7：tokenDistribution 缺 `other` 兜底桶

**位置**：`src/sidebar.tsx:193-248`

当估算总和与 `tokens.input` 不一致时，无处放置差值，也无法做比例缩放。

**修复方案（参考官方）：**

```typescript
const totalEstimated = (dist.system ?? 0) + (dist.user ?? 0)
  + (dist.agent ?? 0) + (dist.toolCall ?? 0) + (dist.toolResult ?? 0)
const realInput = sessionTotals().totalInput
const other = realInput - totalEstimated
if (other > 0) dist.other = other
```

---

### 3.3 潜在风险点

#### 风险 1：SQL 日期参数缺格式校验

**位置**：`src/queries.ts:111-112`

`startDate` / `endDate` 经过 `escapeSql()` 处理单引号，但未验证日期格式，可注入非日期字符串导致 SQL 行为异常。

**建议：**
```typescript
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}
```

---

#### 风险 2：JSONL 日志无限增长

**位置**：`src/perf-tracker.ts:204-222`

日志只追加，无轮转。`readLogs()` 每次全量读取文件后截取最后 N 行，大文件时有性能问题。

**建议：** 超过 10MB 时截断旧数据。

---

#### 风险 3：5 个并发子进程读取 SQLite

**位置**：`src/queries.ts:352-361`

`getUsageReport` 同时启动 5 个 `opencode db` 子进程，在 Windows 上可能遇到文件锁竞争。

---

#### 风险 4：重复事件订阅

**位置**：`src/sidebar.tsx:257-261` vs `src/tui.tsx:39`

`message.updated` 事件被订阅两次，导致每次消息更新触发两次渲染。

---

#### 风险 5：session 切换时的竞态条件

**位置**：`src/tui.tsx:97-131`

`reset()` 清空后，新 session 第一条消息可能在 KV 恢复完成前到达，导致 perf 数据丢失。

---

## 四、统计口径不一致汇总

### 4.1 totalTokens 定义分歧（3处不同）

| 位置 | 计算方式 | 问题 |
|---|---|---|
| `queries.ts:172` | `sum($.tokens.total)` | 取 DB 字段，由 OpenCode CLI 决定 |
| `sidebar.tsx:147` | `i + o + cr + cw` | 缺 reasoning！ |
| `sidebar.tsx:304` | `totalInput + totalOutput + cacheRead + cacheWrite` | 同上，缺 reasoning |
| 官方权威 | `input + output + reasoning + cache.read + cache.write` | 5分量 |

### 4.2 cost 聚合过滤条件差异

| 维度 | 本项目 | 官方 |
|---|---|---|
| 过滤条件 | `tokens.total > 0` | 不过滤 |
| 影响 | 失败/重试请求不计入 cost | 所有 assistant 消息的 cost 都累加 |

### 4.3 costPer1K 分母不完整

```typescript
// 当前（错误）
const costPer1K = (p.totalCost / (p.totalInput + p.totalOutput)) * 1000

// 建议（正确）
const billableTokens = p.totalInput + p.totalOutput + p.totalCacheRead + p.totalCacheWrite
const costPer1K = billableTokens > 0 ? (p.totalCost / billableTokens) * 1000 : 0
```

### 4.4 tokenDistribution.system 取值方式差异

| 维度 | 本项目 | 官方 |
|---|---|---|
| 取值方式 | 所有 agent prompt + 所有 user message 的 system 字段累加 | 只取最后一条 user message 的 system 字段 |
| 问题 | 随对话轮数膨胀，偏高 | 反映当前 context 实际占用 |

### 4.5 缺失的 context window 占用率

本项目完全缺失官方的 **context window 占用率**指标，该指标是判断何时需要 `/compact` 最直接的信号。

---

## 五、优化路线图

### 第一批：必修 Bug（已于本次优化中全部完成修复）

| # | 文件 | 问题 | 修复状态 |
|---|---|---|---|
| 1 | `perf-tracker.ts` | 平均值分母用 requestCount | **已修复**（独立计数） |
| 2 | `commands.tsx` | aggregatePerfStats 同样的分母 bug | **已修复** |
| 3 | `perf-tracker.ts` | TTFT 取最后 part，改为 Math.min | **已修复** |
| 4 | `tui.tsx` | persistToKv 用错 session key | **已修复** |
| 5 | `sidebar.tsx` | ModelAgg + sessionTotals 补 reasoning | **防修复**（已加入） |
| 6 | `sidebar.tsx` | assistant text part 计入 distribution | **已修复** |

### 第二批及后续：高价值与中期特性（已根据用户要求调整）

根据优化过程中的用户反馈，我们已实现多项高价值和中期功能，并过滤了部分需求：

**已实现的新增功能：**
1. **tokenDistribution other 桶 + 比例缩放** — 完美支持 5 桶树状估算及超出 input 时的自动缩放。
2. **P50/P95/P99 延迟分位数** — TTFT 及端到端延迟的百分位数统计，HTML 报告独立成表。
3. **错误率/失败请求统计** — 识别空 Token 请求，HTML 报告新增了 Error Rate KPI卡片及失败明细表。
4. **全局加权缓存命中率** — 跨模型按请求数加权命中率，侧边栏实时汇总。
5. **移除 TPS fallback** — 去除不可信的 TPS 估算以绝低估风险。
6. **日期格式校验** — `isValidDate()` 校验传入 SQL 查询的参数。
7. **双重事件订阅优化** — 移除了 sidebar 中重复的事件监听。
8. **i18n 冗余清理** — 移除了死代码。
9. **Efficiency vs Cost 图表优化** — 重构为水平 TPS 排名条形图，彻底解决数据点密集重叠的问题；Model Comparison Matrix 的 TPS 曲线移除连线，改为菱形散点。

**根据要求已移除/不予实现的需求：**
- **Context window 占用率**（取消）
- **CSV 导出**（取消）
- **缓存节省金额**（取消）
- **JSONL 日志轮转**（取消）
- **按小时分桶**（取消）
- **预算/阈值告警**（取消）

---

## 六、官方实现 vs 本项目对比表

| 维度 | 官方（anomalyco/opencode） | 本项目（opencode-tokenwatch） | 评价 |
|---|---|---|---|
| tokenTotal 公式 | 5 分量（含 reasoning） | 5 分量（已补齐 reasoning） | 已对齐 |
| context window 占用率 | 实现（lastMsg / limit） | 未实现 | 依用户要求，不予实现 |
| totalCost 过滤 | 不过滤（含失败请求） | tokens.total > 0 过滤 | 两者各有合理性 |
| Token 分布桶数 | 5 桶（含 other） | 5 桶（已补齐 other 兜底） | 已对齐 |
| Token 分布缩放 | 估算超出 input 时缩放 | 有缩放 | 已对齐 |
| Cache hit rate | 不计算 | 按模型细化 + 趋势 + 全局加权 | 我们更细致 |
| P50/P95 延迟 | 不计算 | 计算（P50/P95/P99 百分位） | 我们更强大 |
| TTFT/TPS 追踪 | 不计算 | 计算（Bug 已修复） | 我们独有 |
| 会话趋势 | 不计算 | 计算 | 我们独有 |
| 多 session 聚合 | 只看当前 | 全部聚合（SQL）| 我们更全面 |
| 持久化 | 不持久 | KV + JSONL | 我们更全 |
| HTML 报告 | 无 | ECharts 仪表盘（已重构重叠图表） | 我们有 |
| CSV 导出 | 无 | 未提供入口 | 依用户要求，不予实现 |
| Daily/Monthly 视图 | CLI --days N | 多种 preset | 我们更灵活 |

---

## 七、代码位置速查表（已处理状态）

| 文件 | 描述 | 状态 |
|---|---|---|
| `src/perf-tracker.ts` | TTFT 每次覆盖，应取最小值 | **已修复**，使用 `Math.min` |
| `src/perf-tracker.ts` | TPS fallback 用 latencyMs 低估 | **已移除该 fallback** |
| `src/perf-tracker.ts` | avgTTFT/avgTPS/avgLatency 分母错误 | **已修复**，使用独立计数 |
| `src/commands.tsx` | aggregatePerfStats 同样的分母 bug | **已修复** |
| `src/tui.tsx` | persistToKv 用 currentSlotSessionID 可能错 | **已修复**，使用事件 sessionID |
| `src/sidebar.tsx` | ModelAgg 接口与 sessionTotals 缺少 reasoningTokens | **已修复** |
| `src/sidebar.tsx` | tokenDistribution 缺 other 桶 + assistant text | **已修复** |
| `src/sidebar.tsx` | 重复订阅 message.updated | **已修复**，已删除重复订阅 |
| `src/queries.ts` | 日期参数缺格式校验 | **已修复**，增加了 `isValidDate()` 校验 |
| `src/generate-usage-html.ts` | costPer1K 分母不含 cache tokens | **已修复** |
| `src/generate-usage-html.ts` | 散点图多点重叠无法阅读，TPS 连线误导 | **已重构**，采用条形图，去连线 |
| `src/i18n.ts` | showCache / saving 死代码 | **已清理** |

---

*本文档已于 2026-06-05 根据优化方案和实际完成状态更新。*
