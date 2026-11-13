# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.1] - 2026-11-13

### Fixed
- **host/runtime**: 修复多模型会话重进后只剩单模型的严重缺陷。改用消息 ID 幂等增量合并机制，重构短轮询为渐进式稳定轮询，彻底杜绝单条残卷截断轮询并覆写覆盖历史缓存的问题。
- **host/runtime**: 修复全端落盘机制瘫痪导致的历史指标无法恢复问题。保持 TUI 客户端对本地完整流式会话指标的权威持久化落盘，确保 TPS、TTFT 与活跃耗时数据永不丢盘。
- **ui/sidebar**: 修复侧边栏模型专属性能指标的模糊匹配串位漏洞。实施严格的 Provider 隔离与叶子模型全等匹配，杜绝跨 Provider 错位或子串贪婪匹配。
- **host/v2**: 在单步开始（`step.started`）与结束（`step.ended`）多级缓存模型归属，强化消息 model 字段解析降级链，防止多模型切换场景下模型信息降级为 `unknown`。

## [0.7.0] - 2026-11-13

### Added
- **server**: 新增 Server 端采集模块（`src/server.ts`），在后台统一捕获 Desktop、CLI、API 各客户端的 Token 与性能指标，并写入本地日志文件。
- **kernel**: 新增 `server-state.ts` 跨进程探测机制，Server 运行时 TUI 客户端自动关闭日志重复写入，避免并发文件竞争。

### Changed
- **ui/sidebar**: 侧边栏多模型列表中，每个模型卡片固定展示专属的 `~TPS`（活跃耗时加权）与 `~TTFT` 统计。
- **report-html**: 移除 Model Comparison Matrix 图表硬编码的 1M Token 门槛，改为按 Token 降序展示 Top 15 模型。

### Fixed
- **host/v2**: 重构客户端扫描数据源为消息级摘要模型（`AssistantMessageRecord`），实现全维度动态聚合，修复非“全部时间”报告中除顶部 KPI 外所有图表按全量历史汇总的缺陷。
- **report**: 修复 HTML 报告的 Efficiency vs Cost 与 Latency 表格泄漏历史非活跃模型的问题。
- **report**: 修复内嵌与导出的 `perfLogs` 未遵从所选时间窗口过滤的问题。

## [0.6.3] - 2026-11-11

### Fixed
- **kernel/perf**: 对齐 OpenCode 官方 TPS 口径，单步按 `(outputTokens + reasoningTokens) / activeMs * 1000` 计算，会话与报告按活跃耗时加权计算，移除排队时间造成的低估。
- **kernel/perf**: 独立保留端到端延迟字段 `latency_ms`（`completed - created`），不与活跃耗时混淆。

## [0.6.2] - 2026-10-30

### Fixed
- **server**: 移除 `server.ts` 内对 `./tui.js` 的动态加载，避免 opencode2 Server 进程加载 `@opentui` 单例抛出描述冲突错误。
- **build**: 构建脚本增加反向断言，确保 `dist/server.js` 零引用 `@opentui` 与 TUI 模块。

## [0.6.1] - 2026-09-20

### Fixed
- **package**: 调整依赖声明，解决特定包管理器环境下 `@opentui` 依赖缺失问题。

## [0.6.0] - 2026-09-20

### Added
- **host**: 支持 OpenCode v1 与 v2 双宿主架构，按加载入口自动识别代际。
- **host/v2**: 新增 v2 适配层，接入 Keymap layer、Dialog select 及全量客户端会话消息扫描。
- **kernel/store**: 新增 `store.ts`，聚合统计原子写入临时文件并 rename 替换，脱离 JSONL 轮转限制。

### Changed
- **refactor**: 拆分内核层（`src/kernel/`）与宿主层（`src/host/`），内核层保持零宿主依赖。

### Fixed
- **host/v1**: SQL 查询增加单引号翻倍与 shell 元字符清洗，防范命令行注入。
- **kernel/perf**: KV 持久化增加 500ms 写节流与 MRU 索引淘汰，限制最多保留 20 个会话。

## [0.4.0] - 2026-07-07

### Added
- **report-html**: Model Analytics 表格增加分页控件（每页 10 行）。
- **report-html**: Provider Summary 限制展示 Top 10 并添加折叠提示。

### Changed
- **report-html**: Model Analytics 表格合并为 Tab 切换展示（Usage Breakdown / Latency Percentiles / Failed Requests）。

### Fixed
- **config**: 移除已废弃的配置项引用，统一通过 `/usage` 菜单进行设置。

## [0.3.2] - 2026-06-29

### Changed
- **ui/sidebar**: 模型列表排序改为按最近调用时间降序。
- **ui/sidebar**: 供应商名称超过 12 字符时截断并加省略号。

### Fixed
- **all**: 全链路过滤全零 Token 请求，避免失败与空会话污染统计。

## [0.3.1] - 2026-06-12

### Fixed
- **ui/sidebar**: 修复会话中切换模型时侧边栏统计未能即时更新的问题。

## [0.3.0] - 2026-06-08

### Added
- **kernel/perf**: 新增 P50/P95/P99 TTFT 与端到端延迟分位数估算（Reservoir Sampling）。
- **kernel/perf**: 新增失败请求追踪与错误率统计。
- **report-html**: 新增失败请求明细表与错误率 KPI 卡片。

### Fixed
- **kernel/perf**: 修正均值计算分母，使用有效样本计数代替请求总数。
- **kernel/perf**: TTFT 取最早输出 part 时间，避免被后续 part 覆盖高估。

## [0.2.0] - 2026-05-22

### Added
- **report-html**: 新增基于 ECharts 的独立 HTML 用量报告与浏览器自动打开功能。
- **commands**: `/usage` 命令支持 HTML、JSON、Markdown 多格式导出。
- **kernel/perf**: 引入 JSONL 本地日志记录（`~/.opencode/tokenwatch.jsonl`）。
- **ui/sidebar**: 支持国际化语言切换与侧边栏区块折叠。

## [0.1.0] - 2026-05-15

### Added
- 初始版本发布。
- 支持 OpenCode CLI v1 TUI 侧边栏实时 Token 用量统计（五分量 Token、缓存命中率）。
- 支持 `/usage` 命令查询历史用量汇总。
