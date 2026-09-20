# opencode-tokenwatch × opencode v2 兼容性调研报告

> 调研日期：2026-09-01
> 调研对象：本机 `opencode-tokenwatch@0.5.0`（main @ f5f553d + 未提交改动） vs opencode v1.18.25 / opencode2 beta
> 结论一句话：**单包双版本兼容"技术上可行"，但当前未提交的适配层实现不可采纳；正确路径是"共享内核 + 双宿主适配 + 双包体动态分发"。**

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 单一 npm 包能否同时被 v1.18 与 v2 加载？ | **能。** 两代加载器都只做鸭子类型校验且都忽略多余字段，默认导出 `{ id, tui, setup }` 可同时通过两者 |
| 一套 JSX 产物能否同时跑在两代宿主上？ | **不能。** `@opentui/*` 由宿主二进制提供且两代版本区间不重叠，同一份预编译 JSX 无法跨代兼容 |
| 能否用一个"v1 API 模拟层"让现有 v1 代码原样跑在 v2 上？ | **能跑起来，但不推荐。** v2 有更优的原生事件（`session.step.ended` 直接携带 tokens/cost），模拟层反而丢精度、丢能力、长期维护成本高 |
| 最大的不可逆障碍是什么？ | **`opencode db` 子命令在 v2 中被移除**，`queries.ts` 全部 7 条 SQL 无对应物，历史统计层必须重写 |
| 当前未提交代码该保留吗？ | **不要合入 main。** 保留到分支做参考，但存在签名级致命 bug，建议按推荐架构重写 |

---

## 1. 调研方法与证据来源

所有结论均可复现，未使用推测：

| 证据 | 来源 |
|---|---|
| v1 插件加载契约 | `anomalyco/opencode` 分支 `2.0` → `packages/opencode/src/plugin/shared.ts`（`readV1Plugin`）、`packages/opencode/src/cli/cmd/tui/plugin/runtime.ts:604,735` |
| v2 插件加载契约 | `anomalyco/opencode` 分支 `beta` → `packages/tui/src/plugin/context.tsx:628,682-692` |
| v2 插件 API 类型 | `npm pack @opencode-ai/plugin@0.0.0-beta-18743` → `dist/tui/context.d.ts`、`dist/tui/plugin.js` |
| v1 插件 API 类型 | `npm pack @opencode-ai/plugin@1.18.25` → `dist/tui.d.ts`（`TuiPluginApi`） |
| v2 事件与数据结构 | `npm pack @opencode-ai/client@0.0.0-beta-18743` → `dist/promise/generated/types.d.ts` |
| v2 CLI 命令全集 | beta 分支 `packages/cli/src/commands/commands.ts`（`Spec.make(...)` 枚举） |
| v2 插件配置结构 | beta 分支 `packages/tui/src/config/index.tsx:58` |
| 运行时依赖供给方式 | 本机 `~/.cache/opencode/` 与 `node_modules/opencode-ai/` 实际目录扫描 |

版本事实（npm dist-tags）：

```
@opencode-ai/plugin  latest = 1.18.25            （v1 线）
@opencode-ai/plugin  beta   = 0.0.0-beta-18743   （v2 线，版本号从 0.0.0 重新起算）
@opencode-ai/cli     next/latest = 0.0.0-beta-17823 → 二进制名为 opencode2
```

注意：仓库 `2.0` 分支是 **v1 代码线**（其 `packages/opencode/package.json` 版本 1.4.3），真正的 opencode2 在 **`beta` 分支**，包结构已完全重排（`packages/tui`、`packages/cli`、`packages/stats`，原 `packages/opencode` 已消失）。

---

## 2. 关键差异分析

### 2.1 模块契约：两边都"不查多余字段"（决定性利好）

**v1**（`readV1Plugin`, strict 模式）：

