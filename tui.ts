/**
 * opencode2（v2）入口。
 *
 * v2 以目录形式解析插件时，会把本文件作为入口模块导入并读取 default 导出，
 * 再调用其 `setup(ctx)`。这里直接复用构建产物，保证 v1 / v2 走同一份实现。
 *
 * v1 不使用本文件——它通过 package.json 的 exports["./tui"] 加载 dist/tui.js。
 */
export { default } from "./dist/tui.js"
