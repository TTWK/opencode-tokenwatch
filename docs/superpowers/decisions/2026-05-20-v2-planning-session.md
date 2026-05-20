# v2 规划会话摘要

> 日期: 2026-05-20
> 参与: 用户 + opencode agent
> 目的: 基于三个参考项目的调研结果，确定 opencode-tokenwatch v2 的功能范围和设计方案

## 参考项目调研

本项目调研了三个开源项目作为参考：
- **[opencode-throughput](https://github.com/Howardzhangdqs/opencode-throughput)** — 实时 LLM 性能监控，采集 TTFT/TPS/延迟和成本，支持 Toast 通知、JSONL 日志和 AI agent 可查询的 Benchmark 工具
- **[opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache)** — TUI 侧边栏缓存命中率可视化，含自适应颜色去饱和算法、Token 分布分析、折叠状态持久化、中英双语、模型定价显示
- **[magic-context](https://github.com/cortexkit/magic-context/) (⭐ 663)** — 缓存感知的无限上下文 + 跨会话记忆系统，含后台 historians agent、穴居人压缩、语义搜索、桌面应用

## 最终决策

### 支持实现（11 项）

| # | 功能 | 参考来源 | 优先级 |
|---|------|----------|--------|
| 1 | 缓存命中率可视化（进度条 + 颜色阈值） | visual-cache | 高 |
| 4 | 折叠状态持久化 | visual-cache | 高 |
| 5 | 趋势指示器（命中率 ↑/↓） | visual-cache | 高 |
| 6 | 性能指标采集（TTFT/TPS/延迟） | throughput | 高 |
| 8 | Token 分布按角色分解 | visual-cache | 中 |
| 9 | JSONL 持久日志 | throughput | 高 |
| 11 | 多级独立折叠 | visual-cache | 中 |
| 12 | 模型定价信息展示 | visual-cache | 中 |
| 13 | 侧边栏宽度自适应 | visual-cache | 中 |
| 14 | i18n 中英双语 | visual-cache | 中 |
| 15 | 颜色自适应主题（自动去饱和） | visual-cache | 中 |

### 否决（当前不考虑）

| # | 功能 | 否决理由 |
|---|------|---------|
| 2 | Toast 通知 | 影响用户思绪 |
| 3 | 缓存费用节省 | 自觉无意义 |
| 7 | Finish reason 追踪 | 价值不高 |
| 16 | 上下文压缩与跨会话记忆 | 工程量大、偏离核心定位 |
| 17 | 语义搜索 | 依赖嵌入模型、复杂度高 |
| 19 | 穴居人文本压缩 | 集成到上下文管线复杂 |

### 待定（留作未来参考）

| # | 功能 | 备注 |
|---|------|------|
| 10 | Benchmark 查询工具 | 依赖 JSONL，等有明确需求 |
| 18 | 桌面伴侣应用 | 工程量大，CLI 生态中优先级低 |
| 20 | Git 贡献分析 | 偏离"用量监控"核心定位 |

### 关于用户劝说的讨论

- **#5 趋势指示器**: 原为待定，Agent 以"极低成本、高信息密度"为由劝说，用户同意改为支持
- **#6 性能指标采集**: 原为待定，Agent 以"从用量监控跨越到性能监控的分水岭功能"为由劝说，用户同意改为支持
- **#9 JSONL 持久日志**: 原为待定，Agent 以"基础设施投资，30 行代码解锁无限分析可能"为由劝说，用户同意改为支持
- **#12 模型定价展示**: 原为待定，Agent 劝说后用户同意

## 架构决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 项目结构 | 单体 vs 模块拆分 | **模块拆分** | 开源项目需要健康工程规范，方便共建和 Code Review |
| 侧边栏一级维度 | 功能区块 vs 模型 | **模型** | 会话可能跨多个模型，用户需要按模型了解各自用量 |
| 数据展示 | 图标 vs 纯文本标签 | **纯文本标签** | 终端中图标阅读体验差，改用 ANSI 颜色作为视觉线索 |
| 折叠层次 | 单层 vs 双层 | **双层**（模型 + 子区块） | 子区块默认折叠，折叠时展示关键概要统计 |
| 配置方式 | JSON 配置 vs TUI 菜单 | **两者都支持** | JSON 做持久化 + TUI 菜单做快捷修改 |

## 设计原则

1. **模型为第一维度**: 侧边栏先按模型分组，每个模型下再分子区块
2. **无图标，纯文本标签**: 所有数据字段用中文/英文文字标识
3. **颜色替代图标**: 命中率三色阈值（≥85% 绿 / ≥70% 黄 / <70% 红）
4. **`▶`/`▼` 作为折叠指示器**: 终端中广泛接受的约定
5. **双层折叠 + 状态持久化**: 模型级折叠 + 子区块折叠，重启后保持

## 配置项

```typescript
type TokenWatchConfig = {
  sidebar: {
    showCache: boolean
    showPerformance: boolean
    showPricing: boolean
    showTokenDistribution: boolean
    showTrend: boolean
  }
  language: "zh" | "en" | "auto"  // 默认 auto，跟随系统
}
```

## 后续步骤

1. ~清理旧文档，写入新设计文档（已完成）~
2. 写入实施计划文档
3. 按计划逐步实现各模块
4. 验证（编译 + 手动测试）
