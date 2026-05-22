# opencode-tokenwatch: `/usage` HTML 报告设计文档

## 1. 概述

为 `/usage` 命令增加 HTML 可视化报告能力，将当前的纯文本表格输出升级为暗色"赛博重工"风格的单页 HTML 仪表盘。报告通过 ECharts 5 CDN 渲染可视化图表，所有数据作为 JSON 内嵌在文件中，可独立在浏览器中打开查看。

## 2. 架构设计

### 2.1 模块拆分

```
src/
├── generate-usage-html.ts    ← 新增：纯函数，接收数据返回 HTML 字符串
├── commands.ts               ← 扩展：/usage 命令新增子命令和参数支持
├── queries.ts                ← 不变
├── formatter.ts              ← 不变（复用类型定义）
├── perf-tracker.ts           ← 不变（复用 readLogs）
├── sidebar.tsx               ← 不变
├── tui.tsx                   ← 不变
└── i18n.ts                   ← 不变
```

### 2.2 数据流

```
用户输入 /usage html
  → commands.ts 解析子命令和参数
  → getUsageReport(filters)          ← SQLite 5 维数据
  → perfTracker.readLogs(1000)       ← JSONL 性能日志
  → 合并为 CombinedReportData
  → generateUsageHtml(data) → HTML 字符串
  → fs.writeFileSync → ~/.opencode/reports/tokenwatch-YYYY-MM-DD.html
  → 自动在浏览器打开
```

### 2.3 关键解耦

`generate-usage-html.ts` 是一个**纯函数**：

```typescript
function generateUsageHtml(data: CombinedReportData): string
```

- 不依赖任何插件 API
- 不执行 IO 操作
- 输入数据，输出 HTML
- 可被独立脚本或测试直接调用

## 3. 数据接口

### 3.1 CombinedReportData

```typescript
interface CombinedReportData {
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  providers: ProviderBreakdownItem[]
  daily: DailyBreakdownItem[]
  sessions: SessionBreakdownItem[]
  perfLogs: LogEntry[]
  generatedAt: string             // ISO 时间戳
  dateRange: { start: string; end: string }
}
```

数据来源：
| 字段 | 来源 | 备注 |
|------|------|------|
| summary / models / providers / daily / sessions | `getUsageReport()` queries.ts | 已有 |
| perfLogs | `perfTracker.readLogs(1000)` perf-tracker.ts | 已有，取最近 1000 条 |
| generatedAt / dateRange | `commands.ts` 组装 | 新增 |

## 4. 命令设计

### 4.1 子命令结构

```
/usage <subcommand> [flags]

子命令:
  html       生成 HTML 报告（默认，可省略）
  json       导出 JSON
  csv        导出 CSV
  text       传统文本报告（向后兼容）
  settings   查看/修改侧边栏配置

可选 flags:
  --days <N>            最近 N 天
  --provider <name>     按提供商筛选
  --model <name>        按模型筛选
  --no-open             只保存不打开浏览器
  --interactive         交互式向导模式
  --output <path>       指定输出路径

缩写:
  -d <N>     = --days <N>
  -p <name>  = --provider <name>
  -m <name>  = --model <name>
  -o <path>  = --output <path>

示例:
  /usage                          全量 HTML 报告，自动打开
  /usage html --days 7            最近 7 天
  /usage html -p opencode         只看 opencode 提供商
  /usage html --no-open           只保存不打开
  /usage json --days 30           导出最近 30 天 JSON
  /usage settings                 查看配置
  /usage settings --lang en       切换语言
  /usage settings --show-perf off 关闭性能显示
```

### 4.2 默认行为

- 不带子命令时默认为 `html`
- 报告保存到 `~/.opencode/reports/tokenwatch-YYYY-MM-DD.html`
- 自动在系统默认浏览器打开（除非 `--no-open`）
- 没有过滤器时使用全量历史数据

### 4.3 兼容性

- `/usage-settings` 继续作为 `/usage settings` 的别名存在
- `/usage` 传统纯文本输出转移到 `/usage text`

## 5. 页面设计

### 5.1 审美定位

**赛博重工 (Data Industrial)** 风格：
- 深邃黑背景 `#0C0C0E`，碳灰卡片 `#16161A`
- 颜色语义化：霓虹绿(缓存) `#00F593` / 电光蓝(输入) `#00D1FF` / 赛博紫(输出) `#B545FF`
- 等宽字体 JetBrains Mono 用于数据表格
- 无衬线字体 Inter/Geist 用于标题标签

### 5.2 页面布局

```
┌────────────────────────────────────────────────────────────┐
│ Header: TokenWatch · 时间范围 · 生成时间                     │
├─ 区域一：全局 KPI 指标行 ───────────────────────────────────┤
│  Total Tokens | Cache Hit% (光晕) | Total Cost | Requests  │
├─ 区域二：多模型对比矩阵 ────────────────────────────────────┤
│  堆叠柱状图(紫输出+蓝输入+绿缓存) + TPS 金色折线            │
│  [Toggle: 绝对值 / 占比]                                    │
├─ 区域三：效能与成本散点图 ──────────────────────────────────┤
│  X轴: TTFT | Y轴: 千Token成本 | 气泡: 请求频次             │
│  条件渲染：无性能数据时隐藏，显示说明卡片                     │
├─ Provider 摘要卡片行 ───────────────────────────────────────┤
│  每提供商一张卡片：Tokens · Cost · Avg TTFT · Avg TPS · Models│
├─ 区域四：详细数据表 ─────────────────────────────────────────┤
│  模型名 | 请求 | 输入 | 输出 | 缓存 | 命中率 | 成本 | TTFT | TPS│
│  右对齐，命中率高的行轻微高亮                                 │
├─ 区域五：日趋势折线图 ──────────────────────────────────────┤
│  每日 Token 消耗 + dataZoom 时间轴缩放                       │
│  [Tab: 日趋势 / 热力图(calendar)]                            │
├─ Footer ────────────────────────────────────────────────────┤
│  生成时间 · 数据来源: SQLite + JSONL · 导出: JSON / CSV     │
└────────────────────────────────────────────────────────────┘
```

