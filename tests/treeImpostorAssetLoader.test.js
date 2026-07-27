import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TreeImpostorAssetLoader,
} from '../src/editor/stylized/impostor/TreeImpostorAssets.js';
import {
  TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION,
  TREE_IMPOSTOR_MANIFEST_VERSION,
  TREE_IMPOSTOR_NORMAL_ENCODING,
} from '../src/editor/stylized/impostor/TreeImpostorManifest.js';

function prototype(index = 0) {
  return {
    prototypeIndex: index,
    columns: 8,
    rows: 2,
    tileSize: 128,
    gutter: 4,
    lowElevationDegrees: 12,
    highElevationDegrees: 58,
    width: 7,
    height: 9,
    depth: 6,
    centerY: 4.5,
    radius: 5,
    albedo: `/assets/impostors/trees/prototype-${index}-albedo.png`,
    normal: `/assets/impostors/trees/prototype-${index}-normal.png`,
  };
}

function response(version, extra = {}) {
  return {
    ok: true,
    json: async () => ({
      version,
      generatedAt: '2026-07-27T00:00:00.000Z',
      sourceSignature: version === TREE_IMPOSTOR_MANIFEST_VERSION
        ? 'tree-impostor-v2-current'
        : 'tree-impostor-v1-legacy',
      prototypes: [{
        ...prototype(),
        ...(version === TREE_IMPOSTOR_MANIFEST_VERSION
          ? { normalEncoding: TREE_IMPOSTOR_NORMAL_ENCODING }
          : {}),
      }],
      ...extra,
    }),
  };
}

test('legacy atlases are bypassed before texture upload', async () => {
  let loads = 0;
  const loader = new TreeImpostorAssetLoader({
    fetchImpl: async () => response(TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION),
    loader: {
      loadAsync: async () => {
        loads += 1;
        return { dispose() {} };
      },
    },
    expectedPrototypeCount: 1,
    expectedSourceSignature: 'tree-impostor-v2-current',
  });

  assert.equal(await loader.load('/assets/impostors/trees/manifest.json'), null);
  assert.equal(loads, 0);
});

test('v3 atlases load only when signature and mask encoding match', async () => {
  const textures = [];
  const loader = new TreeImpostorAssetLoader({
    fetchImpl: async () => response(TREE_IMPOSTOR_MANIFEST_VERSION),
    loader: {
      loadAsync: async (path) => {
        const texture = { path, dispose() {} };
        textures.push(texture);
        return texture;
      },
    },
    expectedPrototypeCount: 1,
    expectedSourceSignature: 'tree-impostor-v2-current',
  });

  const atlases = await loader.load('/assets/impostors/trees/manifest.json');
  assert.equal(atlases.length, 1);
  assert.equal(textures.length, 2);
  assert.equal(atlases[0].normalEncoding, TREE_IMPOSTOR_NORMAL_ENCODING);
});
