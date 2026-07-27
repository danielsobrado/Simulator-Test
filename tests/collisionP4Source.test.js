import assert from 'node:assert/strict';
import test from 'node:test';
import { createRockCollisionSource } from '../src/editor/collision/providers/RockCollisionSource.js';

function prototype(width = 1, height = 1, depth = 1) {
  const boundingBox = {
    min: { x: -width / 2, y: 0, z: -depth / 2 },
    max: { x: width / 2, y: height, z: depth / 2 },
  };
  return {
    geometry: {
      boundingBox: null,
      computeBoundingBox() { this.boundingBox = boundingBox; },
    },
  };
}

const config = Object.freeze({
  minimumCollidableHeight: 0.3,
  minimumCollidableWidth: 0.4,
  minimumWalkableHeight: 0.7,
  minimumWalkableWidth: 1.2,
  prototypeOverrides: Object.freeze({}),
});

test('rock source derives profiles lazily when streamed variants arrive', () => {
  const placements = Object.freeze([Object.freeze({
    stableId: 'rock:0:0:1',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    x: 2,
    z: 3,
    height: 1,
    scale: 1,
    rotationY: 0,
    prototypeIndex: 0,
  })]);
  const rockView = {
    prototypes: [],
    prototypeIndicesByAsset: new Map(),
    prototypeHeights: [],
    prototypeRevision: 0,
    revisionTracker: { revision: 0 },
    biomeAssetPalette: { revision: 0 },
    pathClearance: { signature: 'path:1' },
    clusterField: { signature: 'cluster:1' },
    regionalCharacterField: { signature: 'regions:1' },
    config: { rocks: { burial: 0.2 } },
    manifestForChunk: () => placements,
  };
  const source = createRockCollisionSource({ rockView, config });

  assert.equal(source.getProfiles().length, 0);
  assert.equal(source.snapshotChunk(0, 0).placements.length, 0);
  const emptyEpoch = source.epoch();

  rockView.prototypes.push(prototype(2, 1, 1));
  rockView.prototypeHeights.push(1);
  rockView.prototypeIndicesByAsset.set('assets/rocks/ridge.glb', Object.freeze([0]));
  rockView.prototypeRevision = 1;

  const profiles = source.getProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, 'assets/rocks/ridge.glb');
  assert.equal(source.snapshotChunk(0, 0).placements, placements);
  assert.notEqual(source.epoch(), emptyEpoch);
  assert.equal(source.burialFor(placements[0], profiles[0]), 0.2);
});

test('render-only rock state does not invalidate collision authority', () => {
  const rockView = {
    prototypes: [prototype()],
    prototypeIndicesByAsset: new Map([['rock.glb', Object.freeze([0])]]),
    prototypeHeights: [1],
    prototypeRevision: 1,
    revisionTracker: { revision: 2 },
    biomeAssetPalette: { revision: 3 },
    pathClearance: { signature: 'path:1' },
    clusterField: { signature: 'cluster:1' },
    regionalCharacterField: { signature: 'regions:1' },
    config: { rocks: { burial: 0.1 } },
    signature: 'render:near',
    chunkLodStates: new Map(),
    manifestForChunk: () => Object.freeze([]),
  };
  const source = createRockCollisionSource({ rockView, config });
  const before = source.epoch();
  rockView.signature = 'render:proxy';
  rockView.chunkLodStates.set('0:0', 'impostor');
  assert.equal(source.epoch(), before);

  rockView.revisionTracker.revision += 1;
  assert.notEqual(source.epoch(), before);
});
