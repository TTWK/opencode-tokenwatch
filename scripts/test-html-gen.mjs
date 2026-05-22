import { generateUsageHtml } from '../src/generate-usage-html.ts';
import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('./tokenwatch-usage-report.json', 'utf-8'));
const report = {
  ...data,
  perfLogs: [],
  perfSummary: [],
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
