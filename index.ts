/**
 * 目录标记 + 服务端插件入口。
 *
 * opencode2 有两套本地插件发现：
 * - 服务端（role=server）以 `index.*` 为入口，要求 default 导出为合法插件模块
 * - TUI 侧以 `tui.*` 为入口（见 ./tui.ts）
 *
 * 本文件同时满足两者：作为 v2 目录发现的标记文件，并导出 v1/v2 通用的
 * server 插件对象（v1 不使用本文件，它通过 package.json 的 exports 加载）。
 */
export { default } from "./dist/server.js"
