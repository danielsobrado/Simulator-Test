import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTreeCollisionSource,
  treeCollisionPlacementSignature,
} from '../src/editor/collision/providers/TreeCollisionSource.js';

function attribute(points) {
  return {
    count: points.length,
    getX: (index) => points[index][0],
    getY: (index) => points[index][1],
    getZ: (index) => points[index][2],
  };
}

function trunkPrototype() {
  const points = [[0, 0, 0], [0, 8, 0]];
  for (const y of [1, 2]) {
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * Math.PI * 2;
      points.push([Math.cos(angle) * 0.4, y, Math.sin(angle) * 0.4]);
    }
  }
  return [{
    kind: 'trunk',
    geometry: {
      getAttribute: (name) => (name === 'position' ? attribute(points) : null),
    },
  }];
}

function placement(overrides = {}) {
  return Object.freeze({
    stableId: 'tree:0:0:1',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    x: 4,
    z: -6,
    height: 2,
    scale: 1,
    rotationY: 0,
    prototypeIndex: 0,
    speciesId: 'broadleaf_round',
    ageClass: 'mature',
    ...overrides,
  });
}

test('tree collision source reads canonical manifests and includes planted trees', () => {
  let cached = null;
  let buildCount = 0;
  const placements = Object.freeze([
    placement(),
    placement({ stableId: 'planted:oak:7', x: 8, planted: true }),
  ]);
  const manifestStore = {
    editStore: { revision: 2 },
    pathClearance: { signature: 'paths:1' },
    forestField: { signature: 'forest:1' },
    speciesRegistry: { signature: 'species:1' },
    get: () => cached,
    build: () => {
      buildCount += 1;
      cached = placements;
      return cached;
    },
    context: () => ({ signature: 'context:1' }),
  };
  const treeView = {
    prototypes: [trunkPrototype()],
    prototypeSignature: 'prototype:1',
    manifestStore,
    terrainView: { worldStore: { revision: 4 } },
    objectMap: { revision: 3 },
    biomeAssetPalette: { revision: 5 },
    resolvePalettePrototypeIndex: (record) => record.prototypeIndex,
  };
  const source = createTreeCollisionSource({
    treeView,
    config: { minimumTrunkRadius: 0.16, prototypeOverrides: {} },
  });
  const snapshot = source.snapshotChunk(0, 0);

  assert.equal(buildCount, 1);
  assert.equal(snapshot.placements.length, 2);
  assert.equal(snapshot.placements[1].planted, true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(source.profiles), true);
  assert.match(snapshot.signature, /^context:1\|2:/);
  assert.equal(source.resolvePrototypeIndex(snapshot.placements[0]), 0);
});

test('tree placement signatures ignore render LOD fields but track collision authority', () => {
  const base = placement();
  const lodOnly = placement({ renderBand: 'impostor', fade: 0.1 });
  const scaled = placement({ heightScale: 1.5 });

  assert.equal(
    treeCollisionPlacementSignature([base]),
    treeCollisionPlacementSignature([lodOnly]),
  );
  assert.notEqual(
    treeCollisionPlacementSignature([base]),
    treeCollisionPlacementSignature([scaled]),
  );
});
