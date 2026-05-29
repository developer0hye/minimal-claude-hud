# minimal-claude-hud

Shows the **model name**, **context window usage**, **5-hour usage**, and **weekly usage** in the Claude Code global statusline.

```
Opus ctx:42% 5h:13%(1h15m) wk:3%(5d22h)
```

- `Opus` — the model currently in use
- `ctx:NN%` — context window usage of the current conversation
- `5h:NN%` / `wk:NN%` — 5-hour / weekly rate-limit usage from the OAuth usage API
- ≥70%: yellow / ≥90%: red
- Model name and context are read live from Claude Code's stdin JSON; 5h/wk are cached on a 1-minute cycle
- Supports both macOS Keychain credentials and file-based credentials
- Zero external dependencies — a single `.mjs` file

Distilled from [yeachan-heo/oh-my-claudecode](https://github.com/yeachan-heo/oh-my-claudecode) (MIT): only the 5h/weekly display logic from `src/hud/usage-api.ts` + `src/hud/elements/limits.ts` was extracted. The model name and context usage come from the stdin JSON that Claude Code passes to the statusline script.

---

## Install (let Claude Code do it — recommended)

Send the one line below in a Claude Code session. Claude will follow the "Claude Code install steps" section of this README and install it for you automatically.

> `Read https://github.com/developer0hye/minimal-claude-hud and follow the "Claude Code install steps" section of the README to install it.`

When it finishes, restart Claude Code once (`/clear` or a new session). From the next session on, usage will appear in the statusline of every project.

---

## Claude Code install steps

This section lists the steps Claude Code follows. **A human can follow them directly too**, but letting Claude handle it takes care of OS differences, paths, and JSON merging for you.

### Prerequisites
- Node.js 18+ on your PATH (`node --version`)
- Either `~/.claude/.credentials.json` exists (Windows/Linux), or the macOS Keychain has a `Claude Code-credentials` entry — this is created automatically once you have logged into Claude Code at least once.

### 1. Download the script

Download this repo's `omc-limits-statusline.mjs` and save it to `~/.claude/omc-limits-statusline.mjs`.

```bash
# bash / zsh (macOS, Linux, Git Bash on Windows)
curl -fsSL https://raw.githubusercontent.com/developer0hye/minimal-claude-hud/main/omc-limits-statusline.mjs \
  -o "$HOME/.claude/omc-limits-statusline.mjs"
```

```powershell
# PowerShell (Windows)
$dest = Join-Path $env:USERPROFILE ".claude\omc-limits-statusline.mjs"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/developer0hye/minimal-claude-hud/main/omc-limits-statusline.mjs" -OutFile $dest
```

### 2. Check that the statusline works

Run the script once to confirm it produces output (when the cache is empty, the first call hits the Anthropic API — about 1 second).

```bash
# bash
echo '{"session_id":"test","cwd":".","model":{"display_name":"Opus"},"context_window":{"used_percentage":42}}' | node "$HOME/.claude/omc-limits-statusline.mjs"
```

```powershell
# PowerShell
'{"session_id":"test","cwd":".","model":{"display_name":"Opus"},"context_window":{"used_percentage":42}}' | node (Join-Path $env:USERPROFILE ".claude\omc-limits-statusline.mjs")
```

Expected output (with ANSI escapes):
```
[36mOpus[0m [2mctx:[0m[32m42%[0m 5h:[32m13%[0m[2m(1h15m)[0m [2mwk:[0m[32m3%[0m[2m(5d22h)[0m
```

If the output is empty:
- Credentials could not be read → log into Claude Code once, then retry.
- The API returned 429 → it retries automatically after 1 minute, showing the cached stale value in the meantime.

### 3. Register `statusLine` in `~/.claude/settings.json` (merge)

**Do not overwrite** your existing settings.json — preserve the existing keys and only add/replace the `statusLine` entry. Claude follows this JSON merge rule:

- If `~/.claude/settings.json` does not exist, create it.
- If it exists, parse it as JSON and set only this key:
  ```jsonc
  {
    "statusLine": {
      "type": "command",
      "command": "node \"<HOME>/.claude/omc-limits-statusline.mjs\"",
      "padding": 0
    }
  }
  ```
  Replace `<HOME>` with the absolute path to your home directory for your OS:
  - Windows: `C:/Users/<USERNAME>` (forward slashes), or expand `%USERPROFILE%` directly
  - macOS / Linux: the value of `$HOME` (e.g. `/Users/yourname` or `/home/yourname`)
- Leave all other keys (`enabledPlugins`, `effortLevel`, `autoUpdatesChannel`, `skipDangerousModePermissionPrompt`, hooks, permissions, etc.) **untouched.**

A safe merge with Node (Claude can run this as-is):

```bash
node -e '
const fs = require("fs");
const path = require("path");
const os = require("os");
const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
const scriptPath = path.join(os.homedir(), ".claude", "omc-limits-statusline.mjs").replace(/\\/g, "/");
let s = {};
if (fs.existsSync(settingsPath)) s = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
s.statusLine = { type: "command", command: `node "${scriptPath}"`, padding: 0 };
fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
console.log("statusLine registered:", scriptPath);
'
```

### 4. Wrap up

After installing:
- Restart Claude Code (`/clear` or a new session).
- Success looks like `Opus ctx:NN% 5h:NN% wk:NN%` on the statusline row.
- The first run may be slightly delayed by the Anthropic API call; it is cached for 1 minute afterward.

---

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/developer0hye/minimal-claude-hud/main/omc-limits-statusline.mjs \
  -o "$HOME/.claude/omc-limits-statusline.mjs"
```

Just re-download the script file. No need to touch settings.json.

## Uninstall

Delete the `statusLine` key from `~/.claude/settings.json` and remove the `~/.claude/omc-limits-statusline.mjs` file.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Nothing shows on the statusline | 1) Check `node --version`. 2) Run `node ~/.claude/omc-limits-statusline.mjs` manually and inspect the output. 3) Restart Claude Code. |
| Only `5h:0%` shows | The API likely did not return a response. `OMC_DEBUG` is disabled in this extract. Delete the cache file `~/.claude/cache/omc-limits-cache.json` and retry. |
| Credentials not read on macOS | Check directly with `security find-generic-password -s "Claude Code-credentials" -w`. If empty, log back into Claude Code. |
| Non-default config via `CLAUDE_CONFIG_DIR` | The script picks up the env var automatically. The Keychain service name is computed as `Claude Code-credentials-<sha256(CLAUDE_CONFIG_DIR)[:8]>`. |

## How it works (summary)

1. On macOS, reads the OAuth access/refresh token via `security find-generic-password`; elsewhere from `~/.claude/.credentials.json`.
2. If the access token is expired, refreshes it via `platform.claude.com/v1/oauth/token`.
3. Calls `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`).
4. Parses `five_hour.utilization`, `seven_day.utilization`, and each `resets_at` from the response.
5. Caches in `~/.claude/cache/omc-limits-cache.json` for 1 minute. 429 uses exponential backoff (up to 5 minutes); network errors use a 2-minute TTL.
6. Reads `model.display_name` and `context_window.used_percentage` from the JSON Claude Code passes on stdin.
7. Applies ANSI colors and prints to stdout as `Model ctx:NN% 5h:NN%(Hh Mm) wk:NN%(Dd Hh)`.

## License / Credits

The original code is MIT-licensed — yeachan-heo/oh-my-claudecode (`src/hud/usage-api.ts`, `src/hud/elements/limits.ts`). This minimal extract follows the same MIT license. See [LICENSE](LICENSE).
