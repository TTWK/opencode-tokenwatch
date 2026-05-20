# opencode-tokenwatch v2 重构设计文档

## 1. 概述

opencode-tokenwatch 是一个 OpenCode TUI 插件，在侧边栏实时显示当前会话的 token 用量、缓存命中率、性能指标（TTFT/TPS）和成本统计，并通过 `/usage` 命令提供多维度的历史数据查询与导出。

v2 重构在保留原有 SQLite 查询层和 `/usage` 命令的基础上，引入模块化架构，新增 11 项功能。

参考项目：
- [opencode-throughput](https://github.com/Howardzhangdqs/opencode-throughput) — 性能指标采集（TTFT/TPS）、JSONL 日志
- [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache) — 缓存命中率可视化、颜色自适应、Token 分布分析
- [magic-context](https://github.com/cortexkit/magic-context/) — 缓存感知设计、后台压缩（未采纳，留作未来参考）

## 2. 功能清单

### 2.1 v2 新增功能

| # | 功能 | 来源 |
|---|------|------|
| 1 | 缓存命中率可视化（进度条 + 颜色编码） | visual-cache |
| 4 | 折叠状态持久化（`api.kv` 存储） | visual-cache |
| 5 | 趋势指示器（命中率 ↑/↓ 变化趋势） | visual-cache |
| 6 | 性能指标采集（TTFT/TPS/延迟） | throughput |
| 8 | Token 分布按角色分解（系统/用户/Agent/Tool/结果） | visual-cache |
| 9 | JSONL 持久日志（`~/.opencode/tokenwatch.jsonl`） | throughput |
| 11 | 多级独立折叠（模型级 + 子区块级） | visual-cache |
| 12 | 模型定价信息展示 | visual-cache |
| 13 | 侧边栏宽度自适应 | visual-cache |
| 14 | i18n 中英双语 | visual-cache |
| 15 | 颜色自适应主题（自动去饱和） | visual-cache |

### 2.2 保留的 v0.1 功能

- `/usage` 命令（多维度报告：按模型/提供商/日期/会话分组）
- 实时侧边栏统计面板
- SQLite 查询层（`opencode db` 子进程）
- JSON/CSV 导出
- 格式化工具（Unicode 表格渲染、数值格式化）

### 2.3 已否决的功能

| # | 功能 | 原因 |
|---|------|------|
| 2 | Toast 通知 | 会影响用户思绪，不采纳 |
| 3 | 缓存费用节省 | 自觉无意义，不采纳 |
| 7 | Finish reason 追踪 | 用户体验价值不高，不采纳 |
| 16 | 上下文压缩与跨会话记忆 | 工程量过大，偏离插件核心定位 |
| 17 | 语义搜索 | 依赖嵌入模型，复杂度高 |
| 19 | 穴居人文本压缩 | 确定性压缩算法需集成到上下文管线，工程复杂 |

### 2.4 待定（留作未来参考）

| # | 功能 | 备注 |
|---|------|------|
| 10 | Benchmark 查询工具 | 依赖 JSONL 基础设施，需等待用户有明确需求 |
| 18 | 桌面伴侣应用 | 工程量大，CLI 插件生态中优先级低 |
| 20 | Git 贡献分析 | 偏离"用量监控"核心定位 |

## 3. 架构设计

### 3.1 模块拆分

```
src/
├── index.ts          ← 插件入口（不变）
├── tui.ts            ← 精简为注册命令/插槽/事件监听，派发到各模块
├── formatter.ts      ← 保留（格式化 + 类型定义），新增 i18n 支持
├── queries.ts        ← 保留（SQL 查询层），基本不变
├── sidebar.tsx       ← 侧边栏渲染（缓存可视化、折叠管理、自适应宽度、颜色自适应、Token 分布）
├── perf-tracker.ts   ← 性能指标采集（TTFT/TPS 计算）+ JSONL 日志写入
├── i18n.ts           ← 国际化文本资源（中/英双语，自动检测 + 配置覆盖）
└── commands.ts       ← 扩展 /usage 命令，新增 settings 子命令
```

### 3.2 数据流

```
message.updated / message.part.updated 事件
  → tui.ts 监听，分发
    → perf-tracker.ts: 计算 TTFT/TPS/latency, 写入 JSONL
    → sidebar.tsx: 刷新侧边栏面板
      → 读取 api.state.session.messages 获取消息列表
      → 按 model 分组聚合 token 数据
      → 计算缓存命中率 + 趋势
      → 渲染各区块 (Cache / Performance / Pricing / Token Distribution)
```

### 3.3 技术选型

- **UI 框架**: `@opentui/solid`（SolidJS + JSX，与 OpenCode TUI 一致）
- **响应式状态**: SolidJS `createSignal` / `createMemo`
- **持久化存储**: `api.kv`（折叠状态）、JSONL 文件（性能日志）
- **对话无关**: 中英文均硬编码在 `i18n.ts` 中，无需翻译服务

### 3.4 渲染策略

侧边栏内容使用 `@opentui/solid` JSX 组件渲染，通过 `api.slots.register` 的 `component` 回调返回 JSX 元素树。不使用字符串拼接。

核心组件层次：
```
<TokenWatchPanel>
  ├── HeaderRow              ← 标题行，全局折叠控制
  ├── SessionSummary         ← 会话总计概要
  ├── For each model:
  │   ├── ModelHeader        ← 模型标题行，模型级折叠控制
  │   ├── ModelSummary       ← 模型概要行
  │   ├── CacheBlock         ← 缓存子区块（条件渲染）
  │   ├── PerformanceBlock   ← 性能子区块（条件渲染）
  │   └── PricingBlock       ← 定价子区块（条件渲染）
  └── TokenDistributionBlock ← 会话级 Token 分布（条件渲染）
```

每个组件内部通过 `createSignal` 管理折叠状态，通过 `createMemo` 实现响应式计算。

## 4. 侧边栏详细设计

### 4.1 布局结构

```
┌─ TokenWatch ──────────────────────────▼─┐  ← 整体折叠/展开
│  会话累计: 输入 65K  输出 12K  缓存 53K  │  ← 折叠态显示概要
│  请求 52  成本 $0.89                     │
│                                          │
│  ▼ claude-sonnet-4-20250229              │  ← 模型级（▶ 折叠 / ▼ 展开）
│    输入:30.5K  输出:892  缓存读:45K      │  ← 概要行（折叠态也显示）
│    命中:85% ↑2.1%  请求:12  成本:$0.023   │
│    ── Cache ───────────────────────▶    │  ← 子区块（默认折叠）
│    ── Performance ─────────────────▶    │
│    ── Pricing ─────────────────────▶    │
│                                          │
│  ▼ deepseek-chat                         │
│    输入:25K  输出:1.2K  缓存读:8K        │
│    命中:20% ↓3.5%  请求:40  成本:$0.012   │
│    ...                                    │
│                                          │
│  ── Token Distribution ────────────▶    │  ← 会话级，默认折叠
└──────────────────────────────────────────┘
```

### 4.2 设计原则

- **无图标**: 所有数据使用纯文本标签，不依赖 Unicode 图标
- **颜色替代图标**: 命中率使用 ANSI 颜色标识（≥85% 绿 / ≥70% 黄 / <70% 红）
- **`▶`/`▼` 指示折叠状态**: 终端中广泛接受的约定
- **进度条使用 Unicode 块字符**: `████░░░░`，与 Claude Code 风格一致
- **标签左对齐，数据右对齐**: 便于快速扫描

### 4.3 折叠层级

| 层级 | 默认状态 | 描述 |
|------|---------|------|
| 整体面板 | 展开 | 控制整个侧边栏显隐，折叠时仅显示标题行 + 概要 |
| 模型级 | 折叠 | 每个模型独立折叠/展开，折叠时显示一行概要 |
| 子区块 (Cache/Performance/Pricing) | 折叠 | 模型展开后可独立展开各子区块 |
| Token Distribution | 折叠 | 会话级别，独立于模型 |

所有折叠状态通过 `api.kv` 持久化，重启后保持。

### 4.4 缓存命中率颜色阈值

| 命中率 | 颜色 | 含义 |
|--------|------|------|
| ≥ 85% | 绿色 | 高效利用缓存 |
| ≥ 70% | 黄色/橙色 | 缓存利用率一般 |
| < 70% | 红色 | 缓存利用率低，需优化 |

v2 初版使用硬编码 ANSI 颜色（绿/黄/红），后续版本（v2.1）将实现从 OpenCode 主题色自动衍生并二分搜索去饱和的 Morandi 风格配色。

## 5. perf-tracker.ts 设计

### 5.1 事件处理流程

```
message.part.updated (TextPart.time.start)
  → 记录 firstPartTime[messageID] = time.start

message.updated (AssistantMessage, role === "assistant")
  → 计算性能指标:
    - latencyMs = time.completed - time.created
    - ttftMs = firstPartTime - time.created（若有 firstPartTime）
    - genMs = time.completed - firstPartTime（若有）
    - tps = outputTokens / (genMs / 1000) 当 genMs > 0 && outputTokens > 0
    - tpsFallback = outputTokens / (latencyMs / 1000) 当 genMs 为 null 但 latencyMs > 0 && outputTokens > 0（标注为 ~tps）

  → 构造 LogEntry，同时:
    a) 同步追加写入 JSONL（fs.appendFileSync，避免并发问题）
    b) 更新内存中 sessionStats Map（供 sidebar 实时读取）
  → 清理 firstPartTime[messageID]

message.removed / 消息中断
  → 清理对应 messageID 在 firstPartTime Map 中的条目（防止内存泄漏）
```

### 5.2 JSONL 日志格式

```typescript
type LogEntry = {
  ts: string                    // ISO 时间戳
  model: string                 // "providerID/modelID"
  providerID: string
  modelID: string
  sessionID: string
  ttft_ms: number | null        // 首 token 延迟
  tps: number | null            // 每秒 token 吞吐量
  latency_ms: number | null     // 端到端延迟
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}
```

日志路径: `~/.opencode/tokenwatch.jsonl`

### 5.3 暴露接口

```typescript
export function getSessionStats(): SessionPerfStats
// 各模型性能统计（计数、均值、最大/最小值）
export function readLogs(last?: number): LogEntry[]
// 从 JSONL 文件读取最近 N 条记录，按时间降序排列
export function createPerfTracker(): PerfTracker
// 创建 PerfTracker 实例（包含 handlePartUpdated / handleMessageUpdated / handleMessageRemoved / reset 方法）
```

### 5.4 稳定性设计

| 风险 | 措施 |
|------|------|
| `firstPartTimes` Map 内存泄漏 | 监听 `message.removed` 事件清理对应 messageID；同时可设上限（如 1000 条）自动淘汰最旧条目 |
| JSONL 写入并发 | 使用 `fs.appendFileSync` 同步写入，单次写入量级极小（一条 JSON 约 200 字节），无性能瓶颈 |
| TPS 无精确数据 | 当流式首字事件不可用时，使用 `latencyMs` 做粗略 TPS 估算，在 UI 中标注 `~` 前缀 |
| 日志文件无限增长 | 当前不做轮转限制。用户可手动清理 `~/.opencode/tokenwatch.jsonl`。后续可引入按大小/天数自动轮转 |

## 6. 配置设计

### 6.1 配置项

```typescript
type TokenWatchConfig = {
  sidebar: {
    showCache: boolean          // 默认 true
    showPerformance: boolean    // 默认 true
    showPricing: boolean        // 默认 true
    showTokenDistribution: boolean // 默认 true
    showTrend: boolean          // 默认 true
  }
  language: "zh" | "en" | "auto"  // 默认 "auto"（跟随系统）
}
```

### 6.2 配置来源（优先级从高到低）

1. `api.kv` 运行时修改（通过 `/usage settings` 命令）
2. `opencode.jsonc` 中的 `pluginConfig["opencode-tokenwatch"]`

## 7. i18n 设计

在 `i18n.ts` 中定义完全的中英文对照表，所有 UI 文本通过函数 `t(key)` 获取。

```typescript
const zh: Record<string, string> = {
  panelTitle: "TokenWatch",
  input: "输入",
  output: "输出",
  cacheRead: "缓存读",
  cacheWrite: "缓存写",
  hitRate: "命中率",
  trendUp: "↑",
  trendDown: "↓",
  requests: "请求",
  cost: "成本",
  // ...
}

const en: Record<string, string> = {
  panelTitle: "TokenWatch",
  input: "Input",
  output: "Output",
  cacheRead: "Cache Read",
  cacheWrite: "Cache Write",
  hitRate: "Hit Rate",
  trendUp: "↑",
  trendDown: "↓",
  requests: "Requests",
  cost: "Cost",
  // ...
}
```

语言检测: `Intl.DateTimeFormat().resolvedOptions().locale`（try-catch 包裹，失败时 fallback 到 `"en"`）。
环境变量 `TOKENWATCH_LANG` 可强制覆盖，配置文件中 `language` 可最终覆盖。

## 8. 影响范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/index.ts` | 不变 | 插件入口不变 |
| `src/tui.ts` | 重构 | 精简为调度层，移除直接逻辑 |
| `src/formatter.ts` | 扩展 | 新增类型定义，新增 i18n 格式化 |
| `src/queries.ts` | 不变 | SQL 查询层不受影响 |
| `src/sidebar.tsx` | 新建 | 侧边栏面板全部逻辑 |
| `src/perf-tracker.ts` | 新建 | 性能采集 + JSONL 日志 |
| `src/i18n.ts` | 新建 | 国际化文本资源 |
| `src/commands.ts` | 新建 | 命令注册逻辑（从 tui.ts 拆分） |

## 9. 验证计划

1. 启动 TUI，确认侧边栏正确渲染各区块
2. 切换模型，确认各模型独立统计正确
3. 发送消息，确认实时更新、趋势指示器工作
4. 修改面板宽度，确认自适应正常
5. 切换语言，确认所有文本正确切换
6. 修改配置项，确认对应区块隐藏/显示
7. 重启 OpenCode，确认折叠状态保持
8. 检查 `~/.opencode/tokenwatch.jsonl` 日志文件存在且格式正确
9. 运行 `tsc` 确认无编译错误
