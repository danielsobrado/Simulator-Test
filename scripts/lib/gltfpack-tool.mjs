import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashBytes } from './glb-inspection.mjs';

export const GLTFPACK_VERSION = '1.2';

const RELEASES = Object.freeze({
  'darwin-arm64': {
    archive: 'gltfpack-macos.zip',
    sha256: '9f5288a6ad585bef3befbc2907c9f9b9fdeeb0b5a29eaa57f0fe15521b82eb28',
    executable: 'gltfpack',
  },
  'darwin-x64': {
    archive: 'gltfpack-macos-intel.zip',
    sha256: 'bcbd379f212552a84ca19fc986750ce8a4c3fd6c13344df6dbcff7bbf6bc121c',
    executable: 'gltfpack',
  },
  'linux-x64': {
    archive: 'gltfpack-ubuntu.zip',
    sha256: 'ebc236f5f6c08c7e5c5750476a187d24805d44d8c680449c4b7369c333f817b1',
    executable: 'gltfpack',
  },
  'win32-x64': {
    archive: 'gltfpack-windows.zip',
    sha256: '52e0c061d8b42f1c6bd8fe1cbc1e26a9da579ad5a4f5dd30a8ee0d599062f6c4',
    executable: 'gltfpack.exe',
  },
});

function assertInside(parent, target) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to write gltfpack tool outside ${resolvedParent}.`);
  }
}

function verifyVersion(executablePath) {
  const result = spawnSync(executablePath, ['-v'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.includes(`gltfpack ${GLTFPACK_VERSION}`)) {
    throw new Error(
      `Expected gltfpack ${GLTFPACK_VERSION} at ${executablePath}; `
      + `${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
}

export async function ensureGltfpack(repositoryRoot) {
  const platformKey = `${process.platform}-${process.arch}`;
  const release = RELEASES[platformKey];
  if (!release) {
    throw new Error(
      `No pinned gltfpack ${GLTFPACK_VERSION} binary for ${platformKey}. `
      + 'Supported platforms: darwin-arm64, darwin-x64, linux-x64, win32-x64.',
    );
  }

  const toolsRoot = path.join(repositoryRoot, 'tmp', 'tools', 'gltfpack');
  const toolDirectory = path.join(toolsRoot, `v${GLTFPACK_VERSION}`, platformKey);
  const executablePath = path.join(toolDirectory, release.executable);
  assertInside(repositoryRoot, executablePath);
  if (fs.existsSync(executablePath)) {
    verifyVersion(executablePath);
    return executablePath;
  }

  fs.mkdirSync(toolDirectory, { recursive: true });
  const archivePath = path.join(
    repositoryRoot,
    'tmp',
    `gltfpack-v${GLTFPACK_VERSION}-${platformKey}.zip`,
  );
  assertInside(repositoryRoot, archivePath);
  const url = `https://github.com/zeux/meshoptimizer/releases/download/`
    + `v${GLTFPACK_VERSION}/${release.archive}`;
  console.log(`downloading pinned gltfpack ${GLTFPACK_VERSION} for ${platformKey}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}.`);
  }
  const archiveBytes = Buffer.from(await response.arrayBuffer());
  const actualHash = hashBytes(archiveBytes);
  if (actualHash !== release.sha256) {
    throw new Error(
      `gltfpack archive checksum mismatch: expected ${release.sha256}, got ${actualHash}.`,
    );
  }
  fs.writeFileSync(archivePath, archiveBytes);

  const extraction = spawnSync(
    'tar',
    ['-xf', archivePath, '-C', toolDirectory],
    { encoding: 'utf8', windowsHide: true },
  );
  if (extraction.status !== 0) {
    throw new Error(
      `Unable to extract ${archivePath}: `
      + `${extraction.stderr || extraction.stdout || `exit ${extraction.status}`}`,
    );
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`gltfpack archive did not contain ${release.executable}.`);
  }
  if (process.platform !== 'win32') fs.chmodSync(executablePath, 0o755);
  verifyVersion(executablePath);
  return executablePath;
}

