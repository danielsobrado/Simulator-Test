import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { AlpineRockView } from '../src/editor/stylized/alpine/AlpineRockView.js';

function view(tile, height) {
  const terrainView = {
    floatingOrigin: {},
    getCanonicalHeight: () => height,
    worldStore: { tileSize: 10, chunkSize: 16, getTile: () => tile },
  };
  return new AlpineRockView({
    scene: new THREE.Scene(),
    terrainView,
    snowGroundByTile: { 11: 1 },
    cragsByTile: { 32: 1 },
    seaLevel: 0,
    snowBand: { snowLine: 700, snowFade: 250 },
  });
}

test('crags carry their own biome or altitude snow, not a shared amount', () => {
  assert.equal(view(32, 200).groundAt(0, 0).snow, 0, 'low badlands crags stay bare');
  assert.equal(view(11, 200).groundAt(0, 0).snow, 1, 'glacier crags take the biome snow');
  assert.equal(view(32, 1000).groundAt(0, 0).snow, 1, 'crags above the snow band are white anywhere');
  const partial = view(32, 825).groundAt(0, 0).snow;
  assert.ok(partial > 0.4 && partial < 0.6, `half way up the band: ${partial}`);
});
