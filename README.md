# opencode-tokenwatch

[English](./README.en.md) · **简体中文**

![Sidebar](./assets/sidebar.png)

OpenCode CLI 的实时 Token 用量统计、缓存分析与性能指标插件。

## 功能

- **侧边栏面板** — 会话级与按模型的实时统计（请求数、Token、缓存、成本）
- **缓存命中率** — 按模型实时追踪，带趋势指示器（↑/↓）与全局加权总计
- **性能指标** — TTFT / TPS / 端到端延迟，含 P50/P95/P99 延迟分位数
- **Token 分布** — 按角色（system / user / tool / output）分解用量占比
- **成本追踪** — 按模型实时显示请求成本（需 provider 返回计费数据）
- **错误率统计** — 识别并统计失败请求，实时计算错误率
- **`/usage` 命令** — HTML 报告 → JSON 导出 → 文本报告 → 设置
- **HTML 报告** — 交互式 ECharts 仪表盘：Token 趋势、性能对比、TPS 排名、错误率分析，自动在浏览器打开
- **持久化统计** — 性能指标永久累积写入独立文件，历史数据不受会话重置影响
- **多级折叠** — 面板、模型、子区块均可折叠，状态持久化
- **语言切换** — 中英双语，跟随系统或手动切换

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

在 OpenCode TUI 中输入 `/usage` → **设置**，可交互式开关各显示项和切换界面语言，配置自动持久化，无需手动编辑配置文件。

## 用法

在 OpenCode TUI 中输入 `/usage`，选择：

- **HTML 报告** — 选择日期范围，生成仪表盘并在浏览器打开
- **JSON 导出** — 导出完整用量数据至 `~/.opencode/reports/`
- **文本报告** — 导出 Markdown 格式至 `~/.opencode/reports/`
- **设置** — 开关侧边栏显示项、切换语言

## 数据文件

| 文件 | 路径 | 说明 |
|------|------|------|
| JSONL 日志 | `~/.opencode/tokenwatch.jsonl` | 原始请求日志 |
| 聚合统计 | `~/.opencode/tokenwatch-stats.json` | 持久化性能统计 |
| 报告输出 | `~/.opencode/reports/` | HTML / JSON / Markdown 报告 |

## 系统要求

- OpenCode CLI（支持 `opencode db` 命令）
- Node.js 18+

## 构建

```sh
npm install
npm run build
```

## 相关项目

- [opencode-throughput](https://github.com/Howardzhangdqs/opencode-throughput) — 实时 LLM 性能监控，采集 TTFT/TPS/延迟和成本
- [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache) — TUI 侧边栏缓存命中率可视化，Token 分布分析
- [magic-context](https://github.com/cortexkit/magic-context/) — 缓存感知的无限上下文 + 跨会话记忆系统

## 许可

MIT
