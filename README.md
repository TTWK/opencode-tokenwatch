# opencode-tokenwatch

Token usage statistics for opencode.

Query opencode's SQLite database to display per-model and per-day token usage,
cost, and cache metrics directly in your opencode session via the `/usage` command.

## Features

- **`/usage` command** — Current session, per-model breakdown, daily breakdown
- **Direct SQLite queries** — Uses `opencode db` for fast aggregation
- **Rich breakdown** — total / input / output / reasoning / cache tokens
- **Server plugin** — Lightweight event hook for token tracking

## Installation

### 1. Install the npm package

```sh
cd ~/.config/opencode
npm install opencode-tokenwatch
```

### 2. Deploy the helper script

```powershell
# Create the temp directory
New-Item -ItemType Directory -Path "$env:TEMP\opencode" -Force

# Copy the script from the package
Copy-Item node_modules/opencode-tokenwatch/scripts/opencode-usage.ps1 "$env:TEMP\opencode\"
```

### 3. Add the custom command

Create `~/.config/opencode/commands/usage.md`:

```markdown
---
description: Show token usage statistics for opencode sessions
---

!`powershell -File "$env:TEMP\opencode\opencode-usage.ps1" -Mode current`

!`powershell -File "$env:TEMP\opencode\opencode-usage.ps1" -Mode model`

!`powershell -File "$env:TEMP\opencode\opencode-usage.ps1" -Mode daily`
```

## Usage

In any opencode session, type `/usage`. Output example:

```
═══ Current Session ═══
  Model:    deepseek-v4-flash-free
  Requests: 150
  Tokens:   13.8M  (in:96.5K  out:34.5K  reasoning:40.6K  cache:13.6M)
  Cost:     $0.00

═══ Model Breakdown ═══
  mimo-v2-pro-free                523 req   12 ses  tot:  48.1M  in:   1.9M  out: 185.9K  cache:  46.0M  $0.00
  deepseek-v4-flash-free          245 req    4 ses  tot:  20.3M  in: 262.7K  out:  77.5K  cache:  19.9M  $0.00
  ...
  ─── TOTAL ───                  1152 req   48 ses  tot:  86.0M  in:  15.0M  out: 476.5K  cache:  70.4M  $2.03

═══ Daily Breakdown ═══
  2026-05-13    245 req  tot:  20.3M  in: 262.7K  out:  77.5K  cache:  19.9M  $0.00
  ...
  ─── TOTAL ───  536 req  tot:  34.2M  in:   8.0M  out: 211.8K  cache:  26.0M  $2.03
```

## Project Structure

```
opencode-tokenwatch/
├── package.json           # npm package, server plugin entry
├── tsconfig.json
├── src/
│   ├── index.ts           # Server plugin (event hook)
│   ├── queries.ts         # SQL aggregation queries
│   └── formatter.ts       # Token/cost formatters + types
├── scripts/
│   └── opencode-usage.ps1 # PowerShell script for /usage
├── docs/superpowers/      # Design spec and plan
├── LICENSE
└── README.md
```

## Requirements

- opencode v1.14+
- Node.js 18+
- Windows (PowerShell for the helper script; adapt for Linux/macOS)

## License

MIT
