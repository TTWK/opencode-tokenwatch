# `/usage` HTML 报告实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `/usage` 命令增加 HTML 可视化报告生成能力，输出暗色"赛博重工"风格的单页仪表盘

**架构:** 新增 `generate-usage-html.ts` 纯函数（数据入→HTML出），由 `commands.ts` 中的 `/usage` 命令收集数据后调用。HTML 内嵌 ECharts 5 CDN + JSON 数据，完全自包含。

**Tech Stack:** TypeScript, ECharts 5 (CDN), JetBrains Mono + Inter (Google Fonts), CSS Grid + Flexbox

**API 约束:** OpenCode TUI 插件 API 的 `onSelect` 回调不支持命令行参数。因此 `/usage` 命令按功能拆分为多个独立 slash 命令注册。

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `src/formatter.ts` | 扩展 | 新增 `CombinedReportData` 类型 |
| `src/generate-usage-html.ts` | 新建 | HTML 报告模板引擎，纯函数 |
| `src/commands.ts` | 重构 | 注册 `/usage-html` `/usage-json` `/usage-text`，触发生成流程 |

---

### Task 1: 新增 CombinedReportData 类型

**Files:**
- Modify: `src/formatter.ts:396-455`（在文件末尾 v2 类型区域之后）

- [ ] **Step 1: 在 formatter.ts 末尾添加 CombinedReportData 和 HtmlReportMeta 类型**

```typescript
// ── HTML report types ──

export interface HtmlReportMeta {
  generatedAt: string
  dateRange: { start: string; end: string }
}

export interface CombinedReportData {
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  providers: ProviderBreakdownItem[]
  daily: DailyBreakdownItem[]
  sessions: SessionBreakdownItem[]
  perfLogs: import("./perf-tracker.js").LogEntry[]
  perfSummary: import("./perf-tracker.js").ModelPerfStats[]
  meta: HtmlReportMeta
}
```

注意 `LogEntry` 和 `ModelPerfStats` 在 `perf-tracker.ts` 中定义，使用 `import()` 类型引用避免循环依赖。

- [ ] **Step 2: 确认类型导出正确**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add src/formatter.ts
git commit -m "feat: add CombinedReportData type for HTML report"
```

---

### Task 2: 创建 generate-usage-html.ts — HTML 报告生成器

**Files:**
- Create: `src/generate-usage-html.ts`

这是核心模块，一个纯函数 `generateUsageHtml(data: CombinedReportData): string`。

文件中包含：
1. 格式化辅助函数（Token/成本/百分比格式化，复用 formatter.ts 的 formatTokens/formatCost）
2. 模板常量（CSS 样式字符串、HTML 结构字符串）
3. 核心函数 `generateUsageHtml`

- [ ] **Step 1: 创建文件骨架，导入依赖，定义辅助函数**

```typescript
import type { CombinedReportData } from "./formatter.js"
import type { ModelBreakdownItem, ProviderBreakdownItem, DailyBreakdownItem } from "./formatter.js"

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

function fmtCost(n: number): string {
  if (n < 0.01) return "$" + n.toFixed(6)
  return "$" + n.toFixed(4)
}

function fmtPercent(n: number): string {
  return (n * 100).toFixed(1) + "%"
}

function cacheHitRate(input: number, cacheRead: number): number {
  if (input + cacheRead === 0) return 0
  return cacheRead / (input + cacheRead)
}

// 计算模型按请求量的降序排列
function sortModelsByUsage(models: ModelBreakdownItem[]): ModelBreakdownItem[] {
  return [...models].sort((a, b) => b.totalTokens - a.totalTokens)
}
```

- [ ] **Step 2: 编写 CSS 常量**

```typescript
const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0C0C0E;
  color: #E4E4E7;
  font-family: 'Inter', -apple-system, sans-serif;
  min-height: 100vh;
  padding: 32px 48px;
}
.container { max-width: 1440px; margin: 0 auto; }

/* Header */
.header { margin-bottom: 32px; }
.header h1 {
  font-size: 28px;
  font-weight: 700;
  color: #FFFFFF;
  letter-spacing: -0.5px;
}
.header .meta {
  font-size: 14px;
  color: #787880;
  margin-top: 4px;
  font-family: 'JetBrains Mono', monospace;
}

