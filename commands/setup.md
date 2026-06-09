---
description: Register the minimal-claude-hud statusline in your Claude Code settings.json
---

Install the **minimal-claude-hud** statusline for the current user. Follow these steps:

1. **Check Node.js.** Run `node --version`. If it is missing, tell the user to install Node.js 18+ and stop here.

2. **Run the bundled installer.** It self-locates the statusline script, copies it into the Claude config dir (a stable path that survives plugin updates), and merges a `statusLine` entry into `settings.json` while preserving every other key.

   Prefer the plugin-root environment variable:

   ```bash
   node "$CLAUDE_PLUGIN_ROOT/install.mjs"
   ```

   If `$CLAUDE_PLUGIN_ROOT` is empty or unset, find the installed plugin's `install.mjs` under the Claude plugins cache (`~/.claude/plugins/`), choose the most recently modified match, and run that path instead. On Windows use the equivalent (`$env:CLAUDE_PLUGIN_ROOT`, and `$env:USERPROFILE\.claude\plugins`).

3. **Report and restart.** Show the installer's output to the user, then tell them to **restart Claude Code (`/clear` or a new session)** so the new `statusLine` config loads.

Do not hand-edit `settings.json` — the installer performs the JSON merge safely. Re-running this command after updating the plugin refreshes the copied script.
