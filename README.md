# opencode-tokenwatch

[English](./README.en.md) · **简体中文**

OpenCode 实时 Token 用量、缓存命中率和性能指标面板。

在侧边栏实时显示当前会话的各项统计数据，并通过 `/usage` 命令提供维度历史数据查询与 JSON/CSV 导出。

## 功能

- **侧边栏面板** — 会话级和按模型的实时统计（输入/输出/缓存读取）
- **缓存命中率可视化** — 带颜色阈值（绿/黄/红）的进度条，趋势指示器（↑/↓）
- **性能指标** — 首 Token 延迟（TTFT）、每秒 Token 吞吐量（TPS）、端到端延迟
- **Token 分布** — 按角色分解统计（系统提示/用户/Agent 指令/Tool 调用/Tool 结果）
- **模型定价展示** — 当前模型的输入/缓存读单价
- **`/usage` 命令** — 按模型、提供商、日期、会话分组的历史报告
- **`/usage-settings` 命令** — 配置侧边栏显示项
- **多级折叠** — 面板、各模型、子区块（Cache/Performance/Pricing）均可独立折叠
- **折叠状态持久化** — 重启后保持
- **宽度自适应** — 侧边栏宽度变化时自动调整布局
- **JSONL 日志** — 每次请求详情持久化至 `~/.opencode/tokenwatch.jsonl`
- **中英双语** — 自动跟随系统语言，可配置强制覆盖
- **颜色自适应** — 从主题色自动去饱和衍生配色
- **导出** — 完整报告 JSON / CSV

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

在 `pluginConfig` 中可自定义侧边栏显示项和语言（可选）：

```jsonc
{
  "plugin": ["opencode-tokenwatch"],
  "pluginConfig": {
    "opencode-tokenwatch": {
      "sidebar": {
        "showCache": true,
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
| `sidebar.showCache` | boolean | `true` | 显示缓存命中率区块 |
| `sidebar.showPerformance` | boolean | `true` | 显示性能指标区块 |
| `sidebar.showPricing` | boolean | `true` | 显示模型定价区块 |
| `sidebar.showTokenDistribution` | boolean | `true` | 显示 Token 分布区块 |
| `sidebar.showTrend` | boolean | `true` | 显示趋势指示器 |
| `language` | `"auto"` / `"zh"` / `"en"` | `"auto"` | 界面语言，`"auto"` 时跟随系统 |

## 用法

在 OpenCode TUI 中：

1. 打开右侧边栏，实时查看当前会话统计。
2. 输入 `/usage` 查看多维度历史报告。
3. 输入 `/usage-settings` 调整侧边栏显示项。

导出文件生成在工作目录：

- `tokenwatch-usage-report.json`
- `tokenwatch-models.csv`
- `tokenwatch-providers.csv`
- `tokenwatch-daily.csv`
- `tokenwatch-sessions.csv`

## 报告维度

- 按模型分组
- 按提供商分组
- 按日期分组
- 按会话分组
- 当前会话摘要

## 要求

- OpenCode CLI（支持 `opencode db` 命令）
- Node.js 18+

## 构建

```sh
npm install
npm run build
```

## 发布前检查

```sh
npm run release:check
```

在独立临时缓存中执行构建和 `npm pack --dry-run`，对 Windows 环境尤其有用。

## 许可

MIT
