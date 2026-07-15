# opencode-tokenwatch — Agent Context Document

> 本文档供 AI 编程助手（opencode CLI、Antigravity CLI 等）快速了解项目全貌。
> 最后更新：2026-07-15（v0.5.0）

---

## 项目概述

**opencode-tokenwatch** 是 [OpenCode CLI](https://github.com/anomalyco/opencode) 的 TUI 插件，为 AI 编程会话提供实时 Token 用量统计、缓存效率分析与性能指标监控。

- **npm 包名**：`opencode-tokenwatch`
- **版本**：`0.5.0`
- **语言**：TypeScript (ESM)，JSX via SolidJS
- **目标运行环境**：Node.js ≥ 18，OpenCode CLI TUI 插件系统
- **构建工具**：`tsc`（类型声明生成）+ `esbuild`（JS 打包，含 SolidJS JSX 预编译）
- **协议**：MIT

---

## 项目结构

```
opencode-tokenwatch/
├── src/                        # 所有源码
│   ├── server.ts               # Server 插件入口（空壳，导出 ./server）
│   ├── tui.tsx                 # TUI 插件主模块，事件监听 & Slot 注册
│   ├── sidebar.tsx             # TokenWatchPanel 组件（SolidJS），侧边栏 UI
│   ├── perf-tracker.ts         # 性能指标追踪（TTFT / TPS / 延迟）+ JSONL 日志
│   ├── stats-store.ts          # 持久化聚合统计（JSON 文件，永久累积，不受日志轮转影响）
│   ├── commands.tsx            # /usage 命令注册 & 子菜单（HTML/JSON/文本/设置）
│   ├── queries.ts              # SQL 查询层（通过 `opencode db` CLI 查询 SQLite）
│   ├── formatter.ts            # 数据格式化 & 所有 TypeScript 类型接口定义
│   ├── generate-usage-html.ts  # HTML 报告生成（ECharts 图表内嵌）
│   └── i18n.ts                 # 国际化（中文/英文/自动检测）
├── dist/                       # 编译输出（发布到 npm）
├── docs/
│   └── PROJECT-REVIEW.md       # 历史审查文档
├── assets/                     # 静态资产
├── scripts/                    # 构建辅助脚本（publish-check.mjs）
├── build.tui.mjs               # esbuild 打包脚本（TSX -> JS，含 SolidJS JSX 预编译）
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

perf-tracker.ts     → JSONL 日志（~/.opencode/tokenwatch.jsonl，可轮转）
                    → stats-store.ts（每次请求增量写入 tokenwatch-stats.json）
                    → SessionPerfStats（内存中，session切换时reset）

stats-store.ts      → ~/.opencode/tokenwatch-stats.json（永久累积，不受日志轮转影响）
                    → 首次读取时自动从 JSONL 全量迁移历史数据

/usage 命令         → queries.ts → opencode db CLI → SQLite
                    → stats-store.readPersistedStats() → 全量历史性能统计
                    → HTML报告 / JSON导出 / 文本报告
```

---

## 关键文件详解

### `src/tui.tsx` — 插件入口

- 实现 `TuiPluginModule.tui` 接口
- 维护 `allTokenMessages: Signal<TokenMessage[]>`（当前 session 全量消息）
- **无效数据过滤**：`checkAndPopulate` 加 `tokens.total > 0` 检查，与事件处理器保持一致
- **session 切换时**：从 KV Store 恢复历史消息，若无则从 `api.state.session.messages()` 重建
- **数据持久化**：每次消息更新写入 KV Store（key = `tokenwatch-msgs-{sessionID}`）
- 写入时使用事件中的 sessionID 替代 currentSlotSessionID，避免时序竞态问题

### `src/sidebar.tsx` — 侧边栏 UI

- 基于 SolidJS 响应式系统，`createMemo` 懒计算
- **模型排序**：按最近调用时间降序（最后一条消息的数组索引），而非 Token 总量或 TPS，切换模型时当前焦点模型始终在顶部
- **供应商名称截断**：超过 12 字符时省略显示（`…`），避免长供应商名撑破布局
- **tokenDistribution**：从消息 parts 估算 Token 分布（chars/4 经验公式）
  - 5 桶：system / user / toolCall / toolResult / output + other 兜底桶，超出真实 input 时比例收缩
- **缓存命中率公式**：`cacheRead / (cacheRead + input)`
- **趋势计算**：最近3次 vs 前3次的命中率差值，需至少6条消息
- **成本展示**：`showPricing` 开启且 `totalCost > 0` 时显示（免费模型不显示，属正常行为）

### `src/perf-tracker.ts` — 性能追踪

- **无效数据过滤**：`handleMessageUpdated` 跳过全零 token 请求，不写 JSONL / stats-store
- **TTFT**：监听 `message.part.updated`，取最早 part 的 `time.start`（`Math.min`）
- **TPS**：`outputTokens / genMs * 1000`（genMs = completed - firstPartTime），无可靠 genMs 时为 null
- **平均值**：Welford 在线均值，分母使用独立的 `ttftCount` / `tpsCount` 计数器
- 每条请求完成后同时调用 `stats-store.updatePersistedStats(entry)` 写入持久化统计
- 会话内数据存内存，session 切换时 `reset()` 清空

### `src/stats-store.ts` — 持久化聚合统计（v0.3.1 新增）

- **存储路径**：`~/.opencode/tokenwatch-stats.json`
- **设计目标**：将聚合统计与原始日志完全解耦，JSONL 可以轮转，统计永不丢失
- **增量写入**：每次请求完成时由 `perf-tracker` 调用 `updatePersistedStats()` 增量更新
- **Reservoir Sampling**：每个模型保留最多 500 个 TTFT/latency 原始样本用于分位数计算，内存有界
- **一次性迁移**：首次调用 `readPersistedStats()` 时自动读取全量 JSONL 重建历史，老用户无感升级
- **防重复计数**：迁移时先清空 models 再重建，以 JSONL 为唯一权威来源
- `readPersistedStats()` 供 `commands.tsx` 生成 HTML 报告时调用，替代了原来有窗口限制的 `aggregatePerfStats(readLogs(N))`

### `src/queries.ts` — 数据库查询

- 通过 `opencode db <SQL> --format json` CLI 子进程查询 SQLite
- **过滤条件**：`role = 'assistant' AND tokens.total > 0`（过滤失败/空请求）
- **totalTokens 字段**：直接取 `$.tokens.total`（OpenCode CLI 写入的字段）
- **SQL 注入防护**：字符串参数调用 `escapeSql()`，日期参数使用正则格式校验

### `src/generate-usage-html.ts` — HTML 报告

- 生成内嵌 ECharts 的独立 HTML 文件，自动在浏览器打开
- **costPer1K 公式**：`cost / (input + output + cacheRead + cacheWrite) * 1000`
- **Efficiency vs Cost 图**：TPS 降序水平条形对比图（含 TTFT、cost/1K 注释），模型名支持最多 50 字符
- **Model Comparison Matrix**：按 token 量堆叠条形图，TPS 以独立菱形散点叠加在右侧 Y 轴
- **Performance Latency Percentiles**：P50/P95/P99 TTFT 及端到端延迟表格
- **Error Rate 卡片 + 失败请求明细表**

---

## 重要数据类型（`src/formatter.ts`）

```typescript
interface TokenMessage {          // TUI 内存模型（单条 assistant 消息）
  inputTokens, outputTokens, reasoningTokens, cacheRead, cacheWrite, cost
}

interface SessionTokenData {      // SQL 查询聚合结果
  totalTokens, inputTokens, outputTokens, reasoningTokens, cacheRead, cacheWrite, totalCost
}

interface ModelPerfStats {        // 性能统计（内存 / stats-store / JSONL）
  avgTTFT, avgTPS, avgLatency
  p50TTFT, p95TTFT, p99TTFT
  p50Latency, p95Latency, p99Latency
  ttftCount, tpsCount, latencyCount   // 独立计数分母
  cacheHitRate                        // 该模型加权命中率
}

interface LogEntry {              // JSONL 日志条目格式
  ts, model, providerID, modelID, sessionID
  ttft_ms, tps, latency_ms
  inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, cost
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
| 🔴 P0 | `perf-tracker.ts` | 平均值分母用 `requestCount`（总数）而非 `ttftCount` | **已修复** |
| 🔴 P0 | `commands.tsx` | `aggregatePerfStats` 同样的分母 bug | **已修复** |
| 🔴 P0 | `tui.tsx` | `persistToKv` 用 `currentSlotSessionID`，可能存错 session | **已修复** |
| 🔴 P0 | `commands.tsx` | `readLogs(N)` 窗口限制导致历史模型 TPS 数据丢失 | **已修复（引入 stats-store）** |
| 🔴 P0 | `generate-usage-html.ts` | scatter-chart Y 轴模型名被强制截断至 26 字符 | **已修复（50 字符）** |
| 🟡 P1 | `perf-tracker.ts` | TPS fallback 用 latencyMs（含排队时间），严重低估 | **已移除该 fallback** |
| 🟡 P1 | `sidebar.tsx` | assistant text part 未计入 tokenDistribution | **已修复** |
| 🟡 P1 | `sidebar.tsx` | tokenDistribution 缺 `other` 兜底桶 | **已修复** |
| 🟡 P1 | `generate-usage-html.ts` | costPer1K 分母未含 cacheRead | **已修复** |
| 🟡 P1 | `sidebar.tsx` | 模型排序按 Token 总量而非最近调用时间 | **已修复（按最近调用降序）** |
| 🟡 P1 | `sidebar.tsx` | 供应商名称过长撑破布局 | **已修复（12字符截断+省略号）** |
| 🟡 P1 | `perf-tracker.ts` | 全零 token 请求写入日志/统计 | **已修复（跳过无效数据）** |
| 🟡 P1 | `tui.tsx` | 历史重建未过滤全零 token 消息 | **已修复（tokens.total > 0）** |
| 🟡 P1 | `sidebar.tsx` | modelStats 未过滤全零 token | **已修复（二次保障过滤）** |
| 🟡 P1 | `generate-usage-html.ts` | HTML 报告含无效零 token 记录 | **已修复（各渲染函数过滤）** |
| 🟡 P1 | `commands.tsx` | aggregatePerfStats 未跳过全零条目 | **已修复** |

---

## 编码规范与注意事项

### TypeScript / 构建

- **模块系统**：纯 ESM，所有导入必须带 `.js` 扩展名（`.tsx` 源文件的导入也用 `.js`）
- **编译流程**：`npm run build`（= `tsc && node build.tui.mjs`）
  - `tsc`：仅生成 `.d.ts` 类型声明文件（`emitDeclarationOnly: true`）
  - `build.tui.mjs`：esbuild 打包，将 `src/tui.tsx` -> `dist/tui.js`（含 SolidJS JSX 预编译），`src/server.ts` -> `dist/server.js`
- **JSX 预编译**：使用 `esbuild-plugin-solid`，配置 `moduleName: "@opentui/solid"` + `generate: "universal"`，将 JSX 编译为 `createComponent()` 等调用。opencode 1.17.14+ 不再进行运行时 JSX 转换，要求插件在构建时预编译
- **产物在 `dist/`，不提交到 git**
- **JSX**：SolidJS 风格，不是 React。`createSignal`/`createMemo`/`createEffect` 等
- **类型安全**：大量使用 `any` 访问 OpenCode API 事件（API 类型不完整），修改时需谨慎

### Package Exports 结构

```json
{
  ".":       { "import": "./dist/server.js" },        // Server 插件入口
  "./tui":   { "import": "./dist/tui.js", "config": { "enabled": true } },  // TUI 插件入口
  "./server":{ "import": "./dist/server.js" }         // Server 插件（显式路径）
}
```

- `./tui` 导出必须包含 `"config": { "enabled": true }`，opencode 1.17.14+ 据此启用 TUI 插件
- `./tui` 导出的文件必须是预编译的 `.js`（非 `.jsx`）

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
- 数字型参数（limit、dates）通过 TypeScript 类型保证，但仍需 `Math.max(1, ...)` 边界检查，日期参数已引入正则校验

### 日志与统计文件

| 文件 | 路径 | 格式 | 特点 |
|---|---|---|---|
| JSONL 日志 | `~/.opencode/tokenwatch.jsonl` | 每行一个 JSON | 超过 5MB 时轮转，只保留最新 2000 行 |
| 统计文件 | `~/.opencode/tokenwatch-stats.json` | 单个 JSON | 永久累积，不轮转；含 Reservoir 样本用于分位数计算 |

### i18n

- 支持语言：`zh`（中文）、`en`（英文）、`auto`（系统自动检测）
- 翻译表在 `src/i18n.ts`，`t(key)` 函数用于取值

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

## 外部依赖

| 依赖 | 用途 |
|---|---|
| `@opencode-ai/plugin` | OpenCode 插件 API 类型定义 |
| `@opentui/core` | TUI 颜色类型（RGBA） |
| `@opentui/solid` | SolidJS TUI 渲染器 |
| `solid-js` | 响应式 UI 框架（通过 @opentui/solid） |
| `esbuild` | JS 打包器，将 TSX 预编译为纯 JS（v0.5.0 新增） |
| `esbuild-plugin-solid` | esbuild 插件，SolidJS JSX -> createComponent 转换（v0.5.0 新增） |

> 以上均为 devDependencies，运行时由 OpenCode CLI 宿主环境提供。

---

*本文档于 2026-07-15 更新，版本 v0.5.0。*
