import { generateUsageHtml } from '../src/generate-usage-html.ts';
import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('./tokenwatch-usage-report.json', 'utf-8'));

// Simulate performance data
const perfSummary = [
  { model: 'deepseek-v4-flash-free', providerID: 'opencode', requestCount: 669, totalInput: 1457766, totalOutput: 199117, totalCacheRead: 57555072, totalCacheWrite: 200000, totalCost: 0, avgTTFT: 320, maxTTFT: 1200, minTTFT: 80, avgTPS: 52.3, maxTPS: 89.1, minTPS: 12.4, avgLatency: 4800, maxLatency: 15000, minLatency: 800 },
  { model: 'mimo-v2-pro-free', providerID: 'opencode', requestCount: 523, totalInput: 1943645, totalOutput: 185873, totalCacheRead: 46011776, totalCacheWrite: 150000, totalCost: 0, avgTTFT: 450, maxTTFT: 1800, minTTFT: 120, avgTPS: 38.7, maxTPS: 72.3, minTPS: 8.9, avgLatency: 6200, maxLatency: 22000, minLatency: 1200 },
  { model: 'deepseek-v4-pro', providerID: 'deepseek', requestCount: 107, totalInput: 489109, totalOutput: 110795, totalCacheRead: 6756992, totalCacheWrite: 80000, totalCost: 2.355, avgTTFT: 820, maxTTFT: 2500, minTTFT: 200, avgTPS: 28.5, maxTPS: 55.0, minTPS: 5.2, avgLatency: 8900, maxLatency: 30000, minLatency: 1500 },
  { model: 'z-ai/glm-5.1', providerID: 'nvidia', requestCount: 129, totalInput: 6030236, totalOutput: 21621, totalCacheRead: 0, totalCacheWrite: 0, totalCost: 0, avgTTFT: 1200, maxTTFT: 3500, minTTFT: 400, avgTPS: 15.2, maxTPS: 30.1, minTPS: 3.5, avgLatency: 3500, maxLatency: 8000, minLatency: 1000 },
];

const report = {
  ...data,
  perfLogs: [],
  perfSummary,
  meta: {
    generatedAt: '2026-05-22 14:00:00',
    dateRange: {
      start: data.daily?.[data.daily.length - 1]?.day || '-',
      end: data.daily?.[0]?.day || '-'
    }
  }
};

const html = generateUsageHtml(report);
writeFileSync('./tokenwatch-test-report.html', html, 'utf-8');
console.log('OK size=' + html.length);
console.log('Has scatter chart:', html.includes('scatter-chart') ? 'YES' : 'NO');
console.log('Has perf data:', html.includes('TTFT') ? 'YES' : 'NO');
