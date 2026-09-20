/**
 * 性能聚合核心 —— perf 追踪器（内存）、持久化统计（store）、报告聚合（report）
 * 三处共用的 Welford 增量聚合 + Reservoir 分位数采样。
 *
 * 口径约定（与宿主官方对齐，详见 AGENTS.md）：
 * - tokenTotal 五分量：input + output + reasoning + cache.read + cache.write
 * - TPS：可见输出 tokens / (流式终点 − 流式窗口起点)，单位 tok/s
 * - TTFT：首个"首 token"锚点（可见输出 part / delta）− 请求起点
 * - latency：端到端 completed − created（含收尾 settlement）
 */
import type { LogEntry, ModelPerfStats } from "./format.js"

/** 线性插值百分位数，输入须为升序数组 */
export function computePercentile(sortedArr: number[], p: number): number | null {
  if (sortedArr.length === 0) return null
  if (sortedArr.length === 1) return sortedArr[0]
  const idx = (p / 100) * (sortedArr.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedArr[lo]
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo)
}

/** 每 marker 最多保留的原始样本数（Reservoir Sampling，内存有界） */
export const RESERVOIR_SIZE = 500

/**
 * Reservoir Sampling：保证每个观测值以相同概率进入样本（算法 R 变体），
 * 使分位数估算在统计意义上无偏。
 */
export function reservoirAdd(reservoir: number[], value: number, totalCount: number): number[] {
  if (reservoir.length < RESERVOIR_SIZE) {
    return [...reservoir, value]
  }
  const j = Math.floor(Math.random() * totalCount)
  if (j < RESERVOIR_SIZE) {
    const next = [...reservoir]
    next[j] = value
    return next
  }
  return reservoir
}

/** 单模型聚合累加器（内存态；持久化层可直接序列化本结构） */
export interface ModelAccumulator {
  model: string
  providerID: string
  requestCount: number
  ttftCount: number
  tpsCount: number
  latencyCount: number
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  totalCost: number
  avgTTFT: number | null
  maxTTFT: number | null
  minTTFT: number | null
  avgTPS: number | null
  maxTPS: number | null
  minTPS: number | null
  avgLatency: number | null
  maxLatency: number | null
  minLatency: number | null
  /** TTFT / 端到端延迟原始样本（Reservoir，用于分位数） */
  ttftReservoir: number[]
  latencyReservoir: number[]
  /** 最近一次请求值（侧边栏与宿主 footer 单次口径对照） */
  lastTTFT: number | null
  lastTPS: number | null
  lastLatency: number | null
}

export function createAccumulator(model: string, providerID: string): ModelAccumulator {
  return {
    model,
    providerID,
    requestCount: 0,
    ttftCount: 0,
    tpsCount: 0,
    latencyCount: 0,
    totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0, totalCost: 0,
    avgTTFT: null, maxTTFT: null, minTTFT: null,
    avgTPS: null, maxTPS: null, minTPS: null,
    avgLatency: null, maxLatency: null, minLatency: null,
    ttftReservoir: [],
    latencyReservoir: [],
    lastTTFT: null, lastTPS: null, lastLatency: null,
  }
}

/**
 * 把一条日志条目增量并入累加器。
 *
 * 均值用 Welford 在线算法；分母是各自的**有效样本数**
 * （ttftCount/tpsCount/latencyCount），缺失指标的请求不会拉低均值。
 * 全零 token（五分量均为 0）的失败请求被跳过 —— 与宿主官方
 * `tokenTotal(msg) <= 0 continue` 的过滤口径一致（含 reasoning）。
 */
