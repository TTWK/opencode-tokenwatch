import { readFileSync } from 'fs';

const gen = readFileSync('./src/generate-usage-html.ts', 'utf-8');
const cmd = readFileSync('./src/commands.ts', 'utf-8');

const checks = [];

console.log('=== Fix Verification ===\n');

// 1. Scatter tooltip uses params.name not d[3]
checks.push(['Scatter tooltip uses params.name', gen.includes("'<b>' + params.name + '</b><br/>'")]);

// 2. Scatter colored by provider
checks.push(['Scatter provider colors', gen.includes('providerColors')]);
checks.push(['Scatter per-provider itemStyle', gen.includes("color: providerColors[d.provider]")]);

// 3. Scatter tooltip includes TPS
checks.push(['Scatter tooltip has TPS', gen.includes("'TPS: ' + (d.tps")]);

// 4. Absolute/percent toggle properly transforms data
checks.push(['Percent mode stack', gen.includes("stack: isPercent ? 'percent' : 'tokens'")]);
checks.push(['Percent mode data transform', gen.includes("v / totals[i] * 100")]);

// 5. Footer has export link
checks.push(['Footer JSON export', gen.includes("download='tokenwatch-data.json'")]);
checks.push(['Footer data source', gen.includes("SQLite + JSONL")]);

// 6. Provider cards have colored borders
checks.push(['Provider card border color', gen.includes("border-color:${providerBorderColor")]);

// 7. /usage text displays formatted output
checks.push(['Text report shows formatted', cmd.includes("formatted")]);

const allPass = checks.every(c => c[1]);
checks.forEach(c => console.log((c[1] ? '  ✅' : '  ❌') + ' ' + c[0]));
console.log(`\n${allPass ? '✅ All ' + checks.length + ' fixes verified' : '❌ Some fixes missing'}`);