```ts
const server = "server" in value ? value.server : undefined
const tui    = "tui"    in value ? value.tui    : undefined
if (server !== undefined && tui !== undefined)
  throw new TypeError(`... must default export either server() or tui(), not both`)
if (kind === "tui" && tui === undefined)
  throw new TypeError(`... must default export an object with tui()`)
return value   // ← 不校验其它字段
```

**v2**（`packages/tui/src/plugin/context.tsx`）：

```ts
if (!isPlugin(mod.default)) throw new Error(`Invalid V2 TUI plugin module: ${spec}`)

function isPlugin(value: unknown): value is Plugin.Definition {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "setup" in value && typeof value.setup === "function"
}
```

并且 `Plugin.define` 是恒等函数（`export function define(plugin){ return plugin }`），**运行时零校验**。

> ✅ **推论：默认导出 `{ id, tui, setup }` 同时满足两代加载器。**
> v1 读 `tui` 并忽略 `setup`；v2 校验 `id`+`setup` 并忽略 `tui`。
> 约束只有一条：**`tui` 与 `server` 不能同时出现在同一个入口对象里**（本项目的 `./tui` 与 `./server` 本就是两个独立入口，天然满足）。

### 2.2 API 能力对照

| 能力 | v1 (`TuiPluginApi`) | v2 (`Context`) | 可桥接性 |
|---|---|---|---|
| 事件订阅 | `event.on("message.updated" / "message.part.updated" / "message.removed")` | `data.on("session.step.ended" / "session.text.started" / "session.usage.updated")` | ⚠️ 语义不同，需重映射 |
| 消息列表 | `state.session.messages(id)` 同步 | `data.session.message.list(id)`（缓存 store，需 `sync()`） | ✅ |
| Part 读取 | `state.part(messageID)` | 内联于 `message.content[]`，**无独立 part 接口** | ✅ |
| 配置读取 | `state.config`（取 agent prompt 估算 system 桶） | 无等价物；需 `data.location.agent.list()` 重建 | ⚠️ 部分 |
| KV 持久化 | `kv.get/set` 同步 | `storage.store/memory`：Solid `Store` + **异步** `mutate` | ⚠️ 有语义损失 |
| Slot 注册 | `slots.register({ order, slots: { sidebar_content: (ctx,{session_id})=>JSX } })` | `ui.slot({ append:"sidebar.content", render:({sessionID})=>JSX })` | ⚠️ **签名完全不同** |
| 命令注册 | `command.register(cb)` + `ui.DialogSelect` 组件 | `keymap.layer(()=>({commands:[...]}))` + `ui.dialog.select()` | ⚠️ 需组件持有者上下文 |
| 主题 | `theme.current.primary / textMuted`（`RGBA`） | `theme`（`@opencode-ai/theme/tui` 的 `ResolvedTheme`，token 结构不同） | ❌ 有损 |
| 对话框 | `ui.Dialog*` Solid 组件族 | `ui.dialog.alert/confirm/prompt/select/show` Promise 式 | ❌ 需重写 |
| Toast | `ui.toast(input)` | `ui.toast.show({ message, variant, duration })` | ✅ |
| **历史统计** | **`opencode db <SQL> --format json`** | **子命令已移除**；替代为 `opencode stats` / `client.session.stats()` | ❌ **必须重写** |

### 2.3 v2 数据结构的三个具体差异

```ts
// v2 TokenUsageInfo —— 注意：没有 total 字段！
type TokenUsageInfo = { input; output; reasoning; cache: { read; write } }

// v2 assistant 消息：tokens/cost 直接挂在消息上，model 是 ModelRef
type SessionMessageAssistant = {
  id; time:{created; streamed?; completed?}; type:"assistant";
  agent: string; model: { id; providerID; variant? };
  content: Array<Text|Reasoning|Tool>;
  cost?: MoneyUSD; tokens?: TokenUsageInfo; finish?: ...; error?;
}
```

**好消息**：v2 提供了比 v1 更精确的事件，无需轮询差分：

