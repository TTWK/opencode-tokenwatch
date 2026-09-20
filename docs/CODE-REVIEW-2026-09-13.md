# opencode-tokenwatch 全项目代码审查报告（2026-09-13）

> 审查时间：2026-09-13
> 审查基线：`main @ 33b67f1`（v0.6.0）
> 审查范围：`src/` 全部 20 个源文件（约 5800 行）、`build.tui.mjs`、`package.json`/`tsconfig.json`、`scripts/` 验证脚本、`README.md`/`README.en.md`、`AGENTS.md`、`dist/` 实际产物
> 审查方式：逐文件人工细读 + 实际执行 `npm run build`、`npx tsc --noEmit`、检查 `dist/` 产物内容 + 全项目调用点交叉验证（grep）
> 结论密度：确认 3 个高优先级问题（1 个口径 bug、1 个产物级构建缺陷、1 个缓存失效缺失），中/低优先级问题 16 项

---

## 总体评价

架构质量良好——"共享内核 + 双宿主适配"分层清晰，统计口径有意识地对齐宿主官方源码，错误处理普遍有 try/catch 兜底，配备无头验证 harness。但存在以下问题需修复：v2 错误率显示放大 100 倍、`dist/server.js` 构建产物损坏（惰性加载设计完全失效）、v2 用量缓存永不失效，以及若干性能、安全加固与文档漂移问题。

---

## 🔴 高优先级

### 1. v2 错误率口径与 v1/HTML 报告不一致，显示放大 100 倍
- **位置**：`src/host/v2/data-source.ts:325` vs `src/host/v1/data-source.ts:412-414`，消费方 `src/kernel/report-html.ts:52-54, 463-464`
- **问题**：v2 的 `scan()` 返回 `errorRate = failed/total * 100`（百分数），而 v1 的 `getErrorStats` 返回**小数**（0~1）。HTML 报告两处都按小数处理：`(errors.errorRate * 100).toFixed(1) + '%'`，且用 `errorRate >= 0.05` 判定红色告警。结果 v2 用户看 HTML 报告时错误率**放大 100 倍**（实际 2% 显示为 "200.0%"），且任何非零错误率都恒触发 `>= 0.05` 的红色阈值。
- **建议**：统一为小数口径（改动 v2 一行即可），或给 `ErrorStats` 加文档注释明确量纲并在一处归一化。

### 2. `dist/server.js` 构建产物损坏：JSX 被编译成 `React.createElement`，"惰性加载"设计完全失效
- **位置**：`build.tui.mjs:50-54`（server 构建未挂 solidPlugin）、`src/server.ts:21`（动态 import）
- **问题**（已在实际产物中验证）：`bundle: true` 使 esbuild 把 `import("./tui.js")` 静态内联进了 server.js，导致：
  1. 整个 TUI 代码图（含 sidebar.tsx 全部 JSX）被打进 server.js（156KB），而 server 构建没有 solidPlugin，esbuild 回退到 classic JSX transform，产物中出现 **22 处 `React.createElement` 且 `React` 未定义、未导入**——这条兜底链路一旦被执行（宿主从包主入口 `.` 调用 `setup()`）必然抛 `ReferenceError: React is not defined`；
  2. `solid-js`、`@opentui/core` 的 import 被**提升到文件顶部**（dist/server.js:516-517）——server.ts 注释声称"避免 server 进程在加载阶段解析 @opentui 依赖"，实际恰好相反，server 进程加载时就必须解析这些包；
  3. 构建时 esbuild 已发出 4 条 `unsupported-jsx-comment` 警告，但被脚本忽略。
- **建议**：server 构建时把 `./tui.js` 加入 `external`，让动态 import 在运行时真正落到 `dist/tui.js`；同时在构建脚本中对产物做断言（不得含 `React.createElement` / `@opentui` 静态导入）。

### 3. v2 用量缓存永不失效，报告数据会"停在首次扫描时刻"
- **位置**：`src/host/v2/data-source.ts:420-422`（`invalidateUsageCache` 导出但全项目零调用）
- **问题**：模块级 `cache` 只在首次 `/usage` 时构建，之后同一 TUI 进程内永不更新。用户跑了一下午会话后再打开"今天"的报告，新增请求全部缺失——对"今天"这种高频使用的预设，数据陈旧相当反直觉（README 也未提这个限制）。
- **建议**：至少在 `session.idle` 事件或每次打开报告时做增量失效/重扫，或对 "today" 预设强制绕过缓存；退一步也应在报告中标注数据截止时间（`builtAt` 已有，未展示）。