### 5.3 区域二详细设计

**堆叠柱状图**（绝对值堆叠）：
- X 轴：模型名称，按总 Token 降序排列
- 柱状图从下到上：输出(紫) + 输入(蓝) + 缓存读(绿)
- 缓存段内标注：`${cacheHitRate}%`（基于 `cacheRead / (input + cacheRead)`）
- 拐点标记：缓存命中率 ≥85% 绿色、≥70% 黄色、<70% 红色

**TPS 折线**：
- 右 Y 轴，金色 (#FFB800)
- 标记每个模型的平均 TPS

**Toggle 切换**：绝对值 ↔ 占比（ECharts 的 `barStack` 切换为 `barStack` + `barPercent`）

### 5.4 区域三详细设计

**散点图**：
- X 轴：平均 TTFT（首字延迟，ms）
- Y 轴：千 Token 综合成本（USD / (totalTokens/1000)）
- 气泡大小：映射为该模型的请求次数
- 颜色：按提供商分组
- 交互 Tooltip：模型名、提供商、TTFT、TPS、Latency、千Token成本、请求数
- 高性价比区域标记（左下半区）：添加视觉提示矩形

**条件渲染**：
- 所有模型的性能数据均为 null → 显示说明卡片
- 部分模型有数据 → 仅显示有数据的模型

### 5.5 Provider 卡片设计

紧凑的横向卡片行，每张卡片内容：
```
┌─ opencode ─────────────────┐
│  Tokens: 114.3M  Cost: $0  │
│  Avg TTFT: 0.8s            │
│  Avg TPS: 48.2             │
│  Models: 3                  │
└────────────────────────────┘
```
- 性能指标为该提供商下所有模型按**请求量加权平均**
- 卡片边框色使用对应颜色最接近的语义色

### 5.6 区域五详细设计

默认显示**迷你折线图**：
- X 轴：日期
- Y 轴：每日 Token 总量
- ECharts dataZoom 组件支持时间轴缩放

可选 Tab 切换至**热力图**：
- 使用 ECharts calendar 组件
- 每个日期格子的颜色深度 = Token 使用量
- 与 GitHub 贡献热力图视觉一致

### 5.7 条件渲染规则

| 条件 | 行为 |
|------|------|
| 所有模型 perf 数据为 null | 区域三隐藏，显示说明卡片 |
| 部分模型有 perf 数据 | 区域三仅展示有数据的模型点 |
| 仅 1 个提供商 | Provider 卡片行只显示一张卡片 |
| 无 daily 数据 | 区域五隐藏 |
| 报告数据为空 | 显示空状态提示 |

## 6. 技术选型

| 层面 | 选择 | 原因 |
|------|------|------|
| 图表库 | ECharts 5 (CDN) | 图表丰富、主题系统成熟、交互完整 |
| 数据注入 | `<script id="report-data" type="application/json">` | 页面加载时 JS 解析，支持导出 |
| 字体 | JetBrains Mono (CDN) + 系统无衬线体 | 等宽体保证数据对齐严谨 |
| 布局 | CSS Grid + Flexbox | 自适应，无需框架 |
| 打开方式 | `start` (Windows) / `open` (macOS) | 跨平台系统命令 |
| 文件命名 | `tokenwatch-YYYY-MM-DD.html` | 按日期区分，避免覆盖 |

## 7. 测试策略

| 测试场景 | 方法 |
|---------|------|
| HTML 生成 | 调用 `generateUsageHtml(mockData)` 验证输出字符串包含关键元素 |
| 数据正确性 | 注入已知数据，验证图表 DOM 中的数据序列匹配 |
| 空数据处理 | 空数组、全 null 性能数据 |
| 大文件处理 | 100+ 模型、1000+ 天数据 |
| 命令解析 | 各种参数组合的解析结果 |

## 8. 影响范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/generate-usage-html.ts` | 新建 | ~400 行 HTML 模板 + ECharts 初始化脚本 |
| `src/commands.ts` | 重构 | 新增子命令解析 + 参数处理逻辑 |
| `src/formatter.ts` | 可能扩展 | 如需新增类型定义 |

## 9. 否决的功能

| 功能 | 原因 |
|------|------|
| 多页面/分页报告 | 单页足够展示所有维度，分页增加复杂性 |
| 自定义配色编辑器 | 偏离核心定位，颜色在模板中硬编码 |
| 实时刷新 | HTML 是静态快照，实时性由侧边栏提供 |
| PDF 导出 | 需要额外库，HTML 打开后用户可自行打印为 PDF |
