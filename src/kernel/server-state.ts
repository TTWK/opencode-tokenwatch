import { join } from "node:path"
import { homedir } from "node:os"
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from "node:fs"

const OPENCODE_DIR = join(homedir(), ".opencode")
const SERVER_MARKER_PATH = join(OPENCODE_DIR, ".tokenwatch-server.json")

interface ServerMarker {
  pid: number
  startedAt: number
}

/**
 * 标记当前进程为活跃的 Server 遥测收集器（Authoritative Writer）。
 *
 * 返回一个清理函数，在 Server 插件卸载或进程退出时移除标记文件。
 */
export function markServerActive(): () => void {
  try {
    if (!existsSync(OPENCODE_DIR)) {
      mkdirSync(OPENCODE_DIR, { recursive: true })
    }
    const marker: ServerMarker = {
      pid: process.pid,
      startedAt: Date.now(),
    }
    writeFileSync(SERVER_MARKER_PATH, JSON.stringify(marker), "utf-8")
  } catch {
    // 标记写入失败属非关键异常，不中断宿主
  }

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try {
      if (existsSync(SERVER_MARKER_PATH)) {
        const raw = readFileSync(SERVER_MARKER_PATH, "utf-8")
        const parsed: ServerMarker = JSON.parse(raw)
        if (parsed.pid === process.pid) {
          unlinkSync(SERVER_MARKER_PATH)
        }
      }
    } catch {
      // 忽略清理失败
    }
  }

  process.once("exit", cleanup)
  return cleanup
}

/**
 * 检测当前系统是否存在存活的 TokenWatch Server 采集进程。
 *
 * 若存在存活的 Server 进程，TUI 客户端应当作为纯展现层运行，
 * 避免向 tokenwatch.jsonl 重复写入相同事件。
 */
export function isServerActive(): boolean {
  try {
    if (!existsSync(SERVER_MARKER_PATH)) return false
    const raw = readFileSync(SERVER_MARKER_PATH, "utf-8")
    const parsed: ServerMarker = JSON.parse(raw)
    if (!parsed || typeof parsed.pid !== "number") return false

    // process.kill(pid, 0) 是 Node.js 跨平台标准检测进程是否存在的方法（不发送真实信号）
    process.kill(parsed.pid, 0)
    return true
  } catch {
    // 进程不存在或无权访问，标记视为失效
    return false
  }
}