---

## 🟡 中优先级

### 4. HTML 报告存在注入风险（`</script>` 越界 + HTML 未转义）
- **位置**：`src/kernel/report-html.ts:932`（`<script id="report-data" type="application/json">${jsonData}</script>`）、`:96-100, 258-264` 等（`JSON.stringify` 直插 JS 块）、`:413-426`（`m.model`/`m.provider` 直插表格 HTML）
- **问题**：`JSON.stringify` 不转义 `/`，任何字符串值含 `</script>` 即可突破 script 块。`jsonData` 内嵌完整 `data.sessions`，而**会话标题是模型生成的内容**——被提示注入的模型输出或恶意 provider 返回的模型名可以把任意脚本注入报告页，且报告会自动在浏览器打开。模型/供应商名直插 HTML 同理。
- **建议**：序列化后统一执行 `.replace(/</g, "\\u003c")`；所有插值进 HTML 的字符串过一遍 escapeHtml。

### 5. `tokenwatch-stats.json` 非原子写入 + 每请求全量读写，崩溃即丢失全部历史
- **位置**：`src/kernel/store.ts:46-51`（直接 `writeFileSync` 覆盖）、`:127-142`（每次请求完整 read→parse→改→serialize→write）
- **问题**：该文件承载"永久累积"的全部性能统计（含 500×N Reservoir 样本），写入中途崩溃/断电 → JSON 损坏 → `loadStatsFile` 静默返回空白 → **多年历史一次清零**。且每完成一个请求都在 TUI 线程做同步全量 I/O，文件越大卡顿越明显。v1+v2 双宿主同时运行时还有 read-modify-write 互相覆盖的竞态。
- **建议**：改为"临时文件 + rename"原子写；写入做节流（如每 N 条或每秒一次批量落盘）。

### 6. KV 存储无限增长：每个会话的完整消息数组永久驻留
- **位置**：`src/host/runtime.tsx:95-99, 168-179`（每条消息更新就全量重写该会话数组，key=`tokenwatch-msgs-{sessionID}`）、`src/host/v2/adapter.ts:89-109`（v2 下所有 key 收拢进一个 store，每次 set 异步重写整个 `values` 映射）
- **问题**：`tokenwatch-msgs-*` 没有任何清理/淘汰路径，长期使用后 KV 无界膨胀（v2 尤甚：每次 mutate 序列化的 payload 包含**所有**会话的历史数组）。数组本身也是 O(消息数) 的全量重写，长会话累积写放大 O(n²)。
- **建议**：为 KV 条目加淘汰策略（如仅保留最近 N 个会话）；写节流。

### 7. 侧边栏在每个流式 delta 上做全量重算，长会话可能拖慢 TUI
- **位置**：`src/ui/sidebar.tsx:238-244`（`perfStats` memo 依赖 `partVersion`）、`:246-319`（`tokenDistribution` 对全部消息逐条调 `messageParts` + `estimateTokens`）、`:330-333`（`onPartUpdated` → 每个 content 更新都 bump）
- **问题**：v2 下 `session.message.content.updated` 每个流式片段触发一次；每次触发会：重走全部消息的 token 估算（O(全对话字符数)）+ `getSessionStats()` 对每模型做 2 次 500 元素数组拷贝与排序（`finalizeAccumulator`）。长会话 + 高频流式时是可感知的开销。
- **建议**：`perfStats` 只在消息完成（`onMessageUpdated`）时失效；`tokenDistribution` 改为增量累积或节流（如 500ms debounce）。

