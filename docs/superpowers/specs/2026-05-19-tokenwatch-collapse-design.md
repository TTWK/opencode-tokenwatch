# [DEPRECATED] TokenWatch 侧边栏折叠功能设计文档

> **This document is deprecated.** Its content has been incorporated and substantially
> expanded in the v2 refactoring design. See `2026-05-20-tokenwatch-v2-design.zh.md`
> (Chinese) or `2026-05-20-tokenwatch-v2-design.en.md` (English) for the current design.

## 1. 概述 (Historical)
在 OpenCode TUI 的侧边栏 TokenWatch 统计区域增加折叠/展开功能，以便用户在不需要查看统计数据时节省空间。

## 2. 需求
- 在 TokenWatch 标题栏增加一个三角标指示器。
- 点击标题栏区域可切换折叠/展开状态。
- 默认状态为展开（每次进入或刷新时）。
- 折叠时仅显示标题行，隐藏详细统计数据。
- 不影响现有的统计逻辑和 `/usage` 命令功能。

## 3. 技术方案
采用 **响应式状态管理** 方案：
- 使用 `solid-js` 的 `createSignal` 在 `sidebar_content` 插槽内部维护 `isCollapsed` 状态。
- 利用 TUI 插件 API 的事件绑定机制处理点击交互。

## 4. 详细设计

### 4.1 UI 变更
- **标题行 (Header Row)**:
  - 类型: `box` (flexDirection: "row")
  - 内容: `[三角标] TokenWatch`
  - 样式: 展开时显示 `▼`，折叠时显示 `▶`
  - 交互: 绑定 `onSelect` 事件到整个标题行。

### 4.2 逻辑变更
- **状态定义**: `const [isCollapsed, setIsCollapsed] = createSignal(false);`
- **条件渲染**:
  ```typescript
  if (!isCollapsed()) {
    // 渲染现有的统计列表、分割线和总计信息
  }
  ```

## 5. 影响范围
- **受影响文件**: `src/tui.ts`
- **不受影响**: `src/formatter.ts`, `src/queries.ts`, `src/index.ts` 以及所有 CLI 相关功能。

## 6. 验证计划
- 启动 TUI，确认 TokenWatch 默认展开。
- 点击标题行，确认内容隐藏且三角标变为 `▶`。
- 再次点击标题行，确认内容重新显示且三角标变为 `▼`。
- 发送消息触发统计更新，确认在折叠/展开状态下数据均能正确更新。
