import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DistantBirdFlockTier } from '../src/editor/stylized/StylizedWildlifeView.js';

const CONFIG = Object.freeze({
  maxBirds: 10,
  flockSizeMin: 4,
  flockSizeMax: 4,
  initialDelayMin: 0,
  initialDelayMax: 0,
  intervalMin: 1,
  intervalMax: 1,
  durationMin: 14,
  durationMax: 14,
  radiusMin: 80,
  radiusMax: 80,
  altitudeMin: 30,
  altitudeMax: 30,
  size: 1,
  color: '#18212b',
});

test('distant flock allocates morph storage for its full instance capacity', () => {
  const root = new THREE.Group();
  const tier = new DistantBirdFlockTier({
    terrainView: {
      floatingOrigin: { getState: () => ({ x: 0, z: 0 }) },
      getCanonicalHeight: () => 0,
    },
    config: CONFIG,
    seed: 123,
    root,
  });
  const camera = new THREE.PerspectiveCamera();

  try {
    tier.spawn(0, camera);
    assert.doesNotThrow(() => tier.update(16, camera));
    assert.equal(tier.mesh.count, 4);
    assert.equal(tier.mesh.morphTexture.source.data.data.length, (2 + 1) * CONFIG.maxBirds);
  } finally {
    tier.dispose(root);
  }
});
