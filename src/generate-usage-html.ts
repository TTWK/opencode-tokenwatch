import type { CombinedReportData, ModelBreakdownItem } from "./formatter.js"

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

function fmtCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return "$" + n.toFixed(6)
  return "$" + n.toFixed(2)
}

function fmtPercent(n: number): string {
  return (n * 100).toFixed(1) + "%"
}

function cacheHitRate(input: number, cacheRead: number): number {
  if (input + cacheRead === 0) return 0
  return cacheRead / (input + cacheRead)
}

function sortModelsByUsage(models: ModelBreakdownItem[]): ModelBreakdownItem[] {
  // 过滤掉 totalTokens=0 的无效模型条目（如会话失败导致全为 0 的记录）
  return [...models].filter(m => m.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens)
}

function renderMeta(data: CombinedReportData): string {
  const m = data.meta
  return `TokenWatch Usage Report · ${m.dateRange.start} → ${m.dateRange.end} · generated ${m.generatedAt}`
}

function renderKpiCards(data: CombinedReportData): string {
  const s = data.summary
  const hitRate = cacheHitRate(s.inputTokens, s.cacheRead)
  const hitRatePct = fmtPercent(hitRate)
  let tpsSum = 0, tpsReqs = 0;
  for (const p of data.perfSummary) {
    if (p.avgTPS != null && p.avgTPS > 0) {
      tpsSum += p.avgTPS * p.requestCount;
      tpsReqs += p.requestCount;
    }
  }
  const avgTpsRaw = tpsReqs > 0 ? tpsSum / tpsReqs : 0
  const avgTps = tpsReqs > 0 ? avgTpsRaw.toFixed(1) : '—'
  const isHighCache = hitRate >= 0.5

  const errors = (data as any).errors as { errorRate: number; failedCount: number } | undefined
  const errorRatePct = errors ? (errors.errorRate * 100).toFixed(1) + '%' : '—'
  const errorColor = errors && errors.errorRate >= 0.05 ? 'var(--output)'
    : errors && errors.errorRate > 0 ? 'var(--tps)' : 'var(--cache)'

  return `
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value">${fmtTokens(s.totalTokens)}</div>
      </div>
      <div class="kpi-card${isHighCache ? ' kpi-glow' : ''}">
        <div class="kpi-label">Cache Hit Rate</div>
        <div class="kpi-value" style="color:var(--cache)">${hitRatePct}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg TPS</div>
        <div class="kpi-value" style="color:var(--tps)">${avgTps}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Requests</div>
        <div class="kpi-value">${s.requestCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Cost</div>
        <div class="kpi-value" style="color:var(--tps)">${fmtCost(s.totalCost)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Error Rate</div>
        <div class="kpi-value" style="color:${errorColor}">${errorRatePct}</div>
      </div>
    </div>`
}

