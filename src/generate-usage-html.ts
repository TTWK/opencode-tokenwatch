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
  return [...models].sort((a, b) => b.totalTokens - a.totalTokens)
}

function renderMeta(data: CombinedReportData): string {
  const m = data.meta
  return `TokenWatch Usage Report · ${m.dateRange.start} → ${m.dateRange.end} · generated ${m.generatedAt}`
}

function renderKpiCards(data: CombinedReportData): string {
  const s = data.summary
  const hitRate = cacheHitRate(s.inputTokens, s.cacheRead)
  const hitRatePct = fmtPercent(hitRate)
  const avgTpsRaw = s.requestCount > 0 && data.perfSummary.length > 0
    ? data.perfSummary.reduce((sum, p) => sum + (p.avgTPS ?? 0) * p.requestCount, 0) /
      data.perfSummary.reduce((sum, p) => sum + p.requestCount, 0)
    : 0
  const avgTps = avgTpsRaw ? avgTpsRaw.toFixed(1) : '—'
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
        type: 'line',
        yAxisIndex: 1,
        data: modelTps,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#FFB800', width: 2 },
        itemStyle: { color: '#FFB800' },
        label: {
          show: true,
          position: 'right',
          formatter: function(p) { return p.value != null ? p.value.toFixed(1) : ''; },
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
  if (data.perfSummary.length === 0) return ""

  const providerColors: Record<string, string> = {
    opencode: "#00F593", deepseek: "#00D1FF", nvidia: "#B545FF", modelscope: "#FFB800",
  }

  const scatterData = data.perfSummary.map(p => {
    // Bug fix: 分母补入 cacheRead/cacheWrite，cost 由所有 token 产生（含缓存）
    // 原公式仅用 input+output，高缓存场景下分母偏小，costPer1K 虚高
    const billable = p.totalInput + p.totalOutput + p.totalCacheRead + p.totalCacheWrite
    const costPer1K = billable > 0 ? (p.totalCost / billable) * 1000 : 0
    return {
      name: p.model,
      provider: p.providerID,
      tps: p.avgTPS,
      value: [p.avgTTFT != null && p.avgTTFT > 0 ? p.avgTTFT : 0.01, costPer1K, p.requestCount]
    }
  })

  return `
var scatterData = ${JSON.stringify(scatterData)};
var providerColors = ${JSON.stringify(providerColors)};

function initScatterChart() {
  var el = document.getElementById('scatter-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.scatterChart = chart;
  var option = {
    tooltip: {
      formatter: function(params) {
        var d = params.data;
        return '<b>' + params.name + '</b><br/>' +
          'Provider: ' + (d.provider || '\u2014') + '<br/>' +
          'TTFT: ' + (d.value[0] != null ? d.value[0].toFixed(1) + 'ms' : '\u2014') + '<br/>' +
          'TPS: ' + (d.tps != null ? d.tps.toFixed(1) : '\u2014') + '<br/>' +
          'Cost/1K: $' + d.value[1].toFixed(4) + '<br/>' +
          'Requests: ' + d.value[2];
      }
    },
    grid: { left: 80, right: 40, bottom: 60, top: 30 },
    xAxis: {
      type: 'log',
      name: 'TTFT (ms)',
      min: 0.01,
      nameTextStyle: { color: '#B0B0C0' },
      axisLabel: { color: '#B0B0C0' },
      splitLine: { lineStyle: { color: '#2A2A35', type: 'dashed' } }
    },
    yAxis: {
      type: 'value',
      name: 'Cost per 1K tokens',
      nameTextStyle: { color: '#B0B0C0' },
      axisLabel: { color: '#B0B0C0', formatter: function(v) { return '$' + v.toFixed(4); } },
      splitLine: { lineStyle: { color: '#2A2A35', type: 'dashed' } }
    },
    series: [{
      type: 'scatter',
      data: scatterData.map(function(d) {
        return {
          value: d.value,
          name: d.name,
          provider: d.provider,
          tps: d.tps,
          itemStyle: { color: providerColors[d.provider] || '#B545FF' }
        };
      }),
      symbolSize: function(val) {
        return Math.max(8, Math.min(40, Math.sqrt(val[2]) * 3));
      },
      itemStyle: { opacity: 0.8 },
      label: {
        show: true,
        formatter: function(p) { return p.name; },
        position: 'right',
        color: '#B0B0C0',
        fontSize: 10
      }
    }]
  };
  chart.setOption(option);
  chart.resize();
}`
}

function providerBorderColor(provider: string): string {
  const colors: Record<string, string> = { opencode: "#00F593", deepseek: "#00D1FF", nvidia: "#B545FF", modelscope: "#FFB800", }
  return colors[provider] || "#2A2A35"
}

function renderProviderCards(data: CombinedReportData): string {
  return data.providers.map(p => {
    const modelCount = data.models.filter(m => m.provider === p.provider).length
    const perfItems = data.perfSummary.filter(ps => ps.providerID === p.provider)
    const avgTtft = perfItems.length > 0
      ? perfItems.reduce((s, x) => s + (x.avgTTFT ?? 0) * x.requestCount, 0) /
        perfItems.reduce((s, x) => s + x.requestCount, 0)
      : null
    const avgTps = perfItems.length > 0
      ? perfItems.reduce((s, x) => s + (x.avgTPS ?? 0) * x.requestCount, 0) /
        perfItems.reduce((s, x) => s + x.requestCount, 0)
      : null

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
}

function renderDataTable(data: CombinedReportData): string {
  const rows = sortModelsByUsage(data.models).map(m => {
    const hitRate = cacheHitRate(m.inputTokens, m.cacheRead)
    const hitRatePct = fmtPercent(hitRate)
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
      <td style="color:${hitColor};font-weight:600">${hitRatePct}</td>
      <td>${ttft}</td>
      <td style="color:var(--tps);font-size:0.85em">${p95ttft}</td>
      <td>${tps}</td>
      <td>${fmtCost(m.totalCost)}</td>
    </tr>`
  }).join("\n")

  return `<table class="data-table">
    <thead>
      <tr>
        <th>Model</th>
        <th>Provider</th>
        <th>Req</th>
        <th>Total</th>
        <th>Input</th>
        <th>Output</th>
        <th>Cache</th>
        <th>Hit Rate</th>
        <th>Avg TTFT</th>
        <th>P95 TTFT</th>
        <th>TPS</th>
        <th>Cost</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}

/** 渲染 P50/P95/P99 延迟分位数表格 */
function renderPerfPercentileTable(data: CombinedReportData): string {
  if (data.perfSummary.length === 0) return ''

  const fmtMs = (v: number | null | undefined) =>
    v != null ? v.toFixed(0) + 'ms' : '—'

  const rows = data.perfSummary.map(p => {
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

  return `
  <section class="section">
    <h2 class="section-title">Performance Latency Percentiles</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Req</th>
          <th>Avg TTFT</th>
          <th>P50 TTFT</th>
          <th>P95 TTFT</th>
          <th>P99 TTFT</th>
          <th>Avg E2E</th>
          <th>P50 E2E</th>
          <th>P95 E2E</th>
          <th>P99 E2E</th>
          <th>Cache Hit</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`
}

/** 渲染失败请求统计区域 */
function renderErrorStatsSection(data: CombinedReportData): string {
  const errors = (data as any).errors as {
    successCount: number; failedCount: number; errorRate: number
    byModel: Array<{ provider: string; model: string; failed: number; total: number }>
  } | undefined

  if (!errors || errors.failedCount === 0) return ''

  const errorRatePct = (errors.errorRate * 100).toFixed(2) + '%'
  const rateColor = errors.errorRate >= 0.05 ? 'var(--output)'
    : errors.errorRate > 0 ? 'var(--tps)' : 'var(--cache)'

  const rows = errors.byModel
    .filter(m => m.failed > 0)
    .map(m => {
      const modelRate = m.total > 0 ? (m.failed / m.total * 100).toFixed(1) + '%' : '—'
      return `<tr>
        <td>${m.provider}</td>
        <td>${m.model}</td>
        <td>${m.total}</td>
        <td style="color:var(--output)">${m.failed}</td>
        <td style="color:var(--tps)">${m.total - m.failed}</td>
        <td style="color:${errors.errorRate >= 0.05 ? 'var(--output)' : 'var(--tps)'}">${modelRate}</td>
      </tr>`
    }).join('\n')

  return `
  <section class="section">
    <h2 class="section-title">Failed Requests
      <span style="margin-left:12px;font-size:0.85em;color:${rateColor}">
        overall error rate: ${errorRatePct} (${errors.failedCount} failed / ${errors.successCount + errors.failedCount} total)
      </span>
    </h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Provider</th><th>Model</th><th>Total</th>
          <th>Failed</th><th>Success</th><th>Error Rate</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`
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
  const tableStr = renderDataTable(data)
  const perfPercentileStr = renderPerfPercentileTable(data)
  const errorStatsStr = renderErrorStatsSection(data)
  const dailyChartJs = renderDailyTrendInit(data)
  const heatmapJs = renderHeatmapInit(data)
  const hasPerf = data.perfSummary.length > 0
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
    ${modelChartVisible ? '<div class="chart-box" id="model-chart"></div>' : '<div class="empty-state">No models with >=1M tokens in this period.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Provider Summary</div>
    <div class="provider-row">${providerStr}</div>
  </div>

  <div class="section">
    <div class="section-title">Detailed Data Grid</div>
    ${tableStr}
  </div>

  ${perfPercentileStr}

  ${errorStatsStr}

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

window.switchTab = function(name) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector('[data-tab="' + name + '"]').classList.add('active');
  setTimeout(function() {
    if (name === 'daily' && window.dailyChart) window.dailyChart.resize();
    if (name === 'heatmap' && window.heatmapChart) window.heatmapChart.resize();
  }, 50);
};

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
