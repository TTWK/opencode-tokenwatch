# opencode-tokenwatch — Agent Context Document

> 本文档供 AI 编程助手（opencode CLI、Antigravity CLI 等）快速了解项目全貌。
> 生成时间：2026-06-05

---

## 项目概述

**opencode-tokenwatch** 是 [OpenCode CLI](https://github.com/anomalyco/opencode) 的 TUI 插件，为 AI 编程会话提供实时 Token 用量统计、缓存效率分析与性能指标监控。

- **npm 包名**：`opencode-tokenwatch`
- **版本**：`0.2.0`
- **语言**：TypeScript (ESM)，JSX via SolidJS
- **目标运行环境**：Node.js ≥ 18，OpenCode CLI TUI 插件系统
- **构建工具**：`tsc`（TypeScript 编译器，无打包器）
- **协议**：MIT

---

## 项目结构

```
opencode-tokenwatch/
├── src/                        # 所有源码
│   ├── index.ts                # 插件入口（目前是空壳，tui 在 tui.tsx 导出）
│   ├── tui.tsx                 # TUI 插件主模块，事件监听 & Slot 注册
│   ├── sidebar.tsx             # TokenWatchPanel 组件（SolidJS），侧边栏 UI
│   ├── perf-tracker.ts         # 性能指标追踪（TTFT / TPS / 延迟）+ JSONL 日志
│   ├── commands.tsx            # /usage 命令注册 & 子菜单（HTML/JSON/文本/设置）
│   ├── queries.ts              # SQL 查询层（通过 `opencode db` CLI 查询 SQLite）
│   ├── formatter.ts            # 数据格式化 & 所有 TypeScript 类型接口定义
│   ├── generate-usage-html.ts  # HTML 报告生成（ECharts 图表内嵌）
│   └── i18n.ts                 # 国际化（中文/英文/自动检测）
├── dist/                       # 编译输出（发布到 npm）
├── docs/
│   ├── PROJECT-REVIEW.md       # 历史审查文档（2026-06-03）
│   └── superpowers/            # AI agent 超能力配置
├── assets/                     # 静态资产
├── scripts/                    # 构建辅助脚本（publish-check.mjs）
├── package.json
├── tsconfig.json
├── AGENTS.md                   # 本文档
└── README.md / README.en.md    # 用户文档（中/英）
```

---

## 核心数据流

```
OpenCode CLI 事件 → tui.tsx (事件订阅)
                        ├─ message.updated     → allTokenMessages[] + perf-tracker
                        ├─ message.part.updated → perf-tracker (TTFT计时)
                        └─ message.removed     → 刷新 sidebar

allTokenMessages[]  → sidebar.tsx (SolidJS 响应式计算)
                        ├─ modelStats()         按模型聚合 Token/Cost
                        ├─ sessionTotals()      全局总计
                        ├─ modelHitRate()       缓存命中率 per model
                        ├─ modelTrend()         近3次 vs 前3次命中率趋势
                        └─ tokenDistribution()  Token按角色分布（估算）

perf-tracker.ts     → JSONL 日志（~/.opencode/tokenwatch.jsonl）
                    → SessionPerfStats（内存中，session切换时reset）

/usage 命令         → queries.ts → opencode db CLI → SQLite
                    → HTML报告 / JSON导出 / 文本报告
```

---

## 关键文件详解

### `src/tui.tsx` — 插件入口

- 实现 `TuiPluginModule.tui` 接口
- 维护 `allTokenMessages: Signal<TokenMessage[]>`（当前 session 全量消息）
- **session 切换时**：从 KV Store 恢复历史消息，若无则从 `api.state.session.messages()` 重建
- **数据持久化**：每次消息更新写入 KV Store（key = `tokenwatch-msgs-{sessionID}`）
  - *已修复*：已在写入时使用事件中的 sessionID 替代 currentSlotSessionID，解决时序竞态问题。

### `src/sidebar.tsx` — 侧边栏 UI

- 基于 SolidJS 响应式系统，`createMemo` 懒计算
- **tokenDistribution**：从消息 parts 估算 Token 分布（chars/4 经验公式）
  - *已修复*：已将 assistant 的 `text` part 正确计入，并增加了 `other` 兜底桶和比率缩放。
- **缓存命中率公式**：`cacheRead / (cacheRead + input)`
- **趋势计算**：最近3次 vs 前3次的命中率差值，需至少6条消息

### `src/perf-tracker.ts` — 性能追踪

- **TTFT**：监听 `message.part.updated`，记录 first part 的 `time.start`
  - *已修复*：现采用 `Math.min` 取最早时间作为 TTFT 触发点。
- **TPS**：`outputTokens / genMs * 1000`（genMs = completed - firstPartTime）
  - *已修复*：已移除极易低估 TPS 的 latencyMs fallback。
- **平均值算法**：Welford 在线均值（`prev + (x - prev) / c`）
  - *已修复*：分母 `c` 现使用独立的 `ttftCount` / `tpsCount` 计数器，不再错误使用总请求数。
- 会话内数据存内存，session 切换时 `reset()` 清空（跨 session 数据丢失）

### `src/queries.ts` — 数据库查询

- 通过 `opencode db <SQL> --format json` CLI 子进程查询 SQLite
- **过滤条件**：`role = 'assistant' AND tokens.total > 0`（过滤失败/空请求）
- **totalTokens 字段**：直接取 `$.tokens.total`（OpenCode CLI 写入的字段）
  - 注意：此字段的计算逻辑由 OpenCode CLI 决定，本项目不参与计算
- **SQL 注入防护**：仅对字符串参数调用 `escapeSql()`，数字参数需手动验证，日期参数使用正则校验

### `src/generate-usage-html.ts` — HTML 报告

- 生成内嵌 ECharts 的独立 HTML 文件
- **costPer1K 公式**：`cost / (input + output + cacheRead + cacheWrite) * 1000`
  - *已修复*：分母已正确计入 cacheRead / cacheWrite。
- **图表重设计**：
  - “Efficiency vs Cost” 气泡图已重构为按 TPS 降序的**水平性能条形对比图**，彻底解决大圆点重叠且无法阅读的问题。
  - “Model Comparison Matrix” 中的 TPS 线已去除，改为了独立的菱形散点。

---

## 重要数据类型（`src/formatter.ts`）

```typescript
interface TokenMessage {          // TUI 内存模型（单条 assistant 消息）
  inputTokens, outputTokens, reasoningTokens, cacheRead, cacheWrite, cost
}

interface SessionTokenData {      // SQL 查询聚合结果
  totalTokens, inputTokens, outputTokens, reasoningTokens, cacheRead, cacheWrite, totalCost
}

interface ModelPerfStats {        // 性能统计（内存/JSONL）
  avgTTFT, avgTPS, avgLatency, maxTTFT, minTTFT, ...
  ttftCount, tpsCount, latencyCount // 独立计数分母
}

interface LogEntry {              // JSONL 日志条目格式
  ts, model, ttft_ms, tps, latency_ms, inputTokens, ...
}
```

---

## OpenCode CLI 官方统计方式（对照参考）

> 来源：`anomalyco/opencode` 仓库 `packages/app/src/components/session/`

### 官方 tokenTotal 公式（5分量）

```typescript
const tokenTotal = (msg) =>
  msg.tokens.input + msg.tokens.output + msg.tokens.reasoning
  + msg.tokens.cache.read + msg.tokens.cache.write
```

### 官方 context window 占用率

```typescript
// 取最后一条有 token 的 assistant 消息
const total = tokenTotal(lastAssistantWithTokens(messages))
// limit 来自 models.dev（model.limit.context）
const usage = limit ? Math.round((total / limit) * 100) : null
```

### 官方 Token 分布（5桶）

| 桶 | 来源 | 估算 |
|---|---|---|
| system | 最后一条 user message 的 system 字段 | chars/4 |
| user | user message 的 text + file.source.text | chars/4 |
| assistant | assistant 的 text + reasoning | chars/4 |
| tool | tool input keys×16 + output/error 长度 | chars/4 |
| other | input - (system+user+assistant+tool) | 直接相减兜底 |

---

## 已知 Bug 修复状态汇总

| 优先级 | 位置 | 问题描述 | 修复状态 |
|---|---|---|---|
| 🔴 P0 | `perf-tracker.ts` | TTFT 取最后 part 而非最早，应用 `Math.min` | **已修复** |
| 🔴 P0 | `perf-tracker.ts` | 平均值分母用 `requestCount`（总数）而非 `ttftCount` | **极修复** |
| 🔴 P0 | `commands.tsx` | `aggregatePerfStats` 同样的分母 bug | **已修复** |
| 🔴 P0 | `tui.tsx` | `persistToKv` 用 `currentSlotSessionID`，可能存错 session | **已修复** |
| 🟡 P1 | `perf-tracker.ts` | TPS fallback 用 latencyMs（含排队时间），严重低估 | **已移除该 fallback** |
| 🟡 P1 | `sidebar.tsx` | assistant text part 未计入 tokenDistribution | **已修复** |
| 🟡 P1 | `sidebar.tsx` | tokenDistribution 缺 `other` 兜底桶 | **已修复** |
| 🟡 P1 | `generate-usage-html.ts` | costPer1K 分母未含 cacheRead | **已修复** |

---

## 编码规范与注意事项

### TypeScript / 构建

- **模块系统**：纯 ESM，所有导入必须带 `.js`/`.jsx` 扩展名
- **编译**：`npm run build`（= `tsc`）。产物在 `dist/`，**不提交到 git**
- **JSX**：SolidJS 风格，不是 React。`createSignal`/`createMemo`/`createEffect` 等
- **类型安全**：大量使用 `any` 访问 OpenCode API 事件（API 类型不完整），修改时需谨慎

### OpenCode 插件 API

- `api.event.on(eventName, handler)` — 订阅事件
- `api.state.session.messages(sessionId)` — 获取消息列表
- `api.state.part(messageId)` — 获取消息 parts
- `api.kv.get/set(key, value)` — KV 持久化存储
- `api.ui.toast()` — 显示通知
- `api.command.register()` — 注册命令（slash command）

### SQL 查询

- 通过 `child_process.exec` 运行 `opencode db "<SQL>" --format json`
- 超时：30秒。失败时 reject，调用方需 catch
- 所有字符串过滤参数必须经过 `escapeSql()`（单引号转义）
- 数字型参数（limit、dates）通过 TypeScript 类型保证，但仍需 `Math.max(1, ...)` 边界检查，日期参数已引入正则校验。

### 日志文件

- 路径：`~/.opencode/tokenwatch.jsonl`
- 格式：每行一个 JSON（LogEntry 接口）
- 写入：`appendFileSync`（同步），失败静默忽略
- 读取：每次重新读取文件，无缓存。大文件时有性能风险（已引入限制，最大只读取有限末尾行以缓解）

### i18n

- 支持语言：`zh`（中文）、`en`（英文）、`auto`（系统自动检测）
- 翻译表在 `src/i18n.ts`，`t(key)` 函数用于取值
- 已清理冗余未使用的 key（如 `showCache`、`saving`）

---

## 开发工作流

```bash
# 安装依赖
npm install

# 编译（产物在 dist/）
npm run build

# 发布前检查
npm run release:check

# 在 OpenCode 中加载插件（需先 build）
# ~/.opencode/config.json 中配置 plugins
```

---

## 已实现的重要特性（优化后新增）

1. **P50/P95/P99 延迟分位数**：已完全实现 TTFT 和总延迟的百分位数计算，在 HTML 报告独立为性能延迟分位数表格。
2. **错误率与失败请求统计**：已实现，识别 `tokens.total = 0` 的 assistant 请求。HTML 报告新增了 Error Rate 卡片以及失败请求表。
3. **全局加权缓存命中率**：在侧边栏全局总计行中，显示按请求数加权的缓存命中率。
4. **Token 分布 5 桶**：补充了 `other` 兜底桶，修复了 `assistant` text 丢失，在超出真实 input 时引入了比例收缩机制。
5. **Efficiency vs Cost 水平条形排名图**：重构了原本数据重叠的 ECharts 气泡散点图，采用 TPS 降序的水平条状图展示。

---

## 外部依赖

| 依赖 | 用途 |
|---|---|
| `@opencode-ai/plugin` | OpenCode 插件 API 类型定义 |
| `@opentui/core` | TUI 颜色类型（RGBA） |
| `@opentui/solid` | SolidJS TUI 渲染器 |
| `solid-js` | 响应式 UI 框架（通过 @opentui/solid） |

> 以上均为 devDependencies，运行时由 OpenCode CLI 宿主环境提供。

---

*本文档由 AI 助手于 2026-06-05 自动更新，反映最新优化和修复状态。* 用 latencyMs（含排队时间），严重低估 |
| 🟡 P1 | `sidebar.tsx:227` | assistant text part 未计入 tokenDistribution |
| 🟡 P1 | `sidebar.tsx:193` | tokenDistribution 缺 `other` 兜底桶 |
| 🟡 P1 | `generate-usage-html.ts:227` | costPer1K 分母未含 cacheRead |

---

## 编码规范与注意事项

### TypeScript / 构建

- **模块系统**：纯 ESM，所有导入必须带 `.js`/`.jsx` 扩展名
- **编译**：`npm run build`（= `tsc`）。产物在 `dist/`，**不提交到 git**
- **JSX**：SolidJS 风格，不是 React。`createSignal`/`createMemo`/`createEffect` 等
- **类型安全**：大量使用 `any` 访问 OpenCode API 事件（API 类型不完整），修改时需谨慎

### OpenCode 插件 API

- `api.event.on(eventName, handler)` — 订阅事件
- `api.state.session.messages(sessionId)` — 获取消息列表
- `api.state.part(messageId)` — 获取消息 parts
- `api.kv.get/set(key, value)` — KV 持久化存储
- `api.ui.toast()` — 显示通知
- `api.command.register()` — 注册命令（slash command）

### SQL 查询

- 通过 `child_process.exec` 运行 `opencode db "<SQL>" --format json`
- 超时：30秒。失败时 reject，调用方需 catch
- 所有字符串过滤参数必须经过 `escapeSql()`（单引号转义）
- 数字型参数（limit、dates）通过 TypeScript 类型保证，但仍需 `Math.max(1, ...)` 边界检查

### 日志文件

- 路径：`~/.opencode/tokenwatch.jsonl`
- 格式：每行一个 JSON（LogEntry 接口）
- 写入：`appendFileSync`（同步），失败静默忽略
- 读取：每次重新读取文件，无缓存。大文件时有性能风险

### i18n

- 支持语言：`zh`（中文）、`en`（英文）、`auto`（系统自动检测）
- 翻译表在 `src/i18n.ts`，`t(key)` 函数用于取值
- 死代码：`showCache`、`saving` 等 key 已定义但未使用

---

## 开发工作流

```bash
# 安装依赖
npm install

# 编译（产物在 dist/）
npm run build

# 发布前检查
npm run release:check

# 在 OpenCode 中加载插件（需先 build）
# ~/.opencode/config.json 中配置 plugins
```

---

## 待实现的重要功能

1. **Context Window 占用率**：参考官方 `getSessionContextMetrics`，接入 models.dev 获取 limit.context
2. **CSV 导出**：`exportReportAsCsv` 函数已实现，但未接入 `/usage` 菜单
3. **P50/P95/P99 延迟分位**：当前只有平均值
4. **缓存节省金额**：`(cacheRead * (inputPrice - cacheReadPrice))`，i18n key 已有 `saving`
5. **Token 分布 5 桶**：补充 `other` 桶 + 比例缩放 + 修复 assistant text

---

## 外部依赖

| 依赖 | 用途 |
|---|---|
| `@opencode-ai/plugin` | OpenCode 插件 API 类型定义 |
| `@opentui/core` | TUI 颜色类型（RGBA） |
| `@opentui/solid` | SolidJS TUI 渲染器 |
| `solid-js` | 响应式 UI 框架（通过 @opentui/solid） |

> 以上均为 devDependencies，运行时由 OpenCode CLI 宿主环境提供。

---

*本文档由 Antigravity CLI 于 2026-06-05 自动生成，基于项目源码完整分析。*