```ts
session.step.started  → { sessionID, assistantMessageID, agent, model }        // 请求开始
session.step.ended    → { sessionID, assistantMessageID, finish, cost, tokens } // 请求结束 ★
session.text.started  → { sessionID, assistantMessageID, ordinal }              // TTFT 起点 ★
session.usage.updated → { sessionID, cost, tokens }                             // 会话级增量
```

`session.step.ended` 一次性给出 `cost + tokens + finish(含 error)`，等价于 v1 里 `message.updated` 的 token 语义，且带明确的错误状态（可替代现有"tokens.total === 0 判失败"的启发式）。

### 2.4 三条硬约束

#### 硬约束 A：`opencode db` 在 v2 中不存在

v2 CLI 顶层命令全集（实测枚举）：

```
acp add agents api auth config console debug export get import list login logout
mcp mini models pair paths plugin remove restart run serve service set start
stats status stop unset
```

**没有 `db`。** 这意味着 `src/queries.ts` 中 7 条基于 `message` / `session` 表的 SQL（summary / model / provider / daily / session / distinct / error-stats）全部失效，连带 `commands.tsx` 的 `/usage` 子菜单与 `generate-usage-html.ts` 的 HTML 报告失去数据源。

替代物 `SessionStatsInfo`：

```ts
{ range:{from,to}, sessions, subagents, prompts, steps,
  tokens: TokenUsageInfo, cost, tools, activeDays, streak,
  activity: SessionStatsActivity[], models: SessionStatsModelUsage[] }
```

**能力对比：现有报告能出"按日×按模型""按会话 TopN""按模型错误率"，v2 stats API 只有聚合总量 + models + activity 两级维度。** 功能对等度约 60%，`/usage` 报告必须降级或改由"遍历 `client.session.list()` → 逐会话 `session.message.list()`"在客户端重新聚合（可行，但数据量大时慢，且受服务端分页限制）。

#### 硬约束 B：两代 `@opentui` 版本区间不重叠，且由宿主强制供给

```
@opencode-ai/plugin@1.18.25       peerDependencies: @opentui/core >=0.4.5
@opencode-ai/plugin@0.0.0-beta-*  peerDependencies: @opentui/core >=0.5.9
```

更关键的是**供给方式**（本机实测）：

- `~/.cache/opencode/node_modules/` 中 **无 `@opentui`**（插件自己的 node_modules 里也没有）
- `node_modules/opencode-ai/node_modules/` 中 **也无 `@opentui`**
- 但 `opencode.exe`（171MB，Bun 单文件）内含 `Symbol.for("@opentui/core/singleton")` 与 `opentui.dll/libopentui.so` 原生加载逻辑

→ **`@opentui/*` 由宿主二进制注入，插件无权选择版本。** 插件构建时虽把 `@opentui/*` 设为 external，但它拿到的是宿主那一套。

`esbuild-plugin-solid` 预编译出的 JSX 是对 `@opentui/solid` 工厂函数的直接调用。0.4.x 与 0.5.9+ 之间 OpenTUI 经历了渲染器重构（新增 `@opentui/keymap`、`ResolvedTheme` 主题模型），**同一份预编译 JSX 不能假设两端都可用**。

> 这是"单包单产物"路线的致命障碍，但**可以用双包体 + 动态 import 绕过**（见 3.2）：宿主只会执行它自己那一代的代码路径。

#### 硬约束 C：配置与发现机制分裂

| | v1 | v2 |
|---|---|---|
| 配置文件 | `opencode.json` → `plugin: [...]` | `cli.json` → `plugins: [{ package, options }]` |
| 入口解析 | `package.json` exports `./tui`（带 `config.enabled`） | 同样读 `exports["./tui"]`，但 manifest 语义为 `PluginFeatures { server?, tui?, rpc? }` |

用户需要在两套配置里各写一次；无法自动继承。

---

## 3. 建议路径

### 3.1 方案对比