function renderModelChartInit(data: CombinedReportData): string {
  const models = sortModelsByUsage(data.models).filter(m => m.totalTokens >= 1_000_000)
  const names = models.map(m => m.model)
  const inputData = models.map(m => m.inputTokens)
  const outputData = models.map(m => m.outputTokens)
  const cacheData = models.map(m => m.cacheRead)
  const tpsData = models.map(m => {
    const perf = data.perfSummary.find(p => p.model === `${m.provider}/${m.model}`)
    return perf?.avgTPS ?? null
  })

  return `var modelNames = ${JSON.stringify(names)};
var modelInput = ${JSON.stringify(inputData)};
var modelOutput = ${JSON.stringify(outputData)};
var modelCache = ${JSON.stringify(cacheData)};
var modelTps = ${JSON.stringify(tpsData)};

function initModelChart() {
  var el = document.getElementById('model-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.modelChart = chart;
  renderModelChart(chart);
  return chart;
}

function renderModelChart(chart) {
  var totals = modelInput.map(function(v, i) { return v + modelOutput[i] + modelCache[i]; });
  var option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: function(params) {
        var html = '<b>' + params[0].axisValue + '</b><br/>';
        var total = 0;
        params.forEach(function(p) {
          if (p.seriesName !== 'TPS') {
            html += p.marker + ' ' + p.seriesName + ': ' + fmt(p.value) + '<br/>';
            total += p.value;
          }
        });
        html += 'Total: ' + fmt(total) + '<br/>';
        var tpsParam = params.find(function(p) { return p.seriesName === 'TPS'; });
        if (tpsParam && tpsParam.value != null) {
          html += tpsParam.marker + ' TPS: ' + tpsParam.value.toFixed(1) + '<br/>';
        }
        return html;
      }
    },
    legend: {
      data: ['Input', 'Output', 'Cache', 'TPS'],
      textStyle: { color: '#B0B0C0' },
      top: 5
    },
    grid: { left: 60, right: 60, bottom: 100, top: 50 },
    xAxis: {
      type: 'category',
      data: modelNames,
      axisLabel: { color: '#B0B0C0', rotate: 45, interval: 0, fontSize: 10 },
      axisLine: { lineStyle: { color: '#2A2A35' } }
    },
    yAxis: [
      {
        type: 'value',
        name: 'Tokens',
        nameTextStyle: { color: '#B0B0C0' },
        axisLabel: {
          color: '#B0B0C0',
          formatter: fmt
        },
        splitLine: { lineStyle: { color: '#2A2A35', type: 'dashed' } }
      },
      {
        type: 'value',
        name: 'TPS',
        nameTextStyle: { color: '#FFB800' },
        axisLabel: { color: '#FFB800', formatter: function(v) { return v.toFixed(1); } },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: 'Input',
        type: 'bar',
        stack: 'tokens',
        data: modelInput,
        itemStyle: { color: '#00D1FF' },
        barMaxWidth: 40
      },
      {
        name: 'Cache',
        type: 'bar',
        stack: 'tokens',
        data: modelCache,
        itemStyle: { color: '#00F593' },
        barMaxWidth: 40,
        label: {
          show: true,
          position: 'inside',
          formatter: function(p) {
            var cache = modelCache[p.dataIndex];
            var input = modelInput[p.dataIndex];
            if (cache === 0) return '';
            return (cache / (input + cache) * 100).toFixed(0) + '%';
          },
          color: '#fff', fontSize: 10, fontWeight: 'bold'
        }
      },
      {
        name: 'Output',
        type: 'bar',
        stack: 'tokens',
        data: modelOutput,
        itemStyle: { color: '#B545FF' },
        barMaxWidth: 40,
        label: {
          show: true,
          position: 'top',
          formatter: function(p) {
            var total = modelInput[p.dataIndex] + modelOutput[p.dataIndex] + modelCache[p.dataIndex];
            return total > 0 ? fmt(total) : '';
          },
          color: '#fff', fontSize: 10, fontWeight: 'bold'
        }
      },
      {
        name: 'TPS',
        type: 'scatter',
        yAxisIndex: 1,
        data: modelTps,
        symbol: 'diamond',
        symbolSize: function(val) { return val != null && val > 0 ? 13 : 0; },
        itemStyle: { color: '#FFB800' },
        label: {
          show: true,
          position: 'right',
          formatter: function(p) { return p.value != null && p.value > 0 ? p.value.toFixed(1) : ''; },
          color: '#FFB800', fontSize: 10
        }
      }
    ]
  };
  chart.setOption(option);
  chart.resize();
}`
}