export function accumulateEntry(acc: ModelAccumulator, entry: LogEntry): void {
  if (
    entry.inputTokens + entry.outputTokens + entry.reasoningTokens +
    entry.cacheReadTokens + entry.cacheWriteTokens === 0
  ) return

  acc.requestCount++
  acc.totalInput += entry.inputTokens
  acc.totalOutput += entry.outputTokens
  acc.totalCacheRead += entry.cacheReadTokens
  acc.totalCacheWrite += entry.cacheWriteTokens
  acc.totalCost += entry.cost

  if (entry.ttft_ms != null) {
    acc.ttftCount++
    const c = acc.ttftCount
    acc.avgTTFT = acc.avgTTFT != null ? acc.avgTTFT + (entry.ttft_ms - acc.avgTTFT) / c : entry.ttft_ms
    acc.maxTTFT = acc.maxTTFT != null ? Math.max(acc.maxTTFT, entry.ttft_ms) : entry.ttft_ms
    acc.minTTFT = acc.minTTFT != null ? Math.min(acc.minTTFT, entry.ttft_ms) : entry.ttft_ms
    acc.ttftReservoir = reservoirAdd(acc.ttftReservoir, entry.ttft_ms, acc.ttftCount)
    acc.lastTTFT = entry.ttft_ms
  }

  if (entry.tps != null) {
    acc.tpsCount++
    const c = acc.tpsCount
    acc.avgTPS = acc.avgTPS != null ? acc.avgTPS + (entry.tps - acc.avgTPS) / c : entry.tps
    acc.maxTPS = acc.maxTPS != null ? Math.max(acc.maxTPS, entry.tps) : entry.tps
    acc.minTPS = acc.minTPS != null ? Math.min(acc.minTPS, entry.tps) : entry.tps
    acc.lastTPS = entry.tps
  }

  if (entry.latency_ms != null) {
    acc.latencyCount++
    const c = acc.latencyCount
    acc.avgLatency = acc.avgLatency != null ? acc.avgLatency + (entry.latency_ms - acc.avgLatency) / c : entry.latency_ms
    acc.maxLatency = acc.maxLatency != null ? Math.max(acc.maxLatency, entry.latency_ms) : entry.latency_ms
    acc.minLatency = acc.minLatency != null ? Math.min(acc.minLatency, entry.latency_ms) : entry.latency_ms
    acc.latencyReservoir = reservoirAdd(acc.latencyReservoir, entry.latency_ms, acc.latencyCount)
    acc.lastLatency = entry.latency_ms
  }
}

/** 聚合累加器 → 对外输出的 ModelPerfStats（分位数在此计算） */
export function finalizeAccumulator(acc: ModelAccumulator): ModelPerfStats {
  const ttftArr = [...acc.ttftReservoir].sort((a, b) => a - b)
  const latArr = [...acc.latencyReservoir].sort((a, b) => a - b)
  const denom = acc.totalInput + acc.totalCacheRead
  return {
    model: acc.model,
    providerID: acc.providerID,
    requestCount: acc.requestCount,
    ttftCount: acc.ttftCount,
    tpsCount: acc.tpsCount,
    latencyCount: acc.latencyCount,
    totalInput: acc.totalInput,
    totalOutput: acc.totalOutput,
    totalCacheRead: acc.totalCacheRead,
    totalCacheWrite: acc.totalCacheWrite,
    totalCost: acc.totalCost,
    avgTTFT: acc.avgTTFT,
    maxTTFT: acc.maxTTFT,
    minTTFT: acc.minTTFT,
    p50TTFT: computePercentile(ttftArr, 50),
    p95TTFT: computePercentile(ttftArr, 95),
    p99TTFT: computePercentile(ttftArr, 99),
    avgTPS: acc.avgTPS,
    maxTPS: acc.maxTPS,
    minTPS: acc.minTPS,
    avgLatency: acc.avgLatency,
    maxLatency: acc.maxLatency,
    minLatency: acc.minLatency,
    p50Latency: computePercentile(latArr, 50),
    p95Latency: computePercentile(latArr, 95),
    p99Latency: computePercentile(latArr, 99),
    cacheHitRate: denom > 0 ? (acc.totalCacheRead / denom) * 100 : null,
    // 旧版本持久化文件可能缺少 last* 字段（undefined），统一归一化为 null
    lastTTFT: acc.lastTTFT ?? null,
    lastTPS: acc.lastTPS ?? null,
    lastLatency: acc.lastLatency ?? null,
  }
}
