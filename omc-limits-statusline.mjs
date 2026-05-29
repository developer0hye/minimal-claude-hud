#!/usr/bin/env node
// Minimal Claude Code statusline: shows context window usage, 5-hour and weekly OAuth usage.
//
// Distilled from yeachan-heo/oh-my-claudecode (MIT):
//   src/hud/usage-api.ts   - OAuth credential read + token refresh + API fetch
//   src/hud/elements/limits.ts  - rendering (5h:NN%(Hh Mm) wk:NN%(Dd Hh))
//
// Single-file, no external deps. Reads credentials from macOS Keychain on darwin,
// then falls back to ~/.claude/.credentials.json. Caches results in
// ~/.claude/cache/omc-limits-cache.json. Output is colored by 70/90% thresholds.
// Context window usage is read from Claude Code's stdin JSON (context_window.used_percentage).

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import https from 'node:https';

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const CRED_PATH = join(CONFIG_DIR, '.credentials.json');
const CACHE_DIR = join(CONFIG_DIR, 'cache');
const CACHE_PATH = join(CACHE_DIR, 'omc-limits-cache.json');

const DEFAULT_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const API_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;
const NETWORK_TTL_MS = 2 * 60 * 1000;
const RATE_LIMITED_BASE_MS = 60_000;
const MAX_RATE_LIMITED_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 15 * 60 * 1000;

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const WARN_PCT = 70;
const CRIT_PCT = 90;


function color(pct) {
  if (pct >= CRIT_PCT) return RED;
  if (pct >= WARN_PCT) return YELLOW;
  return GREEN;
}

function clamp(v) {
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatResetTime(date) {
  if (!date) return null;
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return null;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d${hours % 24}h`;
  return `${hours}h${minutes % 60}m`;
}

// macOS Keychain service name. Claude Code uses "Claude Code-credentials" for the
// default profile and "Claude Code-credentials-<sha256(CLAUDE_CONFIG_DIR)[:8]>"
// when a non-default config dir is set.
function keychainServiceName() {
  const configDirEnv = process.env.CLAUDE_CONFIG_DIR;
  if (configDirEnv) {
    const hash = createHash('sha256').update(configDirEnv).digest('hex').slice(0, 8);
    return `Claude Code-credentials-${hash}`;
  }
  return 'Claude Code-credentials';
}

function readKeychainEntry(service, account) {
  try {
    const args = account
      ? ['find-generic-password', '-s', service, '-a', account, '-w']
      : ['find-generic-password', '-s', service, '-w'];
    const out = execFileSync('/usr/bin/security', args, {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!out) return null;
    const parsed = JSON.parse(out);
    const creds = parsed.claudeAiOauth || parsed;
    if (!creds.accessToken) return null;
    return {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      source: 'keychain',
    };
  } catch {
    return null;
  }
}

function readKeychainCredentials() {
  if (process.platform !== 'darwin') return null;
  const service = keychainServiceName();
  const accounts = [];
  try {
    const u = userInfo().username?.trim();
    if (u) accounts.push(u);
  } catch { /* ignore */ }
  accounts.push(undefined);

  let expiredFallback = null;
  for (const account of accounts) {
    const creds = readKeychainEntry(service, account);
    if (!creds) continue;
    if (creds.expiresAt == null || creds.expiresAt > Date.now()) return creds;
    expiredFallback ??= creds;
  }
  return expiredFallback;
}

function readFileCredentials() {
  if (!existsSync(CRED_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CRED_PATH, 'utf-8'));
    const creds = raw.claudeAiOauth || raw;
    if (!creds.accessToken) return null;
    return {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      source: 'file',
    };
  } catch {
    return null;
  }
}

function readCredentials() {
  return readKeychainCredentials() || readFileCredentials();
}

function writeBackFileCredentials(updated) {
  if (!existsSync(CRED_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(CRED_PATH, 'utf-8'));
    if (raw.claudeAiOauth) {
      raw.claudeAiOauth.accessToken = updated.accessToken;
      if (updated.refreshToken) raw.claudeAiOauth.refreshToken = updated.refreshToken;
      if (updated.expiresAt) raw.claudeAiOauth.expiresAt = updated.expiresAt;
    } else {
      raw.accessToken = updated.accessToken;
      if (updated.refreshToken) raw.refreshToken = updated.refreshToken;
      if (updated.expiresAt) raw.expiresAt = updated.expiresAt;
    }
    const tmp = `${CRED_PATH}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(raw, null, 2), { mode: 0o600 });
    renameSync(tmp, CRED_PATH);
  } catch {
    try { if (existsSync(`${CRED_PATH}.tmp.${process.pid}`)) unlinkSync(`${CRED_PATH}.tmp.${process.pid}`); } catch {}
  }
}

