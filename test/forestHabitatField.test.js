import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStableChunkManifest } from '../src/editor/stylized/StableScatterManifest.js';
import { TreeManifestStore } from '../src/editor/stylized/TreeManifestStore.js';
import {
  ForestHabitatField,
  createForestPlacementEvaluator,
} from '../src/editor/stylized/forest/ForestHabitatField.js';
import { createForestBiomeProfiles } from '../src/editor/stylized/forest/ForestBiomeProfiles.js';
import { understoryClusterDensity } from '../src/editor/stylized/forest/ForestFloor.js';
import {
  resolveForestCandidateBudget,
  resolveForestSeed,
} from '../src/editor/stylized/forest/ForestRuntimeConfig.js';

function createField({ seed = 17, tileId = 7, heightAt = () => 10, config = {} } = {}) {
  return new ForestHabitatField({
    seed,
    tileSize: 2,
    tileAt: () => tileId,
    heightAt,
    config,
  });
}

function findBestSample(field) {
  let best = null;
  for (let z = -640; z <= 640; z += 32) {
    for (let x = -640; x <= 640; x += 32) {
      const sample = field.sample(x, z);
      if (!best || sample.suitability > best.sample.suitability) {
        best = { x, z, sample };
      }
    }
  }
  return best;
}

function baseManifest(overrides = {}) {
  return {
    kind: 'tree',
    chunkX: 0,
    chunkZ: 0,
    chunkSize: 16,
    tileSize: 2,
    perChunk: 16,
    tileIds: [7],
    tileAt: () => 7,
    heightAt: () => 0,
    prototypeCount: 2,
    minScale: 0.8,
    maxScale: 1.2,
    radiusForScale: () => 0,
    ...overrides,
  };
}

test('forest habitat samples are deterministic for a world seed', () => {
  const first = createField({ seed: 918273 });
  const second = createField({ seed: 918273 });
  const positions = [
    [0, 0],
    [127.5, -64.25],
    [-384.1, 512.75],
  ];

  for (const [x, z] of positions) {
    assert.deepEqual(first.sample(x, z), second.sample(x, z));
  }
});

test('different world seeds change the patch authority', () => {
  const first = createField({ seed: 11 });
  const second = createField({ seed: 29 });
  let changed = false;

  for (let z = -512; z <= 512 && !changed; z += 64) {
    for (let x = -512; x <= 512; x += 64) {
      const left = first.sample(x, z);
      const right = second.sample(x, z);
      if (left.patchId !== right.patchId || left.patchCoverage !== right.patchCoverage) {
        changed = true;
        break;
      }
    }
  }

  assert.equal(changed, true);
});

test('different biome authorities never share a patch id', () => {
  const tropical = createField({ seed: 17, tileId: 7 }).sample(120, -80);
  const temperate = createField({ seed: 17, tileId: 8 }).sample(120, -80);
  assert.notEqual(tropical.patchId, temperate.patchId);
});

test('unsupported biomes remain tree free', () => {
  const field = createField({ tileId: 0 });
  const sample = field.sample(0, 0);
  assert.equal(sample.profileKey, null);
  assert.equal(sample.patchId, null);
  assert.equal(sample.suitability, 0);
});

test('steep terrain suppresses an otherwise suitable patch', () => {
  const flat = createField();
  const best = findBestSample(flat);
  assert.ok(best.sample.suitability > 0.5);

  const steep = createField({
    heightAt: (x) => 10 + (x - best.x) * 3,
  });
  const sample = steep.sample(best.x, best.z);
  assert.ok(sample.slope > 2);
  assert.equal(sample.slopeWeight, 0);
  assert.equal(sample.suitability, 0);
});

test('placement evaluation uses stable priority as the density threshold', () => {
  const evaluator = createForestPlacementEvaluator({
    sample: () => ({
      patchId: '4:7:patch',
      profileKey: 'temperate_deciduous_forest',
      structure: 'fragmented_woodland',
      suitability: 0.4,
      patchCoverage: 0.75,
      patchEdge: 0.25,
      slope: 0.1,
      elevation: 12,
    }),
  });

  const accepted = evaluator({ x: 0, z: 0, priority: 0.25 });
  const rejected = evaluator({ x: 0, z: 0, priority: 0.5 });
  assert.equal(accepted.patchId, '4:7:patch');
  assert.equal(accepted.forestSuitability, 0.4);
  assert.equal(rejected, null);
});

test('stable scatter caps accepted records and preserves evaluator metadata', () => {
  const placements = buildStableChunkManifest(baseManifest({
    maxAccepted: 2,
    candidateEvaluator: (candidate) => (
      candidate.priority < 0.9 ? { patchId: 'stable-patch' } : null
    ),
  }));

  assert.equal(placements.length, 2);
  assert.ok(placements.every((placement) => placement.patchId === 'stable-patch'));
  assert.ok(placements[0].index < placements[1].index);
});

