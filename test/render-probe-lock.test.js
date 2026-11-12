import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { acquirePerfRunLock } from '../scripts/perf-run-lock.mjs';

test('both render probes reject a live hardware QA lock before launching a browser', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const lockFile = path.join(root, 'tmp', `perf-browser-${process.platform}.lock`);
  const release = acquirePerfRunLock(lockFile);
  try {
    for (const script of ['probe-render-census.mjs', 'probe-render-uniforms.mjs']) {
      const out = path.join(root, 'tmp', `probe-lock-test-${process.pid}.json`);
      const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), 'chunk-cross', '', out],
        { encoding: 'utf8', timeout: 15000, windowsHide: true });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`already running as PID ${process.pid}`));
      assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid, process.pid);
      assert.equal(fs.existsSync(out), false);
    }
  } finally { release(); }
});