function refreshToken(refreshTokenStr) {
  return new Promise((resolve) => {
    const clientId = process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenStr,
      client_id: clientId,
    }).toString();
    const req = https.request(
      {
        hostname: 'platform.claude.com',
        path: '/v1/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: API_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            const p = JSON.parse(data);
            if (!p.access_token) return resolve(null);
            resolve({
              accessToken: p.access_token,
              refreshToken: p.refresh_token || refreshTokenStr,
              expiresAt: p.expires_in ? Date.now() + p.expires_in * 1000 : p.expires_at,
            });
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(body);
  });
}

function fetchUsage(accessToken) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json',
        },
        timeout: API_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve({ data: JSON.parse(data) }); }
            catch { resolve({ data: null }); }
          } else if (res.statusCode === 401) {
            resolve({ data: null, unauthorized: true });
          } else if (res.statusCode === 429) {
            resolve({ data: null, rateLimited: true });
          } else {
            resolve({ data: null });
          }
        });
      },
    );
    req.on('error', () => resolve({ data: null, network: true }));
    req.on('timeout', () => { req.destroy(); resolve({ data: null, network: true }); });
    req.end();
  });
}

function parseResponse(r) {
  if (!r) return null;
  const fiveHour = r.five_hour?.utilization;
  const sevenDay = r.seven_day?.utilization;
  if (fiveHour == null && sevenDay == null) return null;
  const out = {
    fiveHourPercent: clamp(fiveHour),
    fiveHourResetsAt: parseDate(r.five_hour?.resets_at),
  };
  if (sevenDay != null) {
    out.weeklyPercent = clamp(sevenDay);
    out.weeklyResetsAt = parseDate(r.seven_day?.resets_at);
  }
  return out;
}

function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const c = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    if (c.data) {
      if (c.data.fiveHourResetsAt) c.data.fiveHourResetsAt = new Date(c.data.fiveHourResetsAt);
      if (c.data.weeklyResetsAt) c.data.weeklyResetsAt = new Date(c.data.weeklyResetsAt);
    }
    return c;
  } catch {
    return null;
  }
}

function writeCache(entry) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(entry, null, 2));
  } catch { /* ignore */ }
}

function isCacheFresh(cache) {
  if (!cache) return false;
  const age = Date.now() - cache.timestamp;
  if (cache.rateLimited) {
    if (cache.rateLimitedUntil) return Date.now() < cache.rateLimitedUntil;
    return age < RATE_LIMITED_BASE_MS;
  }
  if (cache.error) {
    return age < (cache.errorReason === 'network' ? NETWORK_TTL_MS : FAILURE_TTL_MS);
  }
  return age < POLL_INTERVAL_MS;
}

function staleUsable(cache) {
  if (!cache?.data) return false;
  if (!cache.lastSuccessAt) return false;
  return Date.now() - cache.lastSuccessAt < MAX_STALE_MS;
}

function renderModel(stdinData) {
  const raw = stdinData?.model?.display_name;
  if (!raw) return null;
  // Drop the trailing context-window label (e.g. " (1M context)") that Claude Code
  // appends to display_name — generic, so "(200K context)" etc. are handled too.
  const name = raw.replace(/\s*\([^)]*context[^)]*\)\s*$/i, '');
  if (!name) return null;
  return `${CYAN}${name}${RESET}`;
}

function renderContext(ctxPercent) {
  if (ctxPercent == null) return null;
  const pct = Math.round(clamp(ctxPercent));
  return `${DIM}ctx:${RESET}${color(pct)}${pct}%${RESET}`;
}

