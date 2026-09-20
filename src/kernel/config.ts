/**
 * 侧边栏配置 —— 宿主无关的持久化设置。
 *
 * 读写只依赖 `KeyValueStore`（v1 的 kv / v2 的 storage.store 在各自 adapter 中折叠），
 * 因此设置项在两代宿主间行为完全一致。
 */
import type { KeyValueStore } from "../host/types.js"

export interface SidebarConfig {
  sidebar: {
    showPerformance: boolean
    showPricing: boolean
    showTokenDistribution: boolean
    showTrend: boolean
  }
  language: "zh" | "en" | "auto"
}

export type SidebarToggleKey = keyof SidebarConfig["sidebar"]

export const DEFAULT_CONFIG: SidebarConfig = {
  sidebar: { showPerformance: true, showPricing: true, showTokenDistribution: true, showTrend: true },
  language: "auto",
}

const KEY_CONFIG = "tokenwatch-config"
const KEY_VERSION = "tokenwatch-config-version"

function cloneDefaults(): SidebarConfig {
  return { sidebar: { ...DEFAULT_CONFIG.sidebar }, language: DEFAULT_CONFIG.language }
}

/**
 * 读取配置：默认值 ← 插件配置（opencode.json）← 运行时覆盖（设置菜单）。
 * `pluginConfig` 为宿主声明式配置，v1 读 `state.config`，v2 暂无等价物。
 */
export function loadConfig(store: KeyValueStore, pluginConfig?: Record<string, any>): SidebarConfig {
  const base = cloneDefaults()
  try {
    const pluginCfg = pluginConfig?.["opencode-tokenwatch"]
    if (pluginCfg?.sidebar) Object.assign(base.sidebar, pluginCfg.sidebar)
    if (pluginCfg?.language) base.language = pluginCfg.language
    const overrides = store.get<Partial<SidebarConfig> | undefined>(KEY_CONFIG, undefined)
    if (overrides?.sidebar) Object.assign(base.sidebar, overrides.sidebar)
    if (overrides?.language) base.language = overrides.language
  } catch { /* defaults */ }
  return base
}

export function saveConfig(store: KeyValueStore, cfg: SidebarConfig): void {
  store.set(KEY_CONFIG, cfg)
  bumpVersion(store)
}

/**
 * 递增配置版本号。
 *
 * 侧边栏用轮询版本号的方式感知"设置在别处被改了"，
 * 因为 v1 的 kv 不是响应式的。
 */
export function bumpVersion(store: KeyValueStore): void {
  const v = (store.get<number>(KEY_VERSION, 0) ?? 0) + 1
  store.set(KEY_VERSION, v)
}

export function toggleSidebarSetting(store: KeyValueStore, key: SidebarToggleKey): SidebarConfig {
  const current = loadConfig(store)
  current.sidebar[key] = !current.sidebar[key]
  saveConfig(store, current)
  return current
}

export function setLanguageSetting(store: KeyValueStore, language: SidebarConfig["language"]): SidebarConfig {
  const current = loadConfig(store)
  current.language = language
  saveConfig(store, current)
  return current
}