| 方案 | 描述 | 优点 | 缺点 | 评价 |
|---|---|---|---|---|
| **A. v1 API 模拟层**（当前未提交改动的思路） | 在 v2 ctx 上伪造 v1 `api`，复用全部现有代码 | 改动最小，短期见效 | 受硬约束 B 限制无法用双包体；丢掉 `session.step.ended` 精度；v2 每次改 API 都要补 shim；`opencode db` 问题仍未解决 | ❌ 不推荐 |
| **B. 共享内核 + 双宿主适配 + 双包体**（推荐） | 抽出版本无关代码为 `core/`，两个薄适配层 `host/v1`、`host/v2`，按宿主函数入口动态分发 | 两代各自用原生 API，能力不打折；可规避硬约束 B；长期可维护 | 需要一次性重构（工作量中等）；`/usage` 历史层要写两套 | ✅ **推荐** |
| **C. 拆成两个 npm 包** | `opencode-tokenwatch` + `opencode-tokenwatch-v2` | 隔离最彻底，各自独立发版 | 报告/格式化/i18n 等大量代码要复制两份，长期漂移；用户要装两个包 | ⚠️ 次选 |
| **D. 只维护 v1，等 v2 稳定** | 冻结当前状态 | 零成本 | v2 目前处于 beta，插件接口仍在变；但用户流失风险真实存在 | ⚠️ 保守选项 |

### 3.2 推荐方案 B 的具体架构

**核心洞察：宿主自己会告诉我们它是哪一代**——它调用 `tui(api)` 就是 v1，调用 `setup(ctx)` 就是 v2。因此**不需要任何版本嗅探启发式**。

```
src/
├── core/                    # 版本无关，纯逻辑，不 import @opentui
│   ├── types.ts             # TokenMessage / ModelAgg / PerfStats ...
│   ├── aggregate.ts         # modelStats / sessionTotals / hitRate / trend / distribution
│   ├── perf-tracker.ts      # TTFT/TPS/分位数（输入是归一化事件，输出不变）
│   ├── stats-store.ts       # ~/.opencode/tokenwatch-stats.json（两代共用！）
│   ├── formatter.ts
│   ├── i18n.ts
│   └── generate-usage-html.ts
├── host/
│   ├── v1/
│   │   ├── tui.tsx          # export default { id, tui }
│   │   ├── panel.tsx        # TokenWatchPanel（v1 JSX）
│   │   ├── commands.tsx     # command.register + ui.DialogSelect
│   │   └── queries.ts       # opencode db SQL
│   └── v2/
│       ├── tui.tsx          # export default Plugin.define({ id, setup })
│       ├── panel.tsx        # TokenWatchPanel（v2 JSX，槽位/主题 token 不同）
│       ├── commands.ts      # keymap.layer + ui.dialog.select
│       └── stats.ts         # client.session.stats() / 逐会话遍历聚合
└── entry.tui.mjs            # 分发入口（见下）
```

**分发入口（关键，且已验证两代加载器都接受）：**

```js
// dist/tui.js —— 极小，且刻意不 import 任何 @opentui
export default {
  id: "opencode-tokenwatch",
  // v1 宿主会调用这个
  tui:   async (api) => { const m = await import("./v1/tui.js"); return m.default.tui(api) },
  // v2 宿主会调用这个
  setup: async (ctx) => { const m = await import("./v2/tui.js"); return m.default.setup(ctx) },
}
```

- 两代加载器都只检查自己关心的字段，多余字段忽略 → 校验通过（见 2.1）
- `await import()` 是**惰性**的 → 只有对应代际的包体会执行，其 `@opentui/solid` 静态导入只会解析到当前宿主的实例 → **硬约束 B 被绕过**
- 由于入口是 `tui()` / `setup()` 二选一被调，**零启发式、零误判**

**v2 侧数据管道（比模拟层方案干净得多）：**

```
ctx.data.on("session.step.started", e => 记录 { messageID, model, t0 })
ctx.data.on("session.text.started", e => 记录 TTFT 起点)   // 首个 text part
ctx.data.on("session.step.ended",   e => {
     tokens, cost, finish   → 归一化 → core/perf-tracker + core/stats-store
     finish === "error"     → 计入 errorStats（替代 v1 的 tokens.total===0 启发式）
})
ctx.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <Panel .../> })
```