function render(limits, stale, stdinData) {
  const parts = [];

  const modelPart = renderModel(stdinData);
  if (modelPart) parts.push(modelPart);

  const ctxPart = renderContext(stdinData?.context_window?.used_percentage ?? null);
  if (ctxPart) parts.push(ctxPart);

  if (limits) {
    const staleMark = stale ? `${DIM}*${RESET}` : '';
    const tilde = stale ? '~' : '';

    const fh = Math.round(limits.fiveHourPercent);
    const fhReset = formatResetTime(limits.fiveHourResetsAt);
    const fhPart = fhReset
      ? `5h:${color(fh)}${fh}%${RESET}${staleMark}${DIM}(${tilde}${fhReset})${RESET}`
      : `5h:${color(fh)}${fh}%${RESET}${staleMark}`;
    parts.push(fhPart);

    if (limits.weeklyPercent != null) {
      const wk = Math.round(limits.weeklyPercent);
      const wkReset = formatResetTime(limits.weeklyResetsAt);
      const wkPart = wkReset
        ? `${DIM}wk:${RESET}${color(wk)}${wk}%${RESET}${staleMark}${DIM}(${tilde}${wkReset})${RESET}`
        : `${DIM}wk:${RESET}${color(wk)}${wk}%${RESET}${staleMark}`;
      parts.push(wkPart);
    }
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

async function getUsage() {
  const cache = readCache();
  if (cache && isCacheFresh(cache)) {
    if ((cache.rateLimited || cache.error) && staleUsable(cache)) {
      return { limits: cache.data, stale: true };
    }
    return { limits: cache.data, stale: false };
  }

  let creds = readCredentials();
  if (!creds) {
    if (staleUsable(cache)) return { limits: cache.data, stale: true };
    return { limits: null, stale: false };
  }

  const now = Date.now();
  if (creds.expiresAt && creds.expiresAt <= now && creds.refreshToken) {
    const refreshed = await refreshToken(creds.refreshToken);
    if (refreshed) {
      if (creds.source === 'file') writeBackFileCredentials(refreshed);
      // Keychain write-back deferred to Claude Code itself — avoid double-writing.
      creds = { ...creds, ...refreshed };
    }
  }

  let res = await fetchUsage(creds.accessToken);

  if (res.unauthorized && creds.refreshToken) {
    const refreshed = await refreshToken(creds.refreshToken);
    if (refreshed) {
      if (creds.source === 'file') writeBackFileCredentials(refreshed);
      res = await fetchUsage(refreshed.accessToken);
    }
  }

  if (res.rateLimited) {
    const prevCount = cache?.rateLimitedCount || 0;
    const backoff = Math.min(RATE_LIMITED_BASE_MS * Math.pow(2, prevCount), MAX_RATE_LIMITED_MS);
    writeCache({
      timestamp: Date.now(),
      data: cache?.data ?? null,
      error: false,
      rateLimited: true,
      rateLimitedCount: prevCount + 1,
      rateLimitedUntil: Date.now() + backoff,
      lastSuccessAt: cache?.lastSuccessAt,
    });
    if (staleUsable(cache)) return { limits: cache.data, stale: true };
    return { limits: null, stale: false };
  }

  if (!res.data) {
    writeCache({
      timestamp: Date.now(),
      data: cache?.data ?? null,
      error: true,
      errorReason: res.network ? 'network' : 'http',
      lastSuccessAt: cache?.lastSuccessAt,
    });
    if (staleUsable(cache)) return { limits: cache.data, stale: true };
    return { limits: null, stale: false };
  }

  const parsed = parseResponse(res.data);
  writeCache({
    timestamp: Date.now(),
    data: parsed,
    error: false,
    lastSuccessAt: Date.now(),
  });
  return { limits: parsed, stale: false };
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    let buf = '';
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    const parse = (s) => JSON.parse(s.replace(/^﻿/, ''));
    process.stdin.on('end', () => {
      try { done(parse(buf)); } catch { done(null); }
    });
    process.stdin.on('error', () => done(null));
    setTimeout(() => {
      if (buf) { try { done(parse(buf)); } catch { done(null); } }
      else { done(null); }
    }, 200);
  });
}

async function main() {
  try {
    const [stdinData, { limits, stale }] = await Promise.all([readStdin(), getUsage()]);
    const out = render(limits, stale, stdinData);
    if (out) process.stdout.write(out);
  } catch {
    // statusline must never throw
  }
}

main();
