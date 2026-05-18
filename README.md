# opencode-tokenwatch

Token usage analytics plugin for OpenCode.

It adds a live sidebar panel for the current session and a `/usage` slash command
that reads your local OpenCode history from SQLite, aggregates token usage by
model, provider, date, and session, and supports export to JSON or CSV.

## Features

- Live sidebar updates while the assistant replies
- Current-session aggregation across every model used in the conversation
- `/usage` report for local history with model, provider, date, and session views
- Export full reports to `JSON`
- Export grouped tables to `CSV`
- Uses `opencode db ... --format json` directly, so it works from local records

## Install

Add the package to OpenCode's plugin list.

Install the package first:

```sh
npm install opencode-tokenwatch
```

`opencode.json` or `opencode.jsonc`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-tokenwatch"]
}
```

`tui.json` or `tui.jsonc`

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-tokenwatch"]
}
```

If you are preparing for npm publishing, this package is already configured to
publish public artifacts from `dist/`.

## Usage

In OpenCode TUI:

1. Open the right sidebar to see live token totals for the current session.
2. Run `/usage`.
3. Choose:
   - `View report`
   - `Export JSON`
   - `Export CSV`
4. Pick a time range and optional provider/model filters.

Exports are written to the current working directory:

- `tokenwatch-usage-report.json`
- `tokenwatch-models.csv`
- `tokenwatch-providers.csv`
- `tokenwatch-daily.csv`
- `tokenwatch-sessions.csv`

## Report Dimensions

- Model
- Provider
- Day
- Session
- Current session summary

## Requirements

- OpenCode CLI with `opencode db`
- Node.js 18+

## Build

```sh
npm install
npm run build
```

## Publish Prep

Before publishing to npm, run:

```sh
npm run release:check
```

This builds the package and runs `npm pack --dry-run` with an isolated temp npm
cache, which is especially helpful on Windows when the default cache directory is
locked by another process.

## License

MIT