function renderScatterChartInit(data: CombinedReportData): string {
  // 过滤掉全零无效条目：无请求或无任何 token 的模型
  const validPerf = data.perfSummary.filter(p =>
    p.requestCount > 0 &&
    (p.totalInput + p.totalOutput + p.totalCacheRead + p.totalCacheWrite) > 0
  )
  if (validPerf.length === 0) return ""

  // 按 TPS 降序排列（null TPS 放末尾），让最快的模型显示在最上方
  const sorted = [...validPerf].sort((a, b) => {
    if (a.avgTPS == null && b.avgTPS == null) return 0
    if (a.avgTPS == null) return 1
    if (b.avgTPS == null) return -1
    return b.avgTPS - a.avgTPS
  })

  const names = sorted.map(p => p.model)
  const tpsValues = sorted.map(p => p.avgTPS ?? 0)
  const ttftValues = sorted.map(p => p.avgTTFT ?? 0)
  const costValues = sorted.map(p => {
    const billable = p.totalInput + p.totalOutput + p.totalCacheRead + p.totalCacheWrite
    return billable > 0 ? (p.totalCost / billable) * 1000 : 0
  })
  const hitRates = sorted.map(p => p.cacheHitRate ?? 0)
  const reqCounts = sorted.map(p => p.requestCount)

  return `
var effNames = ${JSON.stringify(names)};
var effTps   = ${JSON.stringify(tpsValues)};
var effTtft  = ${JSON.stringify(ttftValues)};
var effCost  = ${JSON.stringify(costValues)};
var effHit   = ${JSON.stringify(hitRates)};
var effReq   = ${JSON.stringify(reqCounts)};

function initScatterChart() {
  var el = document.getElementById('scatter-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.scatterChart = chart;

  // TPS 越高越绿，越低越紫，无数据为灰
  var maxTps = Math.max.apply(null, effTps.filter(function(v){ return v > 0; })) || 1;
  var barColors = effTps.map(function(v) {
    if (v <= 0) return '#444455';
    var r = v / maxTps;
    if (r >= 0.8) return '#00F593';
    if (r >= 0.5) return '#FFB800';
    return '#B545FF';
  });

  var option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'none' },
      formatter: function(params) {
        var i = params[0].dataIndex;
        var tps  = effTps[i]  > 0 ? effTps[i].toFixed(1)  + ' tok/s' : '\u2014';
        var ttft = effTtft[i] > 0 ? effTtft[i].toFixed(0) + ' ms'    : '\u2014';
        var cost = effCost[i] > 0 ? '$' + effCost[i].toFixed(4) + '/1K' : '\u2014';
        var hit  = effHit[i]  > 0 ? effHit[i].toFixed(1)  + '%'     : '\u2014';
        return '<b>' + effNames[i] + '</b><br/>' +
          '\u25B6 TPS: '        + tps  + '<br/>' +
          '\u23F1 TTFT: '       + ttft + '<br/>' +
          '\uD83D\uDCB0 Cost/1K: ' + cost + '<br/>' +
          '\uD83D\uDCBE Cache Hit: ' + hit + '<br/>' +
          'Requests: ' + effReq[i];
      }
    },
    grid: { left: 20, right: 280, bottom: 30, top: 20, containLabel: true },
    xAxis: {
      type: 'value',
      name: 'Avg TPS  (tokens / sec)',
      nameTextStyle: { color: '#B0B0C0', fontSize: 11 },
      axisLabel: { color: '#B0B0C0', formatter: function(v) { return v > 0 ? v.toFixed(0) : '0'; } },
      splitLine: { lineStyle: { color: '#2A2A35', type: 'dashed' } }
    },
    yAxis: {
      type: 'category',
      data: effNames,
      inverse: true,
      axisLabel: {
        color: '#E0E0F0',
        fontSize: 11,
        formatter: function(v) { return v.length > 50 ? v.slice(0, 48) + '\u2026' : v; }
      },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: effTps.map(function(v, i) {
        return { value: v > 0 ? v : 0.001, itemStyle: { color: barColors[i], borderRadius: [0, 4, 4, 0] } };
      }),
      barMaxWidth: 22,
      label: {
        show: true,
        position: 'right',
        color: '#E0E0F0',
        fontSize: 10,
        formatter: function(p) {
          var i = p.dataIndex;
          var parts = [effTps[i] > 0 ? effTps[i].toFixed(1) + ' t/s' : '\u2014'];
          if (effTtft[i] > 0) parts.push('TTFT ' + effTtft[i].toFixed(0) + 'ms');
          if (effCost[i] > 0) parts.push('\u0024' + effCost[i].toFixed(4) + '/1K');
          return parts.join('   ');
        }
      }
    }]
  };
  chart.setOption(option);
  chart.resize();
}
`
}

function providerBorderColor(provider: string): string {
  const colors: Record<string, string> = { opencode: "#00F593", deepseek: "#00D1FF", nvidia: "#B545FF", modelscope: "#FFB800", }
  return colors[provider] || "#2A2A35"
}

/** 渲染 Provider 卡片，按 token 总量降序，最多显示 10 个 */
function renderProviderCards(data: CombinedReportData): string {
  const sorted = [...data.providers].sort((a, b) => b.totalTokens - a.totalTokens)
  const top = sorted.slice(0, 10)
  const remaining = sorted.length - 10

  const cards = top.map(p => {
    const modelCount = data.models.filter(m => m.provider === p.provider).length
    const perfItems = data.perfSummary.filter(ps => ps.providerID === p.provider)
    let ttftSum = 0, ttftReqs = 0;
    for (const x of perfItems) {
      if (x.avgTTFT != null && x.avgTTFT > 0) {
        ttftSum += x.avgTTFT * x.requestCount;
        ttftReqs += x.requestCount;
      }
    }
    const avgTtft = ttftReqs > 0 ? ttftSum / ttftReqs : null;

    let tpsSum = 0, tpsReqs = 0;
    for (const x of perfItems) {
      if (x.avgTPS != null && x.avgTPS > 0) {
        tpsSum += x.avgTPS * x.requestCount;
        tpsReqs += x.requestCount;
      }
    }
    const avgTps = tpsReqs > 0 ? tpsSum / tpsReqs : null;

    return `
    <div class="provider-card" style="border-color:${providerBorderColor(p.provider)}">
      <div class="provider-name">${p.provider}</div>
      <div class="provider-stat"><span class="stat-label">Tokens</span><span>${fmtTokens(p.totalTokens)}</span></div>
      <div class="provider-stat"><span class="stat-label">Cost</span><span>${fmtCost(p.totalCost)}</span></div>
      <div class="provider-stat"><span class="stat-label">Avg TTFT</span><span>${avgTtft != null ? avgTtft.toFixed(0) + 'ms' : '—'}</span></div>
      <div class="provider-stat"><span class="stat-label">Avg TPS</span><span>${avgTps != null ? avgTps.toFixed(1) : '—'}</span></div>
      <div class="provider-stat"><span class="stat-label">Models</span><span>${modelCount}</span></div>
    </div>`
  }).join("\n")

  const moreHint = remaining > 0
    ? `<div class="provider-more">+ ${remaining} more provider${remaining > 1 ? 's' : ''} not shown</div>`
    : ''

  return cards + moreHint
}

