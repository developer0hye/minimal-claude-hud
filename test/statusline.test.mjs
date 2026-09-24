import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../omc-limits-statusline.mjs', import.meta.url));

test('fast mode renders from each invocation alongside existing HUD fields', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'minimal-hud-test-'));
  try {
    mkdirSync(join(configDir, 'cache'));
    // Keep the integration test offline and independent of real credentials.
    writeFileSync(join(configDir, 'cache/omc-limits-cache.json'), JSON.stringify({
      timestamp: Date.now(), lastSuccessAt: Date.now(),
      data: { fiveHourPercent: 13, weeklyPercent: 3 },
    }));
    const base = {
      cwd: configDir,
      model: { display_name: 'Opus (1M context)' },
      context_window: { used_percentage: 42 },
    };
    for (const value of [true, false, true, undefined, null, 'false', 0, {}]) {
      const result = spawnSync(process.execPath, [script], {
        input: JSON.stringify({ ...base, fast_mode: value }),
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        encoding: 'utf8', timeout: 5000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      const plain = result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
      const fast = typeof value === 'boolean' ? ` fast:${value ? 'on' : 'off'}` : '';
      assert.ok(plain.endsWith(` Opus${fast} ctx:42% 5h:13% wk:3%`), plain);
      if (typeof value === 'boolean') {
        assert.ok(result.stdout.includes(value ? '\x1b[32mon\x1b[0m' : '\x1b[2moff\x1b[0m'));
      } else {
        assert.ok(!plain.includes('fast:'));
      }
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});
