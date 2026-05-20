import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const cwd = process.cwd()
const cacheDir = path.join(os.tmpdir(), "opencode-tokenwatch-npm-cache")
const npmExecPath = process.env.npm_execpath

fs.mkdirSync(cacheDir, { recursive: true })

const run = (args) => {
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...args], {
        cwd,
        env: {
          ...process.env,
          npm_config_cache: cacheDir,
        },
        stdio: "inherit",
      })
    : spawnSync("npm", args, {
        cwd,
        env: {
          ...process.env,
          npm_config_cache: cacheDir,
        },
        stdio: "inherit",
        shell: process.platform === "win32",
      })

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run(["run", "build"])
run(["pack", "--dry-run"])