**`stats-store.json` 是两代共用的持久化格式**，天然跨版本连续——这是本项目相比一般插件的独特优势，务必保留。

### 3.3 落地里程碑（相对工作量，非工期）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| M0 | 未提交改动归档到分支；删除临时脚本；恢复 `@opentui` 版本决策依据 | — |
| M1 | `core/` 抽取：`aggregate` / `formatter` / `perf-tracker` / `stats-store` / `i18n` 去 `@opentui` 依赖 | 无 |
| M2 | 分发入口 + 双 esbuild 产物 + `v1/` 适配层回归 | M1 |
| M3 | `v2/` 面板与命令（原生 slot / keymap / dialog） | M2 |
| M4 | `v2/` 历史统计层（`session.stats` + 逐会话遍历），`/usage` 报告降级方案 | M3 |
| M5 | 文档：两套配置写法、能力差异表 | M4 |

建议 M1→M2 先落地并发布，此时 v1 行为完全不变、风险为零。

---

## 4. 对当前未提交改动的处理建议

### 4.1 逐项评估

| 文件 | 评价 | 建议 |
|---|---|---|
| `src/v2-adapter.tsx`（新增 483 行） | 思路（双格式导出）正确，但实现有**签名级致命 bug**，见 4.2 | **不合入 main**。归档到分支 `archive/v2-adapter-attempt` 作参考 |
| `src/tui.tsx` | 双格式导出 + `await registerCommands` 方向正确；`Array.isArray` 防御可接受（确实跨越宿主边界） | 保留"双导出"思路，但按 3.2 重写为动态分发；轮询/差分逻辑删除 |
| `src/sidebar.tsx`（+223/-103） | **大部分是无效防御**：`modelStats` / `sessionTotals` / `modelTrend` 是纯本地计算，包 try/catch 不可能捕获真实错误，只会掩盖 bug、降低可读性 | **撤销绝大部分**。仅在真正跨越宿主边界处保留 `Array.isArray`（`api.state.part`、`api.state.session.messages`） |
| `src/server.ts` | 加 `setup: async () => {}` 使 `./server` 入口也能过 v2 校验，无害 | 保留（在方案 B 里同样需要） |
| `package.json` | `@opentui/*` 从 `^0.2.9` 提到 `^0.5.1`，**既未满足 v2 的 `>=0.5.9`，也未做 v1 回归验证** | **先撤销**。方案 B 下 `@opentui` 只是 devDependency（编译期），运行时由宿主提供，版本选择应在实测两代宿主后决定 |
| `scripts/_scan-binary.mjs` | 临时扫描脚本，自述"用完即删" | **删除** |

### 4.2 `v2-adapter.tsx` 的具体缺陷（均为对照 v2 源码/类型确证，非推测）

1. **致命**：`ctx.ui.slot("app", () => {...})` 签名错误。
   v2 实际签名是单个对象参数（`packages/tui/src/plugin/api.tsx:208` `slot(value: SlotClaim)`）：
   ```ts
   ctx.ui.slot({ append: "app", render: (input) => JSX })
   ```
   当前写法传入字符串 + 函数，`value.render` 为 `undefined` → 槽位注册必然失败。

2. **致命**：`SLOT_NAME_MAP` 映射的 `sidebar_title` / `app_bottom` 在 v2 中不存在。v2 只有 7 个槽位：`app`、`home.footer`、`prompt.footer`、`prompt.footer.status`、`prompt.footer.file`、`session.composer.top`、`sidebar.content`、`sidebar.footer`。且映射时未带 placement 键。

3. `toV2Command()` 里的 `namespace: "palette"` 是臆造字段——v2 `KeymapCommand` 没有 `namespace`，只有 `palette: true`。

