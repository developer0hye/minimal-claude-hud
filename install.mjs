#!/usr/bin/env node
// install.mjs — register minimal-claude-hud as the Claude Code statusLine.
//
// Self-locating: it copies the sibling `omc-limits-statusline.mjs` into your
// Claude config dir (a stable path that survives plugin version bumps) and
// merges a `statusLine` entry into settings.json without touching other keys.
//
// Run directly from a clone:   node install.mjs
// Or via the plugin command:   /minimal-claude-hud:setup
//
// Re-run after updating the plugin to refresh the copied script.

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'omc-limits-statusline.mjs');
if (!existsSync(src)) {
  console.error(`[minimal-claude-hud] bundled script not found at: ${src}`);
  process.exit(1);
}

// Honor CLAUDE_CONFIG_DIR so non-standard setups land in the right place.
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
mkdirSync(configDir, { recursive: true });

const dst = join(configDir, 'omc-limits-statusline.mjs');
copyFileSync(src, dst);

const settingsPath = join(configDir, 'settings.json');
let settings = {};
if (existsSync(settingsPath)) {
  try {
    // Strip a leading UTF-8 BOM (PowerShell/Notepad can add one) before parsing.
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8').replace(/^﻿/, ''));
  } catch (e) {
    console.error(`[minimal-claude-hud] could not parse ${settingsPath}: ${e.message}`);
    console.error('[minimal-claude-hud] fix or remove the file, then re-run.');
    process.exit(1);
  }
}

const command = `node "${dst.replace(/\\/g, '/')}"`;
settings.statusLine = { type: 'command', command, padding: 0 };
writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

console.log('[minimal-claude-hud] installed');
console.log(`  script:    ${dst}`);
console.log(`  statusLine command registered in ${settingsPath}`);
console.log('  -> Restart Claude Code (/clear or a new session) to see the statusline.');
