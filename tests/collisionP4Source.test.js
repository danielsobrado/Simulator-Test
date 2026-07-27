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

function rockViewFor(prototypes = []) {
  return {
    prototypes,
    prototypeIndicesByAsset: new Map(),
    prototypeHeights: prototypes.map(() => 1),
    prototypeRevision: 0,
    revisionTracker: { revision: 0 },
    biomeAssetPalette: { revision: 0 },
    pathClearance: { signature: 'path:1' },
    clusterField: { signature: 'cluster:1' },
    regionalCharacterField: { signature: 'regions:1' },
    config: { rocks: { burial: 0.2 } },
    manifestForChunk: () => Object.freeze([]),
  };
}

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
  const rockView = rockViewFor();
  rockView.manifestForChunk = () => placements;
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

test('failed same-count profile replacement retains and retries the previous cache', () => {
  const rockView = rockViewFor([prototype(1, 1, 1)]);
  rockView.prototypeRevision = 1;
  const source = createRockCollisionSource({ rockView, config });
  const initial = source.getProfiles();
  assert.equal(initial[0].width, 1);

  rockView.prototypes[0] = { geometry: { computeBoundingBox() { this.boundingBox = null; } } };
  rockView.prototypeRevision = 2;
  assert.throws(() => source.getProfiles(), /no bounding box/);

  rockView.prototypes[0] = prototype(2, 1, 1);
  const recovered = source.getProfiles();
  assert.equal(recovered[0].width, 2);
  assert.notEqual(recovered, initial);
});

test('render-only rock state does not invalidate collision authority', () => {
  const rockView = rockViewFor([prototype()]);
  rockView.prototypeIndicesByAsset.set('rock.glb', Object.freeze([0]));
  rockView.prototypeRevision = 1;
  rockView.revisionTracker.revision = 2;
  rockView.biomeAssetPalette.revision = 3;
  rockView.config.rocks.burial = 0.1;
  rockView.signature = 'render:near';
  rockView.chunkLodStates = new Map();
  const source = createRockCollisionSource({ rockView, config });
  const before = source.epoch();
  rockView.signature = 'render:proxy';
  rockView.chunkLodStates.set('0:0', 'impostor');
  assert.equal(source.epoch(), before);

  rockView.revisionTracker.revision += 1;
  assert.notEqual(source.epoch(), before);
});