### 8. 【需实测验证】v1 的 TTFT 可能被 `step-start` part 污染，恒为毫秒级
- **位置**：`src/kernel/perf.ts:66-67`（守卫只排除 `type === "step"` 和 `"part-open"`，这是 v2 的事件命名）、`src/host/v1/adapter.ts:87-96`（v1 原样透传 part.type）
- **问题**：opencode v1 的 part 类型含 `step-start`/`step-finish`（带 `time.start`）。若 v1 的 `message.part.updated` 对这些 part 也发事件，`isFirstTokenAnchor` 判定为 true（`"step-start" !== "step"`），`step-start` 会成为"首 token 锚点"→ v1 TTFT ≈ 请求起始差值（个位数 ms）——正是 AGENTS.md 里描述过、只为 v2 修掉的那个 bug。现有验证脚本（verify-tps.mjs）只模拟 v2 事件序列，v1 路径未被覆盖。
- **建议**：用真实 v1 宿主验证；在 `handlePartUpdated` 中把 `step-start`/`step-finish` 一并归入窗口锚点而非首 token 锚点。

### 9. UTC / 本地日期混用，边界日期漂移一天
- **位置**：`src/host/command-actions.ts:113-117`（`daysAgo` 用 `toISOString()` 取 UTC 日期，而 `stamp()`（:41-46）用本地日期）、`src/host/v1/commands.tsx:168, 183`（JSON/文本导出文件名用 `toISOString()`）
- **问题**：非 UTC 时区的早晚 8 小时内，"最近 7 天/30 天"的起始日期会与本地日分桶错位一天；v1 的 JSON/文本导出在晚间会落错"当天"文件名（v2 路径用 `command-actions.stamp()` 是对的）——同一功能两条实现已经漂移。
- **建议**：抽一个 `localDateStr()`（report.ts 里已有私有实现）到公共处统一使用。

