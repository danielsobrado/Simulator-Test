import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquirePerfRunLock } from '../scripts/perf-run-lock.mjs';

test('performance run lock rejects a concurrent live owner', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'simcity-perf-lock-'));
  const lockPath = path.join(directory, 'matrix.lock');
  try {
    const release = acquirePerfRunLock(lockPath, {
      pid: 101,
      isProcessAlive: (pid) => pid === 101,
    });
    assert.throws(
      () => acquirePerfRunLock(lockPath, {
        pid: 202,
        isProcessAlive: (pid) => pid === 101,
      }),
      /already running as PID 101/,
    );
    release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('performance run lock replaces a stale owner and releases idempotently', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'simcity-perf-lock-'));
  const lockPath = path.join(directory, 'matrix.lock');
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: 99 }), 'utf8');
    const release = acquirePerfRunLock(lockPath, {
      pid: 303,
      isProcessAlive: () => false,
    });
    release();
    release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
