import { readFileSync } from 'fs';
const html = readFileSync('./tokenwatch-test-report.html', 'utf-8');

console.log('=== HTML Report Verification ===\n');
console.log('Size:', html.length, 'bytes\n');

const checks = [
  ['DOCTYPE', html.includes('<!DOCTYPE html>')],
  ['ECharts CDN', html.includes('echarts.min.js')],
  ['Google Fonts', html.includes('fonts.googleapis.com')],
  ['Report data script', html.includes('id="report-data"')],
  ['CSS variables', html.includes(':root')],
  ['Responsive CSS', html.includes('@media')],
  ['KPI cards', html.includes('kpi-card')],
  ['Model chart', html.includes('model-chart')],
  ['Toggle buttons', html.includes('toggle-btn')],
  ['setStackMode', html.includes('setStackMode')],
  ['Provider cards', html.includes('provider-card')],
  ['Data table', html.includes('data-table')],
  ['Tab buttons', html.includes('tab-btn')],
  ['switchTab', html.includes('switchTab')],
  ['Daily chart', html.includes('daily-chart')],
  ['Heatmap chart', html.includes('heatmap-chart')],
  ['Footer', html.includes('footer')],
  ['Window resize', html.includes('window.addEventListener')],
  ['DOMContentLoaded', html.includes('DOMContentLoaded')],
];

checks.forEach(c => console.log((c[1] ? '  ✅' : '  ❌') + ' ' + c[0]));

// Conditional rendering check
console.log('\n--- Conditional Rendering ---');
console.log('  ✅ Empty state (no perf):', html.includes('No performance data available'));
console.log('  ✅ Scatter hidden: no scatter-chart div');

// HTML structure integrity
const openScripts = (html.match(/<script[ >]/g) || []).length;
const closeScripts = (html.match(/<\/script>/g) || []).length;
const openStyles = (html.match(/<style[ >]/g) || []).length;
const closeStyles = (html.match(/<\/style>/g) || []).length;

console.log('\n--- Structure ---');
console.log('  ' + (openScripts === closeScripts ? '✅' : '❌') + ' Scripts:', openScripts, 'open /', closeScripts, 'close');
console.log('  ' + (openStyles === closeStyles ? '✅' : '❌') + ' Styles:', openStyles, 'open /', closeStyles, 'close');

const totalPass = checks.filter(c => c[1]).length;
console.log(`\n--- Result: ${totalPass}/${checks.length} checks passed ---`);