### 10. v1 SQL 子进程调用：引号转义与注入面加固
- **位置**：`src/host/v1/data-source.ts:43-50, 121-127`（`exec(`opencode db ${JSON.stringify(sql)} ...`)`）
- **问题**：用 `JSON.stringify` 做 shell 引号在 Windows cmd 下语义不匹配（cmd 不认 `\"`）：若 filter 值含 `"`（`escapeSql` 只转义 `'`），会提前闭合引号使后续 `&`/`|` 等元字符脱离引号——目前 filter 值不来自用户输入，实际可利用性低，但属于纵深防御缺口；另外 `if (stderr) throw` 会把 CLI 写到 stderr 的无害警告当成失败。
- **建议**：改用 `execFile`（数组传参）或对 filter 值做字符白名单清洗；stderr 仅在有 stderr 且无 stdout 时才判失败。
  - **执行说明**：`execFile` 直接改用在 Windows 上有回归风险（npm 全局安装的 `opencode` 是 `.cmd` shim，Node 对 `shell:false` 的 `.cmd` 直接抛 EINVAL），故本项以"清洗 filter 值中的 `"`/`%` 等 cmd 元字符 + stderr 判定修正"实现同等防御。

### 11. "全部时间"报告的时间线被静默截断，且 v1/v2 行为不一致
- **位置**：`src/host/v1/data-source.ts:291`（daily `LIMIT 30`）、`:325`（sessions `LIMIT 15`）vs v2 `scan()`（无上限）
- **问题**：选"全部时间"生成 HTML 报告时，v1 的 Usage Timeline/Heatmap 只画最近 30 天（`buildCombinedData` 的 `dateRange` 也取自 daily，报告头显示的日期范围随之缩水），而 v2 是全量——同一份报告两代宿主数据范围不同，且无任何提示。
- **建议**：daily 限制放开或随 range 过滤动态调整；截断时在图表区标注。

### 12. v2 全量扫描的静默截断与不可见的告警
- **位置**：`src/host/v2/data-source.ts:96`（会话最多 64 页 × 500）、`:122`（单会话消息最多 400 页 × 200）、`:300`（跳过的会话仅 `console.warn`）
- **问题**：超限即静默丢数据；TUI 里 `console.warn` 用户根本看不到，个别会话加载失败只会表现为"报告数字莫名偏小"。
- **建议**：触发上限时通过 `host.notify` 提示；把 skipped 数量并入报告元信息。

---

## 🟢 低优先级

### 13. 死代码与冗余（v0.6.0 刚做过清理，仍残留一批）
- `src/host/v1/adapter.ts:144-160` `registerCommands` 与 `:169-179` `alert/select`：v1 实际走 `v1/commands.tsx`，这两个接口实现不可达。
- `src/kernel/report.ts:24-35` `aggregatePerfStats`：src 内无调用方。
- `src/kernel/perf.ts:52-53` `ttftSamples`/`latencySamples`：只清空从不写入。
- `src/kernel/store.ts:19`（`RESERVOIR_SIZE` 重复定义）与 `:106-114`（`percentile` 与 `computePercentile` 重复）。
- `src/host/v2/data-source.ts:332-336` `filters_skipSession` 恒返回 false；`:168, 293` `lastDay` 赋值后 `void` 丢弃。
- `src/kernel/format.ts:460-468` `TokenDistribution` 接口无使用方；`i18n.ts` 的 `agent` 键同理。
- `src/host/v1/commands.tsx:284-289` `setLanguageSetting`/`toggleSidebarSetting` 与 `kernel/config.ts` 重复实现，且 `saveConfig` 内部已 `bumpVersion`，这里又手动 bump 一次（双重自增，说明两套路径已漂移）。
- **建议**：合并 v1 commands 到 `command-actions.ts`（它本来就是为此建的，目前只有 v2 在用），一并消除 UTC 日期漂移（见 #9）。

### 14. AGENTS.md 大面积文档漂移
- **位置**：`AGENTS.md:124-157`（核心数据流仍引用 `perf-tracker.ts`/`stats-store.ts`/`queries.ts` 等旧路径）、`:192-249`（"关键文件详解"整节指向重构前不存在的文件）、`:51-54`（项目结构树中 `src/tui.tsx` 与 `src/server.ts` 各列出两次）
- **建议**：按现结构重写"核心数据流""关键文件详解""重要数据类型"三节。

### 15. README 特性描述与实际功能不符
- **位置**：`README.md:11`（"错误率统计"：侧边栏并不展示错误率，仅 HTML 报告有）、`README.md:8`（"含 P50/P95/P99 延迟分位数"：侧边栏只显示最近一次请求值）。README.en.md 对应行同。
- **建议**：把这两条明确标注为"HTML 报告"功能。

### 16. package.json 依赖声明自相矛盾
- **位置**：`package.json:64-66`（devDependencies `@opentui/*: ^0.2.9`）vs `:75-77`（peerDependencies `>=0.5.0`）；`:62`（`@opencode-ai/plugin: "latest"` 未固定）
- **问题**：本地开发/构建针对 0.2.x 类型检查，却声明要求宿主提供 ≥0.5.0——类型兼容性实际未验证过；`latest` 使构建不可复现。
- **建议**：把 devDeps 升到与 peers 一致的版本范围；`plugin` 固定到具体版本。

### 17. 渲染路径中的副作用（Solid 反模式）
- **位置**：`src/host/runtime.tsx:196-199`（slot render 回调里调 `switchSession`，内部会 `setSignal` + 同步全量读 JSONL）、`:136-140`（signal updater 内执行 `persist` 副作用）
- **建议**：把会话切换移到 `createEffect`/事件回调（至少微任务	defer）；`loadSession` 的 JSONL 重放改异步。

### 18. 无 CI、无单元测试
- **位置**：仓库无 `.github/`；测试仅 `scripts/verify-*.mjs` 冒烟脚本（未接入任何自动触发）
- **建议**：至少加一个 GitHub Actions：`tsc --noEmit` + build + verify-headless + verify-tps（全部无需真实宿主）。

### 19. 其他小项
- `src/kernel/i18n.ts`：缺 `other` 键，侧边栏 Token 分布的兜底桶会显示未翻译的 "other"（`sidebar.tsx:629` `t(role)`）。
- `format.ts:113` `formatCost`（<0.01 用 4 位小数）与 `report-html.ts:12`（6 位小数）不一致。
- `src/kernel/perf.ts:154-157`：日志轮转是"整读整写"，非原子，可改 `fs.rename` 轮转。
- `report.ts:45-52` `openInBrowser` 的 `execSync` 在浏览器启动挂起时最长阻塞 TUI 5 秒，可改 `spawn` + `detached`。
- `src/host/v2/data-source.ts:386-388`：会话级 model 过滤用的是会话"首个非 unknown"模型，多模型会话的过滤语义与 v1 SQL（逐消息过滤）不一致——API 层语义应记录。
- `src/host/runtime.tsx:53-81` `rebuildFromMessages` 读取 `msg.tokens`/`msg.cost` 平铺字段，与 v2 消息形状吻合；v1 `api.state.session.messages()` 的返回形状建议同样加防御（`msg.info?.tokens` 兜底）。
- 根目录 `tokenwatch-test-report.html`、`tokenwatch-usage-report.json` 为本地测试残留（已被 .gitignore 覆盖、未入库），建议删除。

---

## 做得好的地方（保持）

- 双代兼容的"宿主调用哪个入口即是代际判断"设计干净利落，`HostAdapter` 契约抽象到位；v2 keymap 需 owner 挂载的坑有清晰注释和明确解法。
- 统计口径对照官方源码逐项复核（AGENTS.md 参照表），TPS/TTFT/本地时区等修复都有出处和理由注释。
- 无头验证 harness（verify-headless/verify-tps）对 mock 宿主驱动两条链路的思路很实用。
- 全项目 try/catch 卫生良好，非关键路径失败均静默降级且注释了取舍。

---

## 修复跟踪

| # | 严重度 | 状态 | 修复说明 |
|---|---|---|---|
| 1 | 🔴 高 | ✅ 已修复 | v2 `errorRate` 改为小数口径，与 v1/HTML 报告一致 |
| 2 | 🔴 高 | ✅ 已修复 | server 构建将 `./tui.js` 设为 external，产物加断言防回归 |
| 3 | 🔴 高 | ✅ 已修复 | `session.idle` 标记脏；打开报告时旧快照立即返回 + 后台重建（stale-while-revalidate） |
| 4 | 🟡 中 | ✅ 已修复 | JSON 注入 `<` 转义为 `\u003c`；HTML 插值统一 escapeHtml |
| 5 | 🟡 中 | ✅ 已修复 | stats.json 改"临时文件 + rename"原子写；1 秒合并落盘 + 进程退出强制刷盘 |
| 6 | 🟡 中 | ✅ 已修复 | KV 消息数组写节流（500ms 合并）+ MRU 索引淘汰（保留最近 20 个会话） |
| 7 | 🟡 中 | ✅ 已修复 | partVersion 改 500ms 节流；`perfStats` 不再依赖 delta 版本号 |
| 8 | 🟡 中 | ✅ 已修复 | `step-start`/`step-finish` 归入流式窗口锚点，不参与 TTFT |
| 9 | 🟡 中 | ✅ 已修复 | `localDateStr` 导出为公共工具，`daysAgo`/v1 导出文件名统一本地日期 |
| 10 | 🟡 中 | ✅ 已修复 | filter 值清洗 `"`/`%`/换行等 cmd 元字符；stderr 仅在无 stdout 时判失败 |
| 11 | 🟡 中 | ✅ 已修复 | v1 daily 默认上限提至 365，截断时报告时间线区显示提示 |
| 12 | 🟡 中 | ✅ 已修复 | 扫描上限触发/会话跳过改经 `ctx.ui.toast` 提示 |
| 13 | 🟢 低 | ✅ 已修复 | 清理本报告所列死代码；`HostAdapter.registerCommands` 改为可选 |
| 14 | 🟢 低 | ✅ 已修复 | AGENTS.md 数据流/关键文件详解/数据类型三节按现结构重写 |
| 15 | 🟢 低 | ✅ 已修复 | README 中英双语文案与实际功能对齐 |
| 16 | 🟢 低 | ✅ 已修复 | devDeps 对齐 peers（@opentui ^0.5.11），`@opencode-ai/plugin` 固定 1.18.30 |
| 17 | 🟢 低 | ✅ 已修复 | 会话切换移入微任务；`loadSession` JSONL 重放异步化（带过期令牌防串话） |
| 18 | 🟢 低 | ✅ 已修复 | 新增 `.github/workflows/ci.yml`（typecheck + build + verify-headless + verify-tps） |
| 19 | 🟢 低 | ✅ 已修复 | i18n `other` 键、fmtCost 统一、rename 轮转、openInBrowser 改 spawn detached、v2 过滤语义注释、rebuildFromMessages v1 形状防御、清理根目录残留 |
