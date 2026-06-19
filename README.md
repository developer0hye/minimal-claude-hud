# minimal-claude-hud

Shows the **current folder**, **git branch**, **model name**, **context window usage**, **5-hour usage**, and **weekly usage** in the Claude Code global statusline.

```
myproject git:feat/my-branch Opus ctx:42% 5h:13%(1h15m) wk:3%(5d22h)
```

- `myproject` — the current working folder (the last path segment of the directory Claude is running in)
- `git:branch` — the current git branch (hidden when not in a git repo; short SHA when in detached HEAD)
- `Opus` — the model currently in use
- `ctx:NN%` — context window usage of the current conversation
- `5h:NN%` / `wk:NN%` — 5-hour / weekly rate-limit usage from the OAuth usage API
- ≥70%: yellow / ≥90%: red
- Folder, model, and context are read live from Claude Code's stdin JSON; 5h/wk are cached on a 1-minute cycle
- Git branch is read directly from the `.git/HEAD` file (no `git` process is spawned, so it adds no load at statusline-refresh frequency; worktrees/submodules are supported)
- Supports both macOS Keychain credentials and file-based credentials
- Zero external dependencies — a single `.mjs` file

Distilled from [yeachan-heo/oh-my-claudecode](https://github.com/yeachan-heo/oh-my-claudecode) (MIT): only the 5h/weekly display logic from `src/hud/usage-api.ts` + `src/hud/elements/limits.ts` was extracted. The folder, model name, context usage, and git branch come from the stdin JSON Claude Code passes to the statusline script (and, for the branch, from `.git/HEAD`).

---

## Install as a plugin (recommended)

In a Claude Code session:

```
/plugin marketplace add developer0hye/minimal-claude-hud
/plugin install minimal-claude-hud
/reload-plugins
/minimal-claude-hud:setup
```

Then **restart Claude Code** (`/clear` or a new session). From the next session on, the statusline appears in every project.

What each step does:

1. `marketplace add` registers this repo as a plugin marketplace (it ships a `.claude-plugin/marketplace.json`).
2. `install` downloads the plugin (the bundled statusline script + the setup command).
3. `/minimal-claude-hud:setup` runs the bundled `install.mjs`, which copies the statusline script into your Claude config dir and merges a `statusLine` entry into `settings.json` (your other settings are preserved). A plugin cannot set the main `statusLine` on its own, so this one-time setup step is required.

To update later: `/plugin marketplace update minimal-claude-hud`, `/plugin install minimal-claude-hud`, then re-run `/minimal-claude-hud:setup` to refresh the copied script.

---

## Manual install (no plugin)

Prefer the plugin route above. If you want to wire it up by hand — or let Claude do it from a clone — follow these steps.

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

(The example `cwd` is not a git repo, so no folder/branch segment shows in this isolated test; both appear once Claude Code runs it inside a real project.)

If the output is empty:
- Credentials could not be read → log into Claude Code once, then retry.
- The API returned 429 → it retries automatically after 1 minute, showing the cached stale value in the meantime.

### 3. Register `statusLine` in `~/.claude/settings.json` (merge)

**Do not overwrite** your existing settings.json — preserve the existing keys and only add/replace the `statusLine` entry. A safe merge with Node (this is exactly what the plugin's `install.mjs` does):

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
- Success looks like `myproject Opus ctx:NN% 5h:NN% wk:NN%` on the statusline row.
- The first run may be slightly delayed by the Anthropic API call; it is cached for 1 minute afterward.

---

## Update

If you installed via the plugin, re-run the plugin update steps above. For a manual install, just re-download the script — no need to touch settings.json:

```bash
curl -fsSL https://raw.githubusercontent.com/developer0hye/minimal-claude-hud/main/omc-limits-statusline.mjs \
  -o "$HOME/.claude/omc-limits-statusline.mjs"
```

## Uninstall

Delete the `statusLine` key from `~/.claude/settings.json` and remove the `~/.claude/omc-limits-statusline.mjs` file. If you installed the plugin, also run `/plugin uninstall minimal-claude-hud`.

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
6. Reads `workspace.current_dir` (falling back to `cwd`), `model.display_name`, and `context_window.used_percentage` from the JSON Claude Code passes on stdin. The folder is reduced to its last path segment (basename; both POSIX `/` and Windows `\` separators are handled). The trailing context-window label on the model name (e.g. `(1M context)` in `Opus 4.8 (1M context)`) is stripped before display.
7. For the git branch, walks up from the cwd to find `.git` and reads its `HEAD` file directly — `ref: refs/heads/<branch>` yields the branch name, otherwise (detached HEAD) a 7-char short SHA. A `.git` *file* (`gitdir: <path>` — worktree/submodule) is followed too. No `git` process is spawned, so it adds no cost at statusline-refresh frequency. The segment is omitted entirely outside a git repo.
8. Applies ANSI colors and prints to stdout as `folder git:branch Model ctx:NN% 5h:NN%(Hh Mm) wk:NN%(Dd Hh)` (the folder is uncolored; the branch is magenta).

## License / Credits

The original code is MIT-licensed — yeachan-heo/oh-my-claudecode (`src/hud/usage-api.ts`, `src/hud/elements/limits.ts`). This minimal extract follows the same MIT license. See [LICENSE](LICENSE).