test('accepted limits are applied to every owner chunk before spacing', () => {
  const target = { chunkX: 2, chunkZ: -5 };
  const selectedIds = new Set();
  for (let chunkZ = target.chunkZ - 1; chunkZ <= target.chunkZ + 1; chunkZ += 1) {
    for (let chunkX = target.chunkX - 1; chunkX <= target.chunkX + 1; chunkX += 1) {
      const selected = buildStableChunkManifest(baseManifest({
        chunkX,
        chunkZ,
        perChunk: 3,
        maxAccepted: 1,
        haloChunks: 0,
      }));
      assert.equal(selected.length, 1);
      selectedIds.add(selected[0].stableId);
    }
  }

  const expected = buildStableChunkManifest(baseManifest({
    ...target,
    perChunk: 3,
    maxAccepted: Number.POSITIVE_INFINITY,
    radiusForScale: () => 3,
    candidateEvaluator: (candidate) => selectedIds.has(candidate.stableId),
  }));
  const actual = buildStableChunkManifest(baseManifest({
    ...target,
    perChunk: 3,
    maxAccepted: 1,
    radiusForScale: () => 3,
  }));

  assert.deepEqual(
    actual.map(({ stableId }) => stableId),
    expected.map(({ stableId }) => stableId),
  );
});

test('stable scatter rejects invalid accepted limits', () => {
  assert.throws(
    () => buildStableChunkManifest(baseManifest({ maxAccepted: 1.5 })),
    /maxAccepted must be a non-negative integer or Infinity/,
  );
  assert.throws(
    () => buildStableChunkManifest(baseManifest({ maxAccepted: -1 })),
    /maxAccepted must be a non-negative integer or Infinity/,
  );
});

test('candidate metadata cannot replace canonical placement authority', () => {
  assert.throws(
    () => buildStableChunkManifest(baseManifest({
      candidateEvaluator: () => ({ x: 999 }),
    })),
    /cannot override canonical field "x"/,
  );
  assert.throws(
    () => buildStableChunkManifest(baseManifest({
      candidateEvaluator: () => [],
    })),
    /must return a plain object/,
  );
});

test('forest runtime seed follows the active world generator', () => {
  assert.equal(resolveForestSeed({ generator: { seed: 918273 } }), 918273);
  assert.equal(resolveForestSeed({
    generator: { toMetadata: () => ({ seed: 42 }) },
  }), 42);
  assert.equal(resolveForestSeed({ seed: 7 }), 7);
});

test('tree manifest integration uses the active generator seed', () => {
  const terrainView = {
    worldStore: {
      seed: 1,
      chunkSize: 64,
      tileSize: 2,
      generator: { seed: 918273 },
    },
    tileMap: { get: () => 7 },
    getCanonicalHeight: () => 10,
    chunkWorldSize: 128,
  };
  const config = {
    trees: {
      perChunk: 12,
      clearRadius: 3.5,
      tileIds: [7],
      minScale: 0.8,
      maxScale: 1.2,
    },
    streaming: {},
  };
  const store = new TreeManifestStore({
    terrainView,
    config,
    revisionTracker: { signature: () => 'stable' },
    prototypeCount: 1,
  });

  assert.equal(store.forestField.seed, 918273);
  store.dispose();
});

test('a wood keeps a shrub layer where the cluster field has none', () => {
  assert.equal(understoryClusterDensity(0, { patchCoverage: 1 }, 0.9), 0.9);
  assert.equal(understoryClusterDensity(0, { patchCoverage: 0.5 }, 0.8), 0.4);
  assert.equal(understoryClusterDensity(0.95, { patchCoverage: 1 }, 0.9), 0.95);
  assert.equal(understoryClusterDensity(0.3, null, 0.9), 0.3);
  assert.equal(understoryClusterDensity(0, { patchCoverage: 1 }), 0);
});

test('forest biomes stay wooded through meadow districts', () => {
  const profiles = createForestBiomeProfiles({ 6: { regionalForestFloor: 0.85 } });
  const field = new ForestHabitatField({
    tileSize: 2,
    tileAt: () => 6,
    heightAt: () => 5,
    regionalCharacterField: { signature: 'meadow', sampleChannel: () => 0.2 },
    config: { profiles: { 6: profiles.get(6) } },
  });
  assert.equal(field.sampleCoarse(0, 0).regionalForest, 0.85);
});

test('forest candidate budgets are finite and bounded', () => {
  assert.equal(resolveForestCandidateBudget(12), 24);
  assert.equal(resolveForestCandidateBudget(12, Number.NaN), 24);
  assert.equal(resolveForestCandidateBudget(12, -100), 12);
  assert.equal(resolveForestCandidateBudget(12, 1_000_000), 96);
  assert.throws(
    () => resolveForestCandidateBudget(0),
    /positive integer/,
  );
});