/* KPI Cards */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}
.kpi-card {
  background: #16161A;
  border: 1px solid #2A2A35;
  border-radius: 12px;
  padding: 20px 24px;
}
.kpi-card .label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #787880;
  margin-bottom: 8px;
}
.kpi-card .value {
  font-size: 32px;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: -1px;
}
.kpi-card .value.green { color: #00F593; }
.kpi-card .value.blue  { color: #00D1FF; }
.kpi-card .value.purple { color: #B545FF; }
.kpi-card .value.gold  { color: #FFB800; }
.kpi-card .value.white { color: #FFFFFF; }

/* Hit Rate with glow */
.hit-rate-glow {
  text-shadow: 0 0 20px rgba(0, 245, 147, 0.4);
}

/* Section headers */
.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #FFFFFF;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #2A2A35;
}
.section {
  background: #16161A;
  border: 1px solid #2A2A35;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

/* Chart containers */
.chart { width: 100%; height: 400px; }

/* Provider cards */
.provider-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.provider-card {
  background: #16161A;
  border: 1px solid #2A2A35;
  border-radius: 10px;
  padding: 16px 20px;
}
.provider-card .name {
  font-size: 14px;
  font-weight: 600;
  color: #FFFFFF;
  margin-bottom: 8px;
}
.provider-card .stat {
  font-size: 12px;
  color: #787880;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.8;
}
.provider-card .stat span { color: #E4E4E7; }

/* Data table */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
}
.data-table th {
  text-align: right;
  padding: 10px 12px;
  border-bottom: 1px solid #2A2A35;
  color: #787880;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
.data-table th:first-child { text-align: left; }
.data-table td {
  text-align: right;
  padding: 10px 12px;
  border-bottom: 1px solid #1A1A22;
  white-space: nowrap;
}
.data-table td:first-child { text-align: left; }
.data-table tr:hover td { background: #1E1E28; }
.data-table td.high-hit-rate { color: #00F593; }
.data-table td.mid-hit-rate { color: #FFB800; }
.data-table td.low-hit-rate { color: #FF4444; }

/* Tabs */
.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}
.tab-btn {
  padding: 8px 20px;
  background: transparent;
  border: 1px solid #2A2A35;
  border-radius: 8px;
  color: #787880;
  font-size: 13px;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  transition: all 0.2s;
}
.tab-btn.active {
  background: #2A2A35;
  color: #FFFFFF;
  border-color: #3A3A45;
}
.tab-btn:hover { color: #E4E4E7; }
.tab-content { display: none; }
.tab-content.active { display: block; }

/* Toggle */
.toggle-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.toggle-btn {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid #2A2A35;
  border-radius: 6px;
  color: #787880;
  font-size: 12px;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
}
.toggle-btn.active {
  background: #2A2A35;
  color: #FFFFFF;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: #787880;
}
.empty-state .icon { font-size: 48px; margin-bottom: 16px; }
.empty-state .msg { font-size: 16px; }

/* Footer */
.footer {
  text-align: center;
  padding: 24px;
  color: #505058;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}

@media (max-width: 768px) {
  body { padding: 16px; }
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .provider-row { grid-template-columns: 1fr; }
}
`
```

- [ ] **Step 3: 编写 `renderKpiCards` — KPI 卡片行**

```typescript
function renderKpiCards(data: CombinedReportData): string {
  const s = data.summary
  const rate = cacheHitRate(s.inputTokens, s.cacheRead)
  const ratePct = fmtPercent(rate)

  // 计算平均 TPS：从 perfSummary 中取有数据的模型的均值
  const perfModels = data.perfSummary.filter(p => p.avgTPS !== null)
  const avgTps = perfModels.length > 0
    ? (perfModels.reduce((sum, p) => sum + (p.avgTPS ?? 0), 0) / perfModels.length).toFixed(1)
    : "—"

  return `
<div class="kpi-row">
  <div class="kpi-card">
    <div class="label">Total Tokens</div>
    <div class="value blue">${fmtTokens(s.totalTokens)}</div>
  </div>
  <div class="kpi-card">
    <div class="label">Cache Hit Rate</div>
    <div class="value green hit-rate-glow">${ratePct}</div>
  </div>
  <div class="kpi-card">
    <div class="label">Total Cost</div>
    <div class="value gold">${fmtCost(s.totalCost)}</div>
  </div>
  <div class="kpi-card">
    <div class="label">Requests</div>
    <div class="value white">${s.requestCount}</div>
  </div>
  <div class="kpi-card">
    <div class="label">Avg TPS</div>
    <div class="value purple">${avgTps}</div>
  </div>
</div>`
}
```

- [ ] **Step 4: 编写 `renderModelChart` — 区域二：堆叠柱状图 + TPS 折线**

```typescript
function renderModelChartInit(data: CombinedReportData): string {
  const sorted = sortModelsByUsage(data.models)
  const names = sorted.map(m => m.model.length > 25 ? m.model.slice(0, 22) + "..." : m.model)
  const outputs = sorted.map(m => m.outputTokens)
  const inputs = sorted.map(m => m.inputTokens)
  const caches = sorted.map(m => m.cacheRead)
  const rates = sorted.map(m => cacheHitRate(m.inputTokens, m.cacheRead))
  const rateLabels = rates.map(r => fmtPercent(r))

  // TPS 数据：从 perfSummary 中按模型匹配
  const tpsData = sorted.map(m => {
    const perf = data.perfSummary.find(p => p.model === m.model || p.model === `${m.provider}/${m.model}`)
    return perf?.avgTPS ?? null
  })

  const chartId = "chart-model"
  const toggleFn = `toggleStack${chartId.charAt(0).toUpperCase() + chartId.slice(1)}`

  return `
<div class="toggle-bar">
  <span style="font-size:12px;color:#787880">Stack Mode:</span>
  <button class="toggle-btn active" onclick="setStackMode('absolute')">Absolute</button>
  <button class="toggle-btn" onclick="setStackMode('percent')">Percent</button>
</div>
<div id="${chartId}" class="chart"></div>
<script>
(function() {
  var chart = echarts.init(document.getElementById('${chartId}'));
  var data = ${JSON.stringify({ names, outputs, inputs, caches, rates: rateLabels, tpsData, rawRates: rates })};
  var currentMode = 'absolute';
  window.setStackMode = function(mode) {
    currentMode = mode;
    chart.setOption(buildOption(mode));
    document.querySelectorAll('.toggle-btn').forEach(function(b) {
      b.classList.toggle('active', b.textContent.toLowerCase() === mode);
    });
  };
  function buildOption(mode) {
    var isPercent = mode === 'percent';
    var series = [
      {
        name: 'Output',
        type: 'bar',
        stack: 'total',
        color: '#B545FF',
        data: data.outputs,
        label: { show: false }
      },
      {
        name: 'Input',
        type: 'bar',
        stack: 'total',
        color: '#00D1FF',
        data: data.inputs,
        label: { show: false }
      },
      {
        name: 'Cache Read',
        type: 'bar',
        stack: 'total',
        color: '#00F593',
        data: data.caches,
        label: {
          show: true,
          position: 'inside',
          formatter: function(p) { return data.rates[p.dataIndex]; },
          color: '#0C0C0E',
          fontWeight: 700,
          fontSize: 11
        }
      },
      {
        name: 'Avg TPS',
        type: 'line',
        yAxisIndex: 1,
        color: '#FFB800',
        data: data.tpsData,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2 },
        label: {
          show: true,
          formatter: function(p) { return p.value != null ? p.value.toFixed(1) : ''; },
          color: '#FFB800',
          fontSize: 10
        }
      }
    ];
    if (isPercent) {
      series.forEach(function(s) { if (s.stack === 'total') { delete s.stack; s.stack = 'percent'; } });
    }
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function(params) {
          var idx = params[0].dataIndex;
          var lines = ['<b>' + data.names[idx] + '</b>'];
          params.forEach(function(p) {
            if (p.seriesName === 'Avg TPS') {
              lines.push(p.seriesName + ': ' + (p.value != null ? p.value.toFixed(1) : '—'));
            } else {
              lines.push(p.seriesName + ': ' + fmt(p.value));
            }
          });
          lines.push('Cache Hit: ' + data.rates[idx]);
          return lines.join('<br>');
        }
      },
      legend: { data: ['Output', 'Input', 'Cache Read', 'Avg TPS'], textStyle: { color: '#787880' } },
      grid: [
        { left: 60, right: 60, bottom: 60, top: 40 },
        { left: 60, right: 60, bottom: 60, top: 40 }
      ],
      xAxis: {
        type: 'category',
        data: data.names,
        axisLabel: { color: '#787880', fontSize: 10, rotate: 30 },
        axisLine: { lineStyle: { color: '#2A2A35' } }
      },
      yAxis: [
        {
          type: 'value',
          name: 'Tokens',
          nameTextStyle: { color: '#787880', fontSize: 11 },
          axisLabel: { color: '#787880', formatter: function(v) { return v >= 1000000 ? (v/1000000).toFixed(0)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v; } },
          splitLine: { lineStyle: { color: '#1A1A22' } }
        },
        {
          type: 'value',
          name: 'TPS',
          nameTextStyle: { color: '#787880', fontSize: 11 },
          axisLabel: { color: '#787880' },
          splitLine: { show: false }
        }
      ],
      series: series
    };
  }
  chart.setOption(buildOption('absolute'));
  window.addEventListener('resize', function() { chart.resize(); });
})();
</script>`
}

function fmt(v) { return v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(1)+'K' : v; }
```

注意：`fmt` 函数需要外提为模块级辅助函数。

- [ ] **Step 5: 编写 `renderScatterChart` — 区域三：效能散点图 + Provider 卡片**

```typescript
function renderScatterChart(data: CombinedReportData): string {
  // 检查是否有性能数据
  const hasPerf = data.perfSummary.some(p => p.avgTTFT !== null && p.avgTPS !== null)
  if (!hasPerf) {
    return `
<div class="section">
  <div class="section-title">Efficiency vs Cost</div>
  <div class="empty-state">
    <div class="icon">📊</div>
    <div class="msg">Performance data not yet collected.<br>Use the tool for a while and regenerate the report.</div>
  </div>
</div>`
  }

  const scatterData = data.perfSummary
    .filter(p => p.avgTTFT !== null && p.totalCost !== null && p.totalInput + p.totalOutput > 0)
    .map(p => ({
      name: p.model,
      value: [
        p.avgTTFT,
        p.totalCost / ((p.totalInput + p.totalOutput) / 1000), // cost per 1K tokens
        p.requestCount
      ],
      tps: p.avgTPS
    }))

  // Provider colors
  const providerColors: Record<string, string> = {
    opencode: '#00F593',
    deepseek: '#00D1FF',
    nvidia: '#B545FF',
    modelscope: '#FFB800',
  }

  return `
<div id="chart-scatter" class="chart" style="height:450px"></div>
<script>
(function() {
  var chart = echarts.init(document.getElementById('chart-scatter'));
  var data = ${JSON.stringify(scatterData)};
  var colors = ${JSON.stringify(providerColors)};
  chart.setOption({
    tooltip: {
      formatter: function(p) {
        var d = p.data;
        return '<b>' + d[2] + '</b><br>' +
          'TTFT: ' + d[0].toFixed(1) + 'ms<br>' +
          'Cost/1K: ' + d[1].toFixed(6) + '<br>' +
          'Requests: ' + (d[3] || 0) + '<br>' +
          'TPS: ' + (d[4] != null ? d[4].toFixed(1) : '—');
      }
    },
    grid: { left: 80, right: 40, bottom: 60, top: 40 },
    xAxis: {
      type: 'log',
      name: 'Avg TTFT (ms)',
      nameTextStyle: { color: '#787880', fontSize: 11 },
      axisLabel: { color: '#787880' },
      splitLine: { lineStyle: { color: '#1A1A22' } }
    },
    yAxis: {
      type: 'value',
      name: 'Cost per 1K Tokens',
      nameTextStyle: { color: '#787880', fontSize: 11 },
      axisLabel: { color: '#787880', formatter: function(v) { return '$' + v.toFixed(6); } },
      splitLine: { lineStyle: { color: '#1A1A22' } }
    },
    series: [{
      type: 'scatter',
      symbolSize: function(val) { return Math.max(8, Math.min(40, Math.sqrt(val[2]) * 3)); },
      data: data.map(function(d) { return { value: [d.value[0], d.value[1], d.name, d.value[2], d.tps] }; }),
      itemStyle: { color: '#00D1FF' },
      label: {
        show: true,
        formatter: function(p) { return p.data.value[2]; },
        position: 'right',
        color: '#787880',
        fontSize: 10
      }
    }]
  });
  window.addEventListener('resize', function() { chart.resize(); });
})();
</script>`
}
```

- [ ] **Step 6: 编写 `renderProviderCards` — Provider 摘要卡片**

```typescript
function renderProviderCards(data: CombinedReportData): string {
  const cards = data.providers.map(p => {
    // 计算该提供商下模型的平均性能
    const providerModels = data.perfSummary.filter(perf =>
      data.models.some(m => m.provider === p.provider && m.model === perf.model)
    )
    const avgTtft = providerModels.filter(x => x.avgTTFT !== null)
    const avgTps = providerModels.filter(x => x.avgTPS !== null)
    const ttft = avgTtft.length > 0
      ? (avgTtft.reduce((s, x) => s + (x.avgTTFT ?? 0), 0) / avgTtft.length).toFixed(1)
      : "—"
    const tps = avgTps.length > 0
      ? (avgTps.reduce((s, x) => s + (x.avgTPS ?? 0), 0) / avgTps.length).toFixed(1)
      : "—"

    return `<div class="provider-card">
  <div class="name">${p.provider}</div>
  <div class="stat">Tokens: <span>${fmtTokens(p.totalTokens)}</span></div>
  <div class="stat">Cost: <span>${fmtCost(p.totalCost)}</span></div>
  <div class="stat">TTFT: <span>${ttft}ms</span></div>
  <div class="stat">TPS: <span>${tps}</span></div>
  <div class="stat">Models: <span>${p.sessions}</span></div>
</div>`
  }).join("\n")

  return `<div class="provider-row">${cards}</div>`
}
```

注意：`p.sessions` 不是模型数量。需要改为计算 `data.models.filter(m => m.provider === p.provider).length`。在写代码时注意修正。

- [ ] **Step 7: 编写 `renderDataTable` — 区域四：详细数据表**

```typescript
function renderDataTable(data: CombinedReportData): string {
  const rows = sortModelsByUsage(data.models).map(m => {
    const rate = cacheHitRate(m.inputTokens, m.cacheRead)
    const rateClass = rate >= 0.85 ? "high-hit-rate" : rate >= 0.70 ? "mid-hit-rate" : "low-hit-rate"
    const perf = data.perfSummary.find(p => p.model === m.model || p.model === `${m.provider}/${m.model}`)
    const ttft = perf?.avgTTFT != null ? perf.avgTTFT.toFixed(1) + "ms" : "—"
    const tps = perf?.avgTPS != null ? perf.avgTPS.toFixed(1) : "—"

    return `<tr>
  <td>${m.model}</td>
  <td>${m.requests}</td>
  <td>${fmtTokens(m.inputTokens)}</td>
  <td>${fmtTokens(m.outputTokens)}</td>
  <td>${fmtTokens(m.cacheRead)}</td>
  <td class="${rateClass}">${fmtPercent(rate)}</td>
  <td>${fmtCost(m.totalCost)}</td>
  <td>${ttft}</td>
  <td>${tps}</td>
</tr>`
  }).join("\n")

  return `
<div class="section">
  <div class="section-title">Detailed Data Grid</div>
  <div style="overflow-x:auto">
    <table class="data-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Req</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache</th>
          <th>Hit Rate</th>
          <th>Cost</th>
          <th>TTFT</th>
          <th>TPS</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`
}
```

- [ ] **Step 8: 编写 `renderDailyChart` — 区域五：日趋势折线图（含热力图 Tab）**

```typescript
function renderDailyChart(data: CombinedReportData): string {
  const daily = data.daily.slice().reverse() // 按时间正序
  const dates = daily.map(d => d.day)
  const tokens = daily.map(d => d.totalTokens)
  const costs = daily.map(d => d.totalCost)

  // 热力图数据：YYYY-MM-DD → 值
  const heatmapData = daily.map(d => [d.day, d.totalTokens])

  return `
<div class="tab-bar">
  <button class="tab-btn active" data-tab="trend" onclick="switchTab('trend')">Daily Trend</button>
  <button class="tab-btn" data-tab="heatmap" onclick="switchTab('heatmap')">Heatmap</button>
</div>
<div id="tab-trend" class="tab-content active">
  <div id="chart-daily" class="chart" style="height:350px"></div>
</div>
<div id="tab-heatmap" class="tab-content">
  <div id="chart-heatmap" class="chart" style="height:350px"></div>
</div>
<script>
(function() {
  var data = ${JSON.stringify({ dates, tokens, costs, heatmapData })};

  // 趋势图
  var trendChart = echarts.init(document.getElementById('chart-daily'));
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 60, bottom: 60, top: 20 },
    xAxis: {
      type: 'category',
      data: data.dates,
      axisLabel: { color: '#787880', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2A2A35' } }
    },
    yAxis: [
      {
        type: 'value',
        name: 'Tokens',
        nameTextStyle: { color: '#787880', fontSize: 11 },
        axisLabel: { color: '#787880', formatter: function(v) { return v >= 1000000 ? (v/1000000).toFixed(0)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v; } },
        splitLine: { lineStyle: { color: '#1A1A22' } }
      },
      {
        type: 'value',
        name: 'Cost ($)',
        nameTextStyle: { color: '#787880', fontSize: 11 },
        axisLabel: { color: '#787880' },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, height: 20, bottom: 10, borderColor: '#2A2A35' }
    ],
    series: [
      {
        name: 'Tokens',
        type: 'line',
        color: '#00D1FF',
        data: data.tokens,
        smooth: true,
        lineStyle: { width: 2 },
        areaStyle: { color: 'rgba(0, 209, 255, 0.1)' },
        symbol: 'none'
      },
      {
        name: 'Cost',
        type: 'line',
        yAxisIndex: 1,
        color: '#FFB800',
        data: data.costs,
        smooth: true,
        lineStyle: { width: 1.5, type: 'dashed' },
        symbol: 'none'
      }
    ]
  });

  // 热力图
  if (data.heatmapData.length > 0) {
    var heatChart = echarts.init(document.getElementById('chart-heatmap'));
    var dates = data.heatmapData.map(function(d) { return d[0]; });
    var values = data.heatmapData.map(function(d) { return d[1]; });
    var maxVal = Math.max.apply(null, values);
    var minDate = dates[0];
    var maxDate = dates[dates.length - 1];
    heatChart.setOption({
      tooltip: { formatter: function(p) { return p.data[0] + '<br>Tokens: ' + fmt(p.data[1]); } },
      calendar: {
        range: [minDate, maxDate],
        top: 40,
        left: 40,
        right: 40,
        cellSize: ['auto', 15],
        splitLine: { lineStyle: { color: '#1A1A22' } },
        itemStyle: { borderColor: '#0C0C0E', borderWidth: 2 },
        dayLabel: { color: '#787880', fontSize: 10 },
        monthLabel: { color: '#787880', fontSize: 11 }
      },
      series: [{
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: data.heatmapData,
        itemStyle: {
          color: function(p) {
            var v = p.data[1];
            if (v === 0) return '#16161A';
            var intensity = Math.log(v + 1) / Math.log(maxVal + 1);
            var r = Math.round(0 + intensity * 0);
            var g = Math.round(18 + intensity * 227);
            var b = Math.round(26 + intensity * 147);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
          }
        }
      }]
    });
  }

  window.trendChart = trendChart;
  window.addEventListener('resize', function() { trendChart.resize(); });
})();
</script>`
}
```

- [ ] **Step 9: 编写 `generateUsageHtml` 主函数 + Tab 切换脚本 + Footer**

```typescript
export function generateUsageHtml(data: CombinedReportData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TokenWatch Usage Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TokenWatch Usage Report</h1>
      <div class="meta">
        ${data.meta.dateRange.start} — ${data.meta.dateRange.end}
        &nbsp;·&nbsp; Generated ${data.meta.generatedAt}
        &nbsp;·&nbsp; ${data.summary.modelsUsed.length} models · ${data.providers.length} providers
      </div>
    </div>

    ${renderKpiCards(data)}

    <div class="section">
      <div class="section-title">Model Comparison Matrix</div>
      ${renderModelChartInit(data)}
    </div>

    <div class="section">
      <div class="section-title">Efficiency vs Cost</div>
      ${renderScatterChart(data)}
    </div>

    <div class="section" style="padding-bottom:16px">
      <div class="section-title">Provider Summary</div>
      ${renderProviderCards(data)}
    </div>

    ${renderDataTable(data)}

    <div class="section">
      <div class="section-title">Usage Timeline</div>
      ${renderDailyChart(data)}
    </div>

    <div class="footer">
      TokenWatch · Generated by opencode-tokenwatch v0.1.0
    </div>
  </div>

  <script id="report-data" type="application/json">${JSON.stringify(data)}</script>

  <script>
  var fmt = function(v) {
    if (v == null) return '—';
    return v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(1)+'K' : String(v);
  };
  window.switchTab = function(name) {
    document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
    document.querySelectorAll('.tab-btn').forEach(function(el) { el.classList.remove('active'); });
    document.getElementById('tab-' + name).classList.add('active');
    document.querySelector('[data-tab="' + name + '"]').classList.add('active');
    setTimeout(function() {
      [trendChart].forEach(function(c) { if (c && c.resize) c.resize(); });
    }, 50);
  };
  </script>
</body>
</html>`
}
```

- [ ] **Step 10: 构建验证**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 11: Commit**

```bash
git add src/generate-usage-html.ts
git commit -m "feat: add HTML report generator with ECharts dashboards"
```

---

### Task 3: 扩展 commands.ts — 注册 `/usage-html` `/usage-json` `/usage-text` 命令

**Files:**
- Modify: `src/commands.ts`

- [ ] **Step 1: 添加依赖导入，读取性能数据**

在 `commands.ts` 顶部现有导入之后添加：

```typescript
import { generateUsageHtml } from "./generate-usage-html.js"
import type { CombinedReportData, HtmlReportMeta } from "./formatter.js"
import { createPerfTracker, readLogs } from "./perf-tracker.js"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { execSync } from "node:child_process"
```

- [ ] **Step 2: 添加辅助函数 `ensureReportDir`、`openInBrowser`、`buildCombinedData`**

```typescript
function ensureReportDir(): string {
  const dir = join(homedir(), ".opencode", "reports")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function openInBrowser(filePath: string): void {
  try {
    const platform = process.platform
    if (platform === "win32") execSync(`start "" "${filePath}"`, { windowsHide: true, timeout: 5000 })
    else if (platform === "darwin") execSync(`open "${filePath}"`, { timeout: 5000 })
    else execSync(`xdg-open "${filePath}"`, { timeout: 5000 })
  } catch { /* silently fail */ }
}

async function buildCombinedData(api: TuiPluginApi): Promise<CombinedReportData> {
  const report = await getUsageReport({})
  const logs = readLogs(1000)
  const perfSummary = createPerfTracker().getSessionStats()

  const now = new Date()
  const meta: HtmlReportMeta = {
    generatedAt: now.toISOString().slice(0, 10) + " " + now.toISOString().slice(11, 19),
    dateRange: {
      start: report.daily.length > 0 ? report.daily[report.daily.length - 1].day : "—",
      end: report.daily.length > 0 ? report.daily[0].day : "—",
    },
  }

  return {
    ...report,
    perfLogs: logs,
    perfSummary: Object.values(perfSummary.models),
    meta,
  }
}
```

注意：`createPerfTracker().getSessionStats()` 会创建一个新的 tracker 实例。更好的做法是从 tui.tsx 中获取已有的 tracker 实例。但为了简化，可以先这样实现。后续可以引入一个共享的单例。

- [ ] **Step 3: 重构 `showHtmlReport` 函数**

```typescript
async function showHtmlReport(api: TuiPluginApi): Promise<void> {
  try {
    const data = await buildCombinedData(api)
    const html = generateUsageHtml(data)
    const dir = ensureReportDir()
    const dateStr = new Date().toISOString().slice(0, 10)
    const filePath = join(dir, `tokenwatch-${dateStr}.html`)
    writeFileSync(filePath, html, "utf-8")

    api.ui.toast?.({ message: `📊 Report: ${filePath}`, variant: "info" })
    openInBrowser(filePath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}
```

- [ ] **Step 4: 注册新的命令变体**

将 `registerCommands` 函数扩展为注册多个命令：

```typescript
export async function registerCommands(api: TuiPluginApi): Promise<void> {
  api.command?.register(() => [
    {
      value: "tokenwatch-html-report",
      title: "Generate HTML report",
      description: "Generate an HTML dashboard with token usage, cache efficiency, and performance charts",
      category: "Stats",
      slash: { name: "usage-html", aliases: ["usage"] },
      onSelect: async () => { await showHtmlReport(api) },
    },
    {
      value: "tokenwatch-json-export",
      title: "Export as JSON",
      description: "Export usage data as JSON file",
      category: "Stats",
      slash: { name: "usage-json" },
      onSelect: async () => { await showJsonExport(api) },
    },
    // ... existing text report and settings commands
  ])
}
```

注意：`/usage-html` 的主别名是 `usage`，这样 `/usage` 会自动映射到 HTML 报告（向前兼容用户习惯）。

保留原有的 `/usage-text` 和 `/usage-settings`：

```typescript
{
  value: "tokenwatch-text-report",
  title: "Text report (legacy)",
  description: "View plain text usage report in terminal",
  category: "Stats",
  slash: { name: "usage-text" },
  onSelect: async () => { await showTextReport(api) },
},
{
  value: "tokenwatch-settings",
  title: "TokenWatch Settings",
  description: "Configure sidebar display options",
  category: "Stats",
  slash: { name: "usage-settings", aliases: ["tokenwatch-settings"] },
  onSelect: async () => { await showSettingsDialog(api) },
},
```

- [ ] **Step 5: 添加 `showJsonExport` 函数**

```typescript
async function showJsonExport(api: TuiPluginApi): Promise<void> {
  try {
    const report = await getUsageReport({})
    const dir = ensureReportDir()
    const dateStr = new Date().toISOString().slice(0, 10)
    const filePath = join(dir, `tokenwatch-${dateStr}.json`)
    writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8")
    api.ui.toast?.({ message: `📄 JSON: ${filePath}`, variant: "info" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    api.ui.toast?.({ message: `Error: ${msg}`, variant: "error" })
  }
}
```

- [ ] **Step 6: 重命名原 `showUsageReport` → `showTextReport`**

保持原有文本报告逻辑不变，仅改名。

- [ ] **Step 7: 构建验证**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 8: Commit**

```bash
git add src/commands.ts
git commit -m "feat: restructure /usage commands with HTML/JSON/text variants"
```

---

### Task 4: 集成测试验证

**Files:**
- Use: `tokenwatch-usage-report.json`（已有测试数据）

- [ ] **Step 1: 准备测试数据，运行 HTML 生成**

```bash
node -e "
const { generateUsageHtml } = require('./src/generate-usage-html.js');
const data = require('./tokenwatch-usage-report.json');
const html = generateUsageHtml(data);
require('fs').writeFileSync('/tmp/tokenwatch-test.html', html, 'utf-8');
console.log('Generated: /tmp/tokenwatch-test.html (' + html.length + ' bytes)');
"
```

Expected: 生成成功，HTML 文件大小约 50-100KB

- [ ] **Step 2: 验证 HTML 结构**

```bash
node -e "
const html = require('fs').readFileSync('/tmp/tokenwatch-test.html', 'utf-8');
const checks = [
  ['echarts', html.includes('echarts.min.js')],
  ['report-data JSON', html.includes('report-data')],
  ['KPI cards', html.includes('kpi-card')],
  ['chart containers', html.includes('chart-model')],
  ['data table', html.includes('data-table')],
  ['provider cards', html.includes('provider-card')],
  ['tab system', html.includes('tab-btn')],
  ['footer', html.includes('footer')],
];
checks.forEach(function(c) { console.log(c[1] ? '✅ ' + c[0] : '❌ ' + c[0]); });
"
```

Expected: 所有检查项通过

- [ ] **Step 3: 手动验证**

在浏览器中打开 `/tmp/tokenwatch-test.html`，验证：
- 页面正确渲染，无 JS 错误
- KPI 卡片数值正确
- 模型图表显示堆叠柱状图和 TPS 折线
- 切换 Toggle 按钮
- 散点图（或空状态说明）
- 数据表格数据正确
- 日趋势图可缩放
- 热力图 Tab 切换

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add test report and verification"
```

---

## 自检清单

- [ ] 所有代码块有完整实现，无占位符
- [ ] 类型定义在不同文件间一致
- [ ] formatter.ts 的 `CombinedReportData` 引用了 perf-tracker.ts 的类型
- [ ] generate-usage-html.ts 中 `fmt` 辅助函数在全局脚本中也有定义（浏览器端）
- [ ] CSS 覆盖了所有 HTML 结构
- [ ] ECharts 图表 ID 唯一且匹配
- [ ] 命令别名 `/usage` 映射到 HTML 报告
- [ ] 报错路径处理（`try-catch` + toast error）
- [ ] 跨平台文件路径（`path.join`）
- [ ] 空状态：无 perf 数据、无 daily 数据、空报告

---

## 执行方式

Plan complete and saved to `docs/superpowers/plans/2026-05-22-usage-html-report-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 为每个任务分派新的子 agent，任务间审阅，快速迭代
2. **Inline Execution** — 在当前会话中使用 executing-plans 执行，批处理 + 检查点

Which approach do you prefer?
