import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

function defaultProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

export function acquirePerfRunLock(
  lockPath,
  {
    pid = process.pid,
    isProcessAlive = defaultProcessAlive,
  } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = openSync(lockPath, 'wx');
      writeFileSync(handle, `${JSON.stringify({ pid, startedAt: new Date().toISOString() })}\n`);
      closeSync(handle);
    } catch (error) {
      if (handle !== undefined) closeSync(handle);
      if (error?.code !== 'EEXIST') throw error;
      const owner = lockOwner(lockPath);
      if (isProcessAlive(owner?.pid)) {
        throw new Error(`Performance matrix is already running as PID ${owner.pid}.`);
      }
      unlinkSync(lockPath);
      continue;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const owner = lockOwner(lockPath);
      if (owner?.pid !== pid) return;
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    };
  }
  throw new Error('Could not acquire the performance matrix run lock.');
}