/**
 * 渲染 Model Analytics 区块：三个表格合并为 Tab 切换展示，各自带分页控件。
 * Tab 1: Usage Breakdown  — Token/成本用量分解
 * Tab 2: Latency Percentiles — TTFT/E2E 分位数
 * Tab 3: Failed Requests  — 失败请求明细（无数据时不显示此 Tab）
 */
function renderModelAnalyticsSection(data: CombinedReportData): string {
  // ─── Tab 1: Usage Breakdown ───────────────────────────────────────────────
  const usageRows = sortModelsByUsage(data.models).map(m => {
    const hitRate = cacheHitRate(m.inputTokens, m.cacheRead)
    const hitColor = hitRate >= 0.85 ? 'var(--cache)' : hitRate >= 0.70 ? 'var(--tps)' : 'var(--output)'
    const perf = data.perfSummary.find(p => p.model === `${m.provider}/${m.model}`)
    const ttft = perf?.avgTTFT != null ? perf.avgTTFT.toFixed(0) + 'ms' : '—'
    const p95ttft = perf?.p95TTFT != null ? perf.p95TTFT.toFixed(0) + 'ms' : '—'
    const tps = perf?.avgTPS != null ? perf.avgTPS.toFixed(1) : '—'
    return `<tr>
      <td>${m.model}</td>
      <td>${m.provider}</td>
      <td>${m.requests}</td>
      <td>${fmtTokens(m.totalTokens)}</td>
      <td>${fmtTokens(m.inputTokens)}</td>
      <td>${fmtTokens(m.outputTokens)}</td>
      <td>${fmtTokens(m.cacheRead)}</td>
      <td style="color:${hitColor};font-weight:600">${fmtPercent(hitRate)}</td>
      <td>${ttft}</td>
      <td style="color:var(--tps);font-size:0.85em">${p95ttft}</td>
      <td>${tps}</td>
      <td>${fmtCost(m.totalCost)}</td>
    </tr>`
  }).join("\n")

  // ─── Tab 2: Latency Percentiles ───────────────────────────────────────────
  const validPerf = data.perfSummary.filter(p =>
    p.requestCount > 0 &&
    (p.totalInput + p.totalOutput + p.totalCacheRead + p.totalCacheWrite) > 0
  )
  const fmtMs = (v: number | null | undefined) => v != null ? v.toFixed(0) + 'ms' : '—'
  const perfRows = validPerf.map(p => {
    const hitColor = p.cacheHitRate != null && p.cacheHitRate >= 85 ? 'var(--cache)'
      : p.cacheHitRate != null && p.cacheHitRate >= 70 ? 'var(--tps)' : 'var(--output)'
    return `<tr>
      <td>${p.model}</td>
      <td>${p.requestCount}</td>
      <td>${fmtMs(p.avgTTFT)}</td>
      <td>${fmtMs(p.p50TTFT)}</td>
      <td>${fmtMs(p.p95TTFT)}</td>
      <td>${fmtMs(p.p99TTFT)}</td>
      <td>${fmtMs(p.avgLatency)}</td>
      <td>${fmtMs(p.p50Latency)}</td>
      <td>${fmtMs(p.p95Latency)}</td>
      <td>${fmtMs(p.p99Latency)}</td>
      <td style="color:${hitColor};font-weight:600">${p.cacheHitRate != null ? p.cacheHitRate.toFixed(1) + '%' : '—'}</td>
    </tr>`
  }).join("\n")

  // ─── Tab 3: Failed Requests ───────────────────────────────────────────────
  const errors = (data as any).errors as {
    successCount: number; failedCount: number; errorRate: number
    byModel: Array<{ provider: string; model: string; failed: number; total: number }>
  } | undefined
  const hasErrors = !!(errors && errors.failedCount > 0)

  let errorTabBtn = ''
  let errorTabContent = ''
  if (hasErrors) {
    const errorRatePct = (errors!.errorRate * 100).toFixed(2) + '%'
    const rateColor = errors!.errorRate >= 0.05 ? 'var(--output)' : 'var(--tps)'
    const cellColor = errors!.errorRate >= 0.05 ? 'var(--output)' : 'var(--tps)'
    const errorRows = errors!.byModel
      .filter(m => m.failed > 0)
      .map(m => {
        const modelRate = m.total > 0 ? (m.failed / m.total * 100).toFixed(1) + '%' : '—'
        return `<tr>
          <td>${m.provider}</td>
          <td>${m.model}</td>
          <td>${m.total}</td>
          <td style="color:var(--output)">${m.failed}</td>
          <td style="color:var(--tps)">${m.total - m.failed}</td>
          <td style="color:${cellColor}">${modelRate}</td>
        </tr>`
      }).join('\n')

    errorTabBtn = `
      <button class="tab-btn" data-mtab="errors" onclick="switchModelTab('errors')">
        Failed Requests <span style="color:var(--output);margin-left:4px;font-size:0.85em">(${errors!.failedCount})</span>
      </button>`

    errorTabContent = `
    <div id="model-tab-errors" class="tab-content">
      <p style="font-size:12px;color:${rateColor};padding:8px 0 6px">
        Overall error rate: <strong>${errorRatePct}</strong> &mdash;
        ${errors!.failedCount} failed / ${errors!.successCount + errors!.failedCount} total
      </p>
      <table id="errors-table" class="data-table">
        <thead><tr>
          <th>Provider</th><th>Model</th><th>Total</th>
          <th>Failed</th><th>Success</th><th>Error Rate</th>
        </tr></thead>
        <tbody>${errorRows}</tbody>
      </table>
      <div class="pagination-ctrl" id="errors-table-ctrl">
        <button class="page-btn" id="errors-table-prev">← Prev</button>
        <span class="page-info" id="errors-table-info"></span>
        <button class="page-btn" id="errors-table-next">Next →</button>
      </div>
    </div>`
  }

  return `
  <div class="section">
    <div class="section-title">Model Analytics</div>
    <div class="tab-bar">
      <button class="tab-btn active" data-mtab="usage" onclick="switchModelTab('usage')">Usage Breakdown</button>
      <button class="tab-btn" data-mtab="perf" onclick="switchModelTab('perf')">Latency Percentiles</button>
      ${errorTabBtn}
    </div>

    <div id="model-tab-usage" class="tab-content active">
      <table id="usage-table" class="data-table">
        <thead><tr>
          <th>Model</th><th>Provider</th><th>Req</th><th>Total</th>
          <th>Input</th><th>Output</th><th>Cache</th><th>Hit Rate</th>
          <th>Avg TTFT</th><th>P95 TTFT</th><th>TPS</th><th>Cost</th>
        </tr></thead>
        <tbody>${usageRows}</tbody>
      </table>
      <div class="pagination-ctrl" id="usage-table-ctrl">
        <button class="page-btn" id="usage-table-prev">← Prev</button>
        <span class="page-info" id="usage-table-info"></span>
        <button class="page-btn" id="usage-table-next">Next →</button>
      </div>
    </div>

    <div id="model-tab-perf" class="tab-content">
      ${validPerf.length > 0 ? `
      <table id="perf-table" class="data-table">
        <thead><tr>
          <th>Model</th><th>Req</th>
          <th>Avg TTFT</th><th>P50 TTFT</th><th>P95 TTFT</th><th>P99 TTFT</th>
          <th>Avg E2E</th><th>P50 E2E</th><th>P95 E2E</th><th>P99 E2E</th>
          <th>Cache Hit</th>
        </tr></thead>
        <tbody>${perfRows}</tbody>
      </table>
      <div class="pagination-ctrl" id="perf-table-ctrl">
        <button class="page-btn" id="perf-table-prev">← Prev</button>
        <span class="page-info" id="perf-table-info"></span>
        <button class="page-btn" id="perf-table-next">Next →</button>
      </div>` : '<div class="empty-state">No performance data available for this period.</div>'}
    </div>

    ${errorTabContent}
  </div>`
}

