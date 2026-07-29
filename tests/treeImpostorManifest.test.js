import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION,
  TREE_IMPOSTOR_LEGACY_NORMAL_ENCODING,
  TREE_IMPOSTOR_MANIFEST_VERSION,
  TREE_IMPOSTOR_NORMAL_ENCODING,
  createTreeImpostorSourceSignature,
  validateTreeImpostorManifest,
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
    normalEncoding: TREE_IMPOSTOR_NORMAL_ENCODING,
    albedo: `/assets/impostors/trees/prototype-${index}-albedo.png`,
    normal: `/assets/impostors/trees/prototype-${index}-normal.png`,
  };
}

function manifest(prototypes = [prototype()]) {
  return {
    version: TREE_IMPOSTOR_MANIFEST_VERSION,
    generatedAt: '2026-07-23T00:00:00.000Z',
    sourceSignature: 'tree-impostor-v2-12345678',
    prototypes,
  };
}

function geometry(size = 1) {
  return {
    boundingBox: null,
    attributes: {
      position: { count: 10 * size },
      normal: { count: 10 * size },
      uv: { count: 10 * size },
    },
    index: { count: 18 * size },
    computeBoundingBox() {
      this.boundingBox = {
        min: { x: 0, y: 0, z: 0 },
        max: { x: size, y: size * 2, z: size },
      };
    },
  };
}

test('validates a compatible contiguous manifest', () => {
  const value = manifest([prototype(0), prototype(1)]);
  const result = validateTreeImpostorManifest(value, {
    expectedPrototypeCount: 2,
    expectedSourceSignature: value.sourceSignature,
  });
  assert.equal(result.prototypes.length, 2);
  assert.equal(result.prototypes[1].prototypeIndex, 1);
  assert.equal(result.prototypes[1].normalEncoding, TREE_IMPOSTOR_NORMAL_ENCODING);
  assert.equal(result.requiresRuntimeBake, false);
});

test('normalises encoding metadata produced by the bundle writer', () => {
  const value = prototype();
  delete value.normalEncoding;
  const result = validateTreeImpostorManifest(manifest([value]));
  assert.equal(result.prototypes[0].normalEncoding, TREE_IMPOSTOR_NORMAL_ENCODING);
});

test('accepts legacy atlases only as runtime-bake migration inputs', () => {
  const value = prototype();
  delete value.normalEncoding;
  const result = validateTreeImpostorManifest({
    ...manifest([value]),
    version: TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION,
    sourceSignature: 'tree-impostor-v1-12345678',
  }, {
    expectedSourceSignature: 'tree-impostor-v2-deadbeef',
  });

  assert.equal(result.requiresRuntimeBake, true);
  assert.equal(result.normalEncoding, TREE_IMPOSTOR_LEGACY_NORMAL_ENCODING);
  assert.equal(result.prototypes[0].normalEncoding, TREE_IMPOSTOR_LEGACY_NORMAL_ENCODING);
});

test('rejects legacy migration atlases when current offline assets are required', () => {
  const value = prototype();
  delete value.normalEncoding;

  assert.throws(() => validateTreeImpostorManifest({
    ...manifest([value]),
    version: TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION,
    sourceSignature: 'tree-impostor-v1-12345678',
  }, {
    allowLegacy: false,
  }), /legacy.*runtime bake/i);
});

test('rejects stale source signatures for renderable v3 assets', () => {
  assert.throws(() => validateTreeImpostorManifest(manifest(), {
    expectedSourceSignature: 'tree-impostor-v2-deadbeef',
  }), /does not match/);
});

test('rejects unsupported manifest versions and incompatible normal encodings', () => {
  assert.throws(() => validateTreeImpostorManifest({
    ...manifest(),
    version: TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION - 1,
  }), /unsupported/);
  assert.throws(() => validateTreeImpostorManifest(manifest([{
    ...prototype(),
    normalEncoding: TREE_IMPOSTOR_LEGACY_NORMAL_ENCODING,
  }])), /normal encoding/);
});

test('rejects missing or non-contiguous prototypes', () => {
  assert.throws(() => validateTreeImpostorManifest(manifest([prototype(1)])), /expected index 0/);
  assert.throws(() => validateTreeImpostorManifest(manifest(), {
    expectedPrototypeCount: 2,
  }), /expected 2/);
});

test('source signature changes with geometry or bake configuration', () => {
  const config = { trees: { leafTop: '#ffffff' }, lod: { impostor: { columns: 8 } } };
  const first = createTreeImpostorSourceSignature([
    [{ kind: 'leaf', geometry: geometry(1), sourceMap: null }],
  ], config);
  const geometryChanged = createTreeImpostorSourceSignature([
    [{ kind: 'leaf', geometry: geometry(2), sourceMap: null }],
  ], config);
  const configChanged = createTreeImpostorSourceSignature([
    [{ kind: 'leaf', geometry: geometry(1), sourceMap: null }],
  ], { ...config, lod: { impostor: { columns: 16 } } });
  assert.match(first, /^tree-impostor-v2-/);
  assert.notEqual(first, geometryChanged);
  assert.notEqual(first, configChanged);
});

test('source signature changes with authored tree material configuration', () => {
  const prototypeParts = [[{
    kind: 'trunk',
    geometry: geometry(1),
    sourceMap: null,
  }]];
  const first = createTreeImpostorSourceSignature(prototypeParts, {
    trees: {},
    assets: { treeVariants: [{ barkProfile: 'spruce', barkScale: 0.8 }] },
    lod: { impostor: {} },
  });
  const changed = createTreeImpostorSourceSignature(prototypeParts, {
    trees: {},
    assets: { treeVariants: [{ barkProfile: 'beech', barkScale: 0.8 }] },
    lod: { impostor: {} },
  });

  assert.notEqual(first, changed);
});