4. `ctx.storage.store(...)` 返回 `[SolidStore, asyncMutate]`；`kv.set` 里调用 `kvMutate(...)` 但**忽略返回的 Promise**，写入可能丢失且无错误处理。

5. `createV1ApiFromV2Ctx` 与 `CommandLayerRegistrar` 用 `appendFileSync` 向 `~/.opencode/tokenwatch-diag.log` 写日志，且在事件热路径上——**绝不能进入发布包**。

6. 数据获取采用"监听全量 `session.*` → 120ms 防抖 → 全量 `message.list()` 差分"，既丢失 per-step 粒度（一个 assistant 消息可能含多步），又引入轮询开销。v2 原生 `session.step.ended` 直接给出 `tokens + cost + finish`，明显更优。

7. `theme` 取值路径 `ctx.theme?.hue?.accent?.[500]` 为臆测；v2 的 `theme` 是 `@opencode-ai/theme/tui` 的 `ResolvedTheme`，实际 token 路径需按该包核对。且 `mode()` 硬编码 `"dark"`。

8. `assistantToV1` 中 `total` 自行求和是正确的（v2 `TokenUsageInfo` 确实无 `total`）——这一点判断准确，可保留。

### 4.3 建议的 git 操作

```bash
# 1) 先给 main 打点，确保可回退
git tag pre-v2-research

# 2) 把当前未提交改动整体归档到分支（保留参考，不污染 main）
git switch -c archive/v2-adapter-attempt
git add -A && git commit -m "archive: wip v2 compat attempt (adapter shim, not for merge)"
git switch main

# 3) main 上把可保留的部分单独重做
git checkout -- src/sidebar.tsx            # 撤销无效防御
git checkout -- package.json               # 撤销未验证的 opentui 升级
git rm --cached src/v2-adapter.tsx 2>/dev/null; rm -f src/v2-adapter.tsx scripts/_scan-binary.mjs

# 4) 从干净基线开新分支实施方案 B
git switch -c feat/v2-dual-host
```

> 说明：以上改动**未执行**，等你确认后再动。特别地，撤销 `sidebar.tsx` 会丢失那 223 行工作，但如 4.1 所述它们大部分是纯本地计算上的无效 try/catch；若其中有你想保留的细节，我可以先做一次精细 diff 再决定。

---

## 5. 风险提示

| 风险 | 等级 | 说明与缓解 |
|---|---|---|
| **v2 仍处于 beta，接口会变** | 🔴 高 | `@opencode-ai/cli` 的 `beta`/`dev` tag 每天都在滚动（18743 / 18803）。官方文档明示 beta 可能清数据、插件接口随时变。缓解：v2 适配层用 `beta` 固定版本，CI 加一次"对 latest beta 的类型检查"作为预警而非阻断 |
| **`@opentui` 跨代不兼容** | 🔴 高 | 已通过双包体 + 惰性动态 import 规避；但需在 v1.18.25 与 opencode2 上各做一次真实冒烟（当前环境未安装 opencode2，无法本地验证） |
| **`/usage` 历史报告功能降级** | 🟠 中 | v2 无 `opencode db`；`session.stats` 维度不足。缓解：接受聚合视图降级，或客户端遍历会话重算（需评估性能与分页） |
| **两套配置需用户手动各配一次** | 🟡 低 | 文档写清楚；README 增加"v1 配置 / v2 配置"两节 |
| **`stats-store.json` 格式跨代兼容** | 🟡 低 | 两代共用同一文件格式是优势；若未来字段扩展，需保证向后兼容读取 |
| **单包体积变大** | 🟡 低 | 双包体约为现有 2 倍（当前 tui.js 147KB → 约 300KB），对 TUI 插件可接受 |
| **`@opencode-ai/plugin` 无法同时依赖两代类型** | 🟠 中 | 同一个包名不能装两个大版本。需 npm alias： `"@opencode-ai/plugin-v2": "npm:@opencode-ai/plugin@0.0.0-beta-18743"`，并在 `tsconfig` 配 paths；或 v2 侧用 `any` + 手写最小类型（更轻，推荐） |