function renderDailyTrendInit(data: CombinedReportData): string {
  const days = data.daily.slice().reverse().map(d => d.day)
  const tokens = data.daily.slice().reverse().map(d => d.totalTokens)
  const costs = data.daily.slice().reverse().map(d => d.totalCost)

  return `
var dailyDays = ${JSON.stringify(days)};
var dailyTokens = ${JSON.stringify(tokens)};
var dailyCosts = ${JSON.stringify(costs)};

function initDailyChart() {
  var el = document.getElementById('daily-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.dailyChart = chart;
  var option = {
    tooltip: {
      trigger: 'axis',
      formatter: function(params) {
        var html = '<b>' + params[0].axisValue + '</b><br/>';
        params.forEach(function(p) {
          html += p.marker + ' ' + p.seriesName + ': ' + (p.seriesName === 'Cost' ? '$' + p.value.toFixed(4) : fmt(p.value)) + '<br/>';
        });
        return html;
      }
    },
    legend: {
      data: ['Tokens', 'Cost'],
      textStyle: { color: '#B0B0C0' },
      top: 5
    },
    grid: { left: 60, right: 60, bottom: 80, top: 40 },
    xAxis: {
      type: 'category',
      data: dailyDays,
      axisLabel: { color: '#B0B0C0', rotate: 45, interval: 0, fontSize: 10 },
      axisLine: { lineStyle: { color: '#2A2A35' } }
    },
    yAxis: [
      {
        type: 'value',
        name: 'Tokens',
        nameTextStyle: { color: '#B0B0C0' },
        axisLabel: { color: '#B0B0C0', formatter: fmt },
        splitLine: { lineStyle: { color: '#2A2A35', type: 'dashed' } }
      },
      {
        type: 'value',
        name: 'Cost',
        nameTextStyle: { color: '#FFB800' },
        axisLabel: { color: '#FFB800', formatter: function(v) { return '$' + v.toFixed(4); } },
        splitLine: { show: false }
      }
    ],
    dataZoom: [{
      type: 'slider',
      bottom: 5,
      height: 20,
      borderColor: '#2A2A35',
      fillerColor: 'rgba(0,213,255,0.1)',
      handleStyle: { color: '#00D1FF' },
      textStyle: { color: '#B0B0C0' }
    }],
    series: [
      {
        name: 'Tokens',
        type: 'line',
        data: dailyTokens,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#00D1FF', width: 2 },
        areaStyle: { color: 'rgba(0,209,255,0.15)' }
      },
      {
        name: 'Cost',
        type: 'line',
        yAxisIndex: 1,
        data: dailyCosts,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#FFB800', width: 2 },
        areaStyle: { color: 'rgba(255,184,0,0.1)' }
      }
    ]
  };
  chart.setOption(option);
  chart.resize();
}`
}

