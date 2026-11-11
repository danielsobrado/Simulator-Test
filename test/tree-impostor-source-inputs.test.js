import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { treeImpostorSourceInputs, validateTreeImpostorSourceInputs } from '../scripts/lib/tree-impostor-source-inputs.mjs';

test('offline validation detects stale geometry, scanned bark, shader and bake settings while allowing runtime density changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tree-inputs-'));
  const config = { stylizedSurface: { assets: { scene: '/assets/tree.glb', barkScans: { pine: '/assets/pine' } }, trees: { perChunk: 12, leafTop: '#678945' } } };
  const saveConfig = () => writeFile(path.join(root, 'editor.config.yaml'), JSON.stringify(config));
  try {
    await mkdir(path.join(root, 'public/assets'), { recursive: true });
    await writeFile(path.join(root, 'public/assets/tree.glb'), 'first geometry');
    for (const suffix of ['albedo-height', 'normal-roughness']) {
      await writeFile(path.join(root, `public/assets/pine-${suffix}.png`), 'first bark');
    }
    await writeFile(path.join(root, 'shader.js'), 'first shader');
    await saveConfig();
    const sourceFiles = ['shader.js'];
    const manifest = { sourceInputs: await treeImpostorSourceInputs(root, sourceFiles) };
    await validateTreeImpostorSourceInputs(manifest, root, sourceFiles);
    for (const suffix of ['albedo-height', 'normal-roughness']) {
      const file = path.join(root, `public/assets/pine-${suffix}.png`);
      await writeFile(file, 'changed bark');
      await assert.rejects(validateTreeImpostorSourceInputs(manifest, root, sourceFiles), new RegExp(`pine-${suffix}`));
      await writeFile(file, 'first bark');
    }
    delete config.stylizedSurface.assets.barkScans;
    await saveConfig();
    await assert.rejects(validateTreeImpostorSourceInputs(manifest, root, sourceFiles), /configuration changed/);
    config.stylizedSurface.assets.barkScans = { pine: '/assets/pine' };
    await saveConfig();
    config.stylizedSurface.trees.perChunk = 48;
    await saveConfig();
    await validateTreeImpostorSourceInputs(manifest, root, sourceFiles);
    await writeFile(path.join(root, 'public/assets/tree.glb'), 'second geometry');
    await assert.rejects(validateTreeImpostorSourceInputs(manifest, root, sourceFiles), /tree.glb/);
    await writeFile(path.join(root, 'public/assets/tree.glb'), 'first geometry');
    await writeFile(path.join(root, 'shader.js'), 'second shader');
    await assert.rejects(validateTreeImpostorSourceInputs(manifest, root, sourceFiles), /shader.js/);
    await writeFile(path.join(root, 'shader.js'), 'first shader');
    config.stylizedSurface.trees.leafTop = '#ffffff'; await saveConfig();
    await assert.rejects(validateTreeImpostorSourceInputs(manifest, root, sourceFiles), /configuration changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