---

## 6. 待你决策的问题

1. **是否接受按方案 B 重构**（共享内核 + 双宿主适配 + 双包体）？这是唯一能同时满足"能力不打折"与"跨代可用"的路径。
2. **`/usage` 历史报告在 v2 上如何取舍**：(a) 降级为 `session.stats` 聚合视图；(b) 客户端遍历会话重算以对齐现有维度（更慢但对齐）；(c) v2 上暂时禁用该子菜单。
3. **未提交改动的处置**：按 4.3 归档到 `archive/v2-adapter-attempt` 还是直接丢弃？
4. **是否要在本机安装 opencode2 beta**（`npm i -g @opencode-ai/cli@next`，二进制 `opencode2`，与 v1 共存互不干扰）以便做真实冒烟——这会把方案 B 的验证从"类型层面正确"提升到"实测可用"。

---

## 8. 落地实测与部署约定（2026-09-02 更新）

方案 B 已实施并通过双宿主实测，本节记录实证结论与部署约定。

### 8.1 实测结果

| 验证项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| esbuild 构建（dist/tui.js + dist/server.js） | 通过 |
| mock 宿主全路径执行（scripts/smoke-dual-host.mjs） | v1 `tui()` 与 v2 `setup()` 均完整装配 ✓ |
| opencode 1.18.26 实机启动（含插件目录） | TUI 正常渲染，无插件报错 ✓ |
| opencode2 0.0.0-beta-18743 实机启动 | TUI 正常渲染，无 fail-toast、无 Duplicate ID ✓ |
| v2 bundle 导入探针（`IMPORT_OK keys=id,tui,setup`） | ✓ 两代外部依赖（solid-js/@opentui）由宿主运行时注入 |

### 8.2 分发架构（最终形态）

单一包体、三个入口，宿主各取所需：

- `dist/tui.js` 的 default export = `{ id, tui, setup }`。v1 加载器读 `.tui`，v2 读 `.setup`——**宿主调用哪个入口本身就是 100% 可靠的代际信号**。
- `dist/server.js`（包主入口）= `{ id, server, setup }`，`setup` 经动态 `import()` 惰性加载 TUI 装配代码，server 进程不会在加载期解析 @opentui 依赖。
- 根级 `tui.ts` / `index.ts`（随 npm `files` 发布）：当宿主以**目录形式**解析插件时使用。v2 目录发现要求目录内同时存在 `index.*`（标记）与 `tui.*`（入口）；v1 亦以 `tui.*` 为 TUI 入口、`index.*` 为 server 入口。

### 8.3 实测发现的两条硬约束（此前源码调研未覆盖）

1. **v2 注册表 ID 唯一**：`.opencode/plugins/<name>/` 目录中，若 `index.*` 的 default export 含 `setup`（合法 v2 插件），server 侧会与 `tui.*` 以相同 id 注册，触发 `Duplicate plugin ID` ERROR 并中断插件重载。因此目录安装的 `index.*` 必须是**仅含 `{ id, server }` 的 v1 server 桩**（v2 侧会有一条无害 WARN 后跳过）。
2. **v2 目录标记的扩展名白名单**：`index` 标记仅认可 `.ts/.tsx/.js/.jsx/.mts/.mjs/.cts/.cjs`，`index.json` 无效。

### 8.4 安装方式对照

| 方式 | v1 | v2 |
|---|---|---|
| 全局配置 `plugin: ["D:/path/to/opencode-tokenwatch"]`（目录） | 以 `tui.ts`/`index.ts` 为入口加载 ✓ | 同左（tui.ts → setup）✓ |
| npm 安装 `opencode-tokenwatch` | `exports["./tui"]` → dist/tui.js ✓ | 主入口 dist/server.js（setup）或目录约定 ✓ |
| `.opencode/plugins/opencode-tokenwatch/`（拷贝 tui.js + index.js） | ✓ | ✓（index.js 须为 v1 server 桩） |