function renderHeatmapInit(data: CombinedReportData): string {
  const days = data.daily.slice().reverse()
  const heatData = days.map(d => [d.day, Math.log10(d.totalTokens + 1)])
  const minDate = days.length > 0 ? days[0].day : ''
  const maxDate = days.length > 0 ? days[days.length - 1].day : ''

  return `
var heatData = ${JSON.stringify(heatData)};

function initHeatmapChart() {
  var el = document.getElementById('heatmap-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.heatmapChart = chart;
  var option = {
    tooltip: {
      formatter: function(params) {
        var val = params.value;
        var rawTokens = Math.pow(10, val[1]) - 1;
        return '<b>' + val[0] + '</b><br/>Tokens: ' + fmt(Math.round(rawTokens));
      }
    },
    visualMap: {
      min: 0,
      max: Math.max.apply(null, heatData.map(function(d) { return d[1]; })) || 5,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 10,
      textStyle: { color: '#B0B0C0' },
      inRange: {
        color: ['#0C0C0E', '#1a3a2a', '#00F593', '#00D1FF', '#B545FF']
      }
    },
    calendar: {
      left: 30,
      right: 30,
      top: 20,
      bottom: 60,
      range: ['${minDate}', '${maxDate}'],
      splitLine: { lineStyle: { color: '#2A2A35' } },
      dayLabel: { color: '#B0B0C0' },
      monthLabel: { color: '#B0B0C0' },
      yearLabel: { color: '#B0B0C0' },
      itemStyle: { color: '#16161A', borderColor: '#0C0C0E', borderWidth: 2 }
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: heatData
    }]
  };
  chart.setOption(option);
  chart.resize();
}`
}

