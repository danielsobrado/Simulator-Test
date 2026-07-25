import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStableChunkManifest } from '../src/editor/stylized/StableScatterManifest.js';
import { aggregateCanopyClusters } from '../src/editor/stylized/lod/canopyCluster.js';
import { ForestEditStore } from '../src/editor/stylized/forest/ForestEditStore.js';
import {
  filterScatterByForest,
  forestFloorDensity,
} from '../src/editor/stylized/forest/ForestFloor.js';
import { createForestProceduralAssetLibrary } from '../src/editor/stylized/forest/ForestProceduralAssetLibrary.js';
import { ForestSpeciesRegistry } from '../src/editor/stylized/forest/ForestSpeciesRegistry.js';
import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';

function manifest(density) {
  const registry = new ForestSpeciesRegistry({ prototypeCount: 3 });
  return buildStableChunkManifest({
    kind: 'tree',
    chunkX: 0,
    chunkZ: 0,
    chunkSize: 32,
    tileSize: 2,
    perChunk: 64,
    maxAccepted: 64,
    haloChunks: 0,
    tileIds: [6],
    tileAt: () => 6,
    heightAt: () => 0,
    prototypeCount: 3,
    minScale: 0.8,
    maxScale: 1.2,
    radiusForScale: () => 0,
    candidateEvaluator: (candidate) => {
      if (candidate.priority >= density) return null;
      return {
        patchId: 'temperate:patch',
        forestSuitability: density,
        ...registry.select(candidate, {
          profileKey: 'temperate_deciduous_forest',
          patchEdge: 0.2,
          patchCoverage: 0.8,
          slope: 0,
          waterWeight: 1,
        }),
        radius: 0,
      };
    },
  });
}

test('ecological records are deterministic and denser manifests preserve existing trees', () => {
  const sparse = manifest(0.35);
  const dense = manifest(0.8);
  const denseIds = new Set(dense.map((record) => record.stableId));
  assert.ok(sparse.length > 0);
  assert.ok(dense.length > sparse.length);
  assert.ok(sparse.every((record) => denseIds.has(record.stableId)));
  assert.ok(dense.every((record) => (
    typeof record.speciesId === 'string'
    && typeof record.ageClass === 'string'
    && Number.isFinite(record.crownScale)
    && Number.isFinite(record.colorSeed)
    && Number.isFinite(record.windSeed)
  )));
});

test('patch canopy aggregation preserves separate groves and creates lobes', () => {
  const placements = [
    { stableId: 'a', patchId: 'patch-a', x: 0, z: 0, height: 1, scale: 1, radius: 1 },
    { stableId: 'b', patchId: 'patch-a', x: 2, z: 0, height: 2, scale: 1, radius: 1 },
    { stableId: 'c', patchId: 'patch-b', x: 30, z: 0, height: 1, scale: 1, radius: 1 },
  ];
  const clusters = aggregateCanopyClusters({ chunkX: 0, chunkZ: 0, placements });
  assert.equal(new Set(clusters.map((cluster) => cluster.patchId)).size, 2);
  assert.ok(clusters.every((cluster) => cluster.stableId.includes(cluster.patchId)));
  assert.ok(clusters.some((cluster) => cluster.x < 10));
  assert.ok(clusters.some((cluster) => cluster.x > 20));
});

test('forest floor suppresses core meadow cover while retaining edges', () => {
  const core = { patchId: 'a', patchCoverage: 1, patchEdge: 0 };
  const edge = { patchId: 'a', patchCoverage: 1, patchEdge: 1 };
  assert.ok(forestFloorDensity(core, 'grass') < forestFloorDensity(edge, 'grass'));
  assert.ok(forestFloorDensity(core, 'flower') < forestFloorDensity(core, 'grass'));

  const scatter = filterScatterByForest({
    scatter: {
      base: Float32Array.of(0, 0, 0, 1, 0, 1),
      parameters: Float32Array.of(1, 1, 0, 0.1, 1, 1, 0, 0.9),
      count: 2,
    },
    descriptor: { centerWorldX: 0, centerWorldZ: 0 },
    field: { sample: () => core },
    kind: 'grass',
  });
  assert.equal(scatter.count, 1);
});

test('forest edits persist only deltas and filter seed-derived trees', () => {
  const edits = new ForestEditStore();
  edits.fell('tree:0:0:4');
  edits.plant({
    stableId: 'planted:1',
    x: 4,
    z: -4,
    speciesId: 'conifer_narrow',
    ageClass: 'young',
  });
  edits.setPatchState('patch-a', 'regrowing', 0.25);
  const document = edits.toDocument();
  const restored = new ForestEditStore(document);
  assert.equal(restored.allows({ stableId: 'tree:0:0:4', patchId: 'patch-b', priority: 0 }), false);
  assert.equal(restored.plantedForChunk(0, 0, 128).length, 1);
  assert.deepEqual(restored.toDocument(), document);
  assert.equal(Object.hasOwn(document, 'generatedTrees'), false);
});

test('forest edit deltas round-trip with the infinite world document', () => {
  const createStore = () => new InfiniteWorldStore({
    chunkSize: 4,
    tileSize: 2,
    generator: new ProceduralWorldGenerator({ seed: 42 }),
  });
  const source = createStore();
  source.forestEdits = {
    version: 1,
    felled: ['tree:0:0:4'],
    planted: [],
    patches: [{ patchId: 'patch-a', state: 'burned', progress: 0.5 }],
  };
  const document = source.toDocument();
  const restored = createStore();
  restored.loadDocument(document);
  assert.deepEqual(restored.forestEdits, source.forestEdits);
});

test('offline forest asset recipes cover species, ages, LODs, roots, and impostors', () => {
  const library = createForestProceduralAssetLibrary({ seedsPerSpecies: 2 });
  assert.ok(library.assets.length >= 50);
  assert.ok(library.assets.some((asset) => asset.rootCollar));
  assert.ok(library.assets.every((asset) => (
    asset.outputs.lod0.endsWith('.glb')
    && asset.outputs.lod1.endsWith('.glb')
    && asset.outputs.impostor.length > 0
    && asset.signature.length === 8
  )));
});
