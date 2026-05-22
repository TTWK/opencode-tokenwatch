# opencode-tokenwatch

[English](./README.en.md) · **简体中文**

实时 Token 用量、缓存分析与性能指标面板，专为 OpenCode CLI 打造。

在侧边栏实时显示当前会话统计，通过 `/usage` 命令查看历史报告并导出。

## 功能

- **侧边栏面板** — 会话级与按模型的实时统计（请求数、输入/输出 Token、缓存、耗时、成本）
- **缓存命中率可视化** — 模型行内彩色进度条（绿/黄/红阈值），带趋势指示器（↑/↓）
- **性能指标** — 首 Token 延迟（TTFT）、每秒 Token 吞吐量（TPS）、端到端延迟
- **Token 分布** — 按角色分解（系统提示/用户/Agent指令/Tool调用/Tool结果/输出）
- **模型定价** — 当前模型的输入/缓存读/输出单价
- **`/usage` 命令** — 一键进入主菜单：HTML 报告 → JSON 导出 → 文本报告 → 设置
- **HTML 报告** — 交互式 ECharts 仪表盘，含 KPI 卡片、堆叠柱状图、散点图，自动在浏览器打开
- **多级折叠** — 面板、各模型、子区块（性能/定价/Token分布）均可独立折叠，关闭后保持
- **语言切换** — 中英双语，自动跟随系统语言，支持在设置菜单中强制切换
- **性能追踪** — 每次请求的 TTFT/TPS/延迟持久化至 JSONL，用于报告中的性能分析
- **自适应配色** — 主题色自动去饱和衍生配色

## 安装

```sh
npm install opencode-tokenwatch
```

在 `opencode.json` 或 `opencode.jsonc` 中添加：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-tokenwatch"]
}
```

## 配置

通过 `pluginConfig` 可选配置侧边栏显示项和语言：

```jsonc
{
  "plugin": ["opencode-tokenwatch"],
  "pluginConfig": {
    "opencode-tokenwatch": {
      "sidebar": {
        "showPerformance": true,
        "showPricing": false,
        "showTokenDistribution": false,
        "showTrend": true
      },
      "language": "auto"
    }
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `sidebar.showPerformance` | boolean | `true` | 显示性能指标区块（TTFT/TPS/延迟） |
| `sidebar.showPricing` | boolean | `true` | 显示模型定价区块 |
| `sidebar.showTokenDistribution` | boolean | `true` | 显示 Token 分布区块 |
| `sidebar.showTrend` | boolean | `true` | 显示趋势指示器 |
| `language` | `"auto"` / `"zh"` / `"en"` | `"auto"` | 界面语言，`"auto"` 时跟随系统 |

运行时也可通过 `/usage` → 设置 菜单交互式调整，优先级高于 `pluginConfig`。

## 用法

在 OpenCode TUI 中：

1. 打开右侧边栏，实时查看当前会话统计
2. 输入 `/usage` 调出主菜单，选择：
   - **HTML 报告** — 选择日期范围（今天/7天/30天/全部），自动生成交互式仪表盘并在浏览器打开
   - **JSON 导出** — 导出完整用量数据至 `~/.opencode/reports/`
   - **文本报告** — 导出 Markdown 格式报告至 `~/.opencode/reports/`
   - **设置** — 开关侧边栏显示项、切换界面语言

## 报告维度

查询 OpenCode 本地 SQLite 数据库，按以下维度聚合：

- 按模型分组
- 按提供商分组
- 按日期分组（趋势分析）
- 按会话分组
- 当前会话摘要

## 系统要求

- OpenCode CLI（支持 `opencode db` 命令）
- Node.js 18+

## 构建

```sh
npm install
npm run build
```

## 许可

MIT