export function generateUsageHtml(data: CombinedReportData): string {
  const metaStr = renderMeta(data)
  const kpiStr = renderKpiCards(data)
  const modelChartVisible = data.models.filter(m => m.totalTokens >= 1_000_000).length > 0
  const modelChartJs = modelChartVisible ? renderModelChartInit(data) : ""
  const scatterChartJs = renderScatterChartInit(data)
  const providerStr = renderProviderCards(data)
  const modelAnalyticsStr = renderModelAnalyticsSection(data)
  const dailyChartJs = renderDailyTrendInit(data)
  const heatmapJs = renderHeatmapInit(data)
  const hasPerf = data.perfSummary.some(p =>
    p.requestCount > 0 &&
    (p.totalInput + p.totalOutput + p.totalCacheRead + p.totalCacheWrite) > 0
  )
  const jsonData = JSON.stringify(data)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TokenWatch Usage Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
  :root {
    --bg: #0C0C0E;
    --card: #16161A;
    --border: #2A2A35;
    --text: #E0E0F0;
    --text-dim: #B0B0C0;
    --cache: #00F593;
    --input: #00D1FF;
    --output: #B545FF;
    --tps: #FFB800;
    --radius: 8px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }
  .container { max-width: 1400px; margin: 0 auto; padding: 24px 20px; }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px;
  }
  .header h1 { font-size: 22px; font-weight: 600; color: var(--text); }
  .header h1 span { color: var(--input); }
  .header .meta { font-size: 12px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }

  .kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi-card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px; text-align: center;
  }
  .kpi-card.kpi-glow { box-shadow: 0 0 20px rgba(0,245,147,0.15); border-color: var(--cache); }
  .kpi-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .kpi-value { font-size: 26px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: var(--text); }

  .section { margin-bottom: 28px; }
  .section-title {
    font-size: 16px; font-weight: 600; margin-bottom: 12px;
    padding-bottom: 6px; border-bottom: 1px solid var(--border);
  }
  .chart-box {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 12px; height: 400px;
  }

  .tab-bar { display: flex; gap: 4px; margin-bottom: 12px; }
  .tab-btn {
    background: var(--card); border: 1px solid var(--border); color: var(--text-dim);
    padding: 6px 18px; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 13px; font-family: 'Inter', sans-serif;
  }
  .tab-btn:hover { border-color: var(--input); color: var(--text); }
  .tab-btn.active {
    background: var(--border); color: var(--text); border-bottom-color: var(--border);
  }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  .provider-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .provider-card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px;
  }
  .provider-name { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--input); }
  .provider-stat { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
  .provider-stat .stat-label { color: var(--text-dim); }
  .provider-more { color: var(--text-dim); font-size: 11px; padding: 10px 4px 0; grid-column: 1 / -1; }

  .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .data-table th {
    background: var(--card); color: var(--text-dim); padding: 8px 10px;
    text-align: right; border-bottom: 1px solid var(--border); font-weight: 500;
    white-space: nowrap;
  }
  .data-table th:first-child { text-align: left; }
  .data-table td {
    padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--border);
    font-family: 'JetBrains Mono', monospace;
  }
  .data-table td:first-child {
    text-align: left; color: var(--text); font-family: 'Inter', sans-serif;
  }
  .data-table tbody tr:hover { background: rgba(42,42,53,0.4); }

  .pagination-ctrl {
    display: none; align-items: center; gap: 14px; justify-content: center;
    padding: 14px 0 4px;
  }
  .page-btn {
    background: var(--card); border: 1px solid var(--border); color: var(--text);
    padding: 5px 16px; border-radius: 4px; cursor: pointer;
    font-size: 12px; font-family: 'Inter', sans-serif; transition: border-color 0.15s, color 0.15s;
  }
  .page-btn:hover:not(:disabled) { border-color: var(--input); color: var(--input); }
  .page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .page-info {
    color: var(--text-dim); font-size: 12px;
    font-family: 'JetBrains Mono', monospace; min-width: 110px; text-align: center;
  }

  .empty-state {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 40px; text-align: center; color: var(--text-dim);
  }

  .footer {
    margin-top: 40px; padding: 16px 0; border-top: 1px solid var(--border);
    text-align: center; font-size: 11px; color: var(--text-dim);
  }

  @media (max-width: 768px) {
    .kpi-row { grid-template-columns: repeat(2, 1fr); }
    .provider-row { grid-template-columns: 1fr; }
    .container { padding: 12px 10px; }
    .header { flex-direction: column; gap: 6px; align-items: flex-start; }
    .chart-box { height: 300px; }
    .data-table { font-size: 11px; }
    .data-table th, .data-table td { padding: 4px 6px; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1><span>TokenWatch</span> Usage Report</h1>
    <div class="meta">${metaStr}</div>
  </div>

  ${kpiStr}

  <div class="section">
    <div class="section-title">Model Comparison Matrix</div>
    ${modelChartVisible ? '<div class="chart-box" id="model-chart"></div>' : '<div class="empty-state">No models with &ge;1M tokens in this period.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Provider Summary</div>
    <div class="provider-row">${providerStr}</div>
  </div>

  ${modelAnalyticsStr}

  <div class="section">
    <div class="section-title">Efficiency vs Cost</div>
    ${hasPerf ? '<div class="chart-box" id="scatter-chart"></div>' : '<div class="empty-state">No performance data available for this period.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Usage Timeline</div>
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="daily" onclick="switchTab('daily')">Daily Trend</button>
      <button class="tab-btn" data-tab="heatmap" onclick="switchTab('heatmap')">Heatmap</button>
    </div>
    <div id="tab-daily" class="tab-content active">
      <div class="chart-box" id="daily-chart"></div>
    </div>
    <div id="tab-heatmap" class="tab-content">
      <div class="chart-box" id="heatmap-chart"></div>
    </div>
  </div>

  <div class="footer">
    Generated by TokenWatch &middot; Data: SQLite + JSONL &middot; Export: <a href="javascript:void(0)" onclick="downloadJSON()" style="color:var(--input);text-decoration:none">JSON</a> <span style="color:var(--text-dim)">(saves to browser download folder)</span>
  </div>
</div>

<script id="report-data" type="application/json">${jsonData}</script>

<script>
var fmt = function(v) {
  if (v == null) return '\u2014';
  if (v >= 1000000000) return (v/1000000000).toFixed(1)+'B';
  if (v >= 1000000) return (v/1000000).toFixed(1)+'M';
  if (v >= 1000) return (v/1000).toFixed(1)+'K';
  return String(v);
};

// Usage Timeline tab switcher
window.switchTab = function(name) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab-btn[data-tab]').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector('[data-tab="' + name + '"]').classList.add('active');
  setTimeout(function() {
    if (name === 'daily' && window.dailyChart) window.dailyChart.resize();
    if (name === 'heatmap' && window.heatmapChart) window.heatmapChart.resize();
  }, 50);
};

// Model Analytics tab switcher
window.switchModelTab = function(name) {
  document.querySelectorAll('[data-mtab]').forEach(function(el) { el.classList.remove('active'); });
  ['model-tab-usage', 'model-tab-perf', 'model-tab-errors'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activeTab = document.getElementById('model-tab-' + name);
  if (activeTab) activeTab.classList.add('active');
  var activeBtn = document.querySelector('[data-mtab="' + name + '"]');
  if (activeBtn) activeBtn.classList.add('active');
};

// Generic paginator: hide/show tbody rows, show prev/next controls
function initPaginator(tableId, pageSize) {
  var tbody = document.querySelector('#' + tableId + ' tbody');
  if (!tbody) return;
  var rows = Array.from(tbody.querySelectorAll('tr'));
  if (rows.length <= pageSize) return; // 行数不超过一页时无需分页
  var totalPages = Math.ceil(rows.length / pageSize);
  var cur = 1;

  function render() {
    rows.forEach(function(r, i) {
      r.style.display = (i >= (cur - 1) * pageSize && i < cur * pageSize) ? '' : 'none';
    });
    var info = document.getElementById(tableId + '-info');
    if (info) info.textContent = 'Page ' + cur + ' / ' + totalPages + ' (' + rows.length + ' rows)';
    var prevEl = document.getElementById(tableId + '-prev');
    var nextEl = document.getElementById(tableId + '-next');
    if (prevEl) prevEl.disabled = cur === 1;
    if (nextEl) nextEl.disabled = cur === totalPages;
  }

  var prevEl = document.getElementById(tableId + '-prev');
  var nextEl = document.getElementById(tableId + '-next');
  if (prevEl) prevEl.addEventListener('click', function() { if (cur > 1) { cur--; render(); } });
  if (nextEl) nextEl.addEventListener('click', function() { if (cur < totalPages) { cur++; render(); } });

  var ctrl = document.getElementById(tableId + '-ctrl');
  if (ctrl) ctrl.style.display = 'flex';
  render();
}

${modelChartJs}
${scatterChartJs}
${dailyChartJs}
${heatmapJs}

window.downloadJSON = function() {
  var d = document.getElementById('report-data');
  if (!d) return;
  var b = new Blob([d.textContent], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'tokenwatch-data.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 100);
};

document.addEventListener('DOMContentLoaded', function() {
  ${modelChartVisible ? 'initModelChart();' : ''}
  ${hasPerf ? 'initScatterChart();' : ''}
  initDailyChart();
  initHeatmapChart();
  initPaginator('usage-table', 10);
  initPaginator('perf-table', 10);
  initPaginator('errors-table', 10);
});

window.addEventListener('resize', function() {
  ${modelChartVisible ? 'if (window.modelChart) window.modelChart.resize();' : ''}
  if (window.scatterChart) window.scatterChart.resize();
  if (window.dailyChart) window.dailyChart.resize();
  if (window.heatmapChart) window.heatmapChart.resize();
});
</script>
</body>
</html>`
}
