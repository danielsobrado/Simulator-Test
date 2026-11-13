import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChunkLodPlan, pruneStateMap } from '../src/editor/stylized/lod/StylizedLodRuntime.js';

// Recorded from the plan builder before its per-chunk garbage was cut: those cuts must
// leave every entry, stored state, transition call and signature byte-identical.

const freezeReps = (...values) => Object.freeze(values.map((value) => Object.freeze(value)));
const settled = (band) => ({ from: band, target: band, startedAt: 0, complete: true,
  representations: freezeReps({ band, fade: 1, ditherDirection: 1 }) });

function snapshot(plan, states, transitions) {
  return { signature: plan.signature, entries: plan.entries, states: [...states], transitions: [...transitions] };
}

/** Tree-like layer: perspective camera, focus-ring distance, no manifest anchors. */
function treeLikeRuns() {
  const states = new Map([
    ['1:0', settled('near')],
    ['2:0', settled('impostor')],
    ['0:1', { from: 'proxy', target: 'near', startedAt: 900, complete: false,
      representations: freezeReps({ band: 'proxy', fade: 0.5, ditherDirection: -1 },
        { band: 'near', fade: 0.5, ditherDirection: 1 }) }],
    ['3:2', { from: 'culled', target: 'proxy', startedAt: 800, complete: false, waitingForData: true,
      representations: freezeReps({ band: 'culled', fade: 1, ditherDirection: -1 },
        { band: 'proxy', fade: Number.EPSILON, ditherDirection: 1 }) }],
    ['9:9', settled('near')],
  ]);
  const transitions = [];
  const base = {
    focus: { chunkX: 1, chunkZ: 0 }, radius: 2, chunkWorldSize: 64,
    floatingOrigin: { getState: () => ({ x: 16, z: -8 }) },
    viewportHeight: 720, objectHeight: 14,
    thresholds: { nearPixels: 150, proxyPixels: 80, impostorPixels: 50, clusterPixels: 40, hysteresisRatio: 0.2 },
    // The tree view passes its whole settings object as `radii`.
    radii: Object.freeze({ enabled: true, meshRadius: 1, proxyRadius: 1, impostorRadius: 2, clusterRadius: 3,
      forceNearWithinMeshRadius: false, transitionMs: 300, thresholds: {} }),
    transitionStates: states, transitionMs: 300,
    onTransition: (call) => transitions.push(call),
  };
  const runs = [];
  for (const [position, timestamp] of [
    [{ x: 40, y: 18, z: -30 }, 1000],
    [{ x: 110, y: 22, z: 20 }, 1150],
    [{ x: 110, y: 22, z: 20 }, 1600],
  ]) {
    transitions.length = 0;
    const plan = buildChunkLodPlan({ ...base, camera: { position, fov: 60, zoom: 1 }, timestamp });
    runs.push(snapshot(plan, states, transitions));
  }
  return runs;
}

/** Bush-like layer: manifest anchors that arrive late and a camera-centred distance. */
function anchoredRuns() {
  const states = new Map([
    ['-4:4', settled('proxy')],
    ['-3:5', { from: 'near', target: 'proxy', startedAt: -100, complete: false,
      representations: freezeReps({ band: 'near', fade: 0.75, ditherDirection: -1 },
        { band: 'proxy', fade: 0.25, ditherDirection: 1 }) }],
    ['-5:2', settled('culled')],
  ]);
  const transitions = [];
  let missing;
  let centreX;
  const base = {
    focus: { chunkX: -3, chunkZ: 4 }, radius: 2, chunkWorldSize: 32,
    floatingOrigin: { getState: () => ({ x: -64, z: -96 }) },
    viewportHeight: 900, objectHeight: 3,
    thresholds: { nearPixels: 60, proxyPixels: 30, impostorPixels: 12, clusterPixels: 6 },
    radii: { meshRadius: 1, proxyRadius: 2, impostorRadius: 2, clusterRadius: 2, forceNearWithinMeshRadius: true },
    transitionStates: states, transitionMs: 220, fadeSteps: 4,
    positionForChunk: (chunkX, chunkZ) => {
      if (missing.has(`${chunkX}:${chunkZ}`)) return null;
      const x = (chunkX + 0.5) * 32 + 3;
      const z = -(chunkZ + 0.5) * 32 - 5;
      if ((chunkX + chunkZ) % 3 === 0) return { x, z };
      return { x, y: chunkZ - 2.5, z, heightScale: chunkX === -2 ? 0.01 : 0.5 + (chunkZ & 3) * 0.25 };
    },
    distanceForChunk: (chunkX, chunkZ) => (chunkX === -1 && chunkZ === 2
      ? Infinity : Math.max(Math.abs(chunkX - centreX), Math.abs(chunkZ - 4))),
    onTransition: (call) => transitions.push(call),
  };
  const runs = [];
  for (const [position, timestamp, absent, centre] of [
    [{ x: -16, y: 8, z: -48 }, 0, ['-2:3', '-5:6', '-1:2'], -4],
    [{ x: 10, y: 8, z: -20 }, 110, ['-2:3'], -3],
    [{ x: 10, y: 8, z: -20 }, 1000, [], -3],
  ]) {
    transitions.length = 0;
    missing = new Set(absent);
    centreX = centre;
    const plan = buildChunkLodPlan({ ...base, camera: { position, fov: 75, zoom: 1.25 }, timestamp });
    runs.push(snapshot(plan, states, transitions));
  }
  return runs;
}

const TREE_LIKE_RUNS = [
  {
    signature: '-1:-2:impostor:ready:culled:8:-1:impostor:0:1|0:-2:impostor:ready:culled:8:-1:impostor:0:1|1:-2:impostor:ready:culled:8:-1:impostor:0:1|2:-2:impostor:ready:culled:8:-1:impostor:0:1|3:-2:cluster:ready:culled:8:-1:cluster:0:1|-1:-1:impostor:ready:culled:8:-1:impostor:0:1|0:-1:near:ready:culled:8:-1:near:0:1|1:-1:near:ready:culled:8:-1:near:0:1|2:-1:impostor:ready:culled:8:-1:impostor:0:1|3:-1:cluster:ready:culled:8:-1:cluster:0:1|-1:0:impostor:ready:culled:8:-1:impostor:0:1|0:0:near:ready:culled:8:-1:near:0:1|1:0:near:ready:near:8:1|2:0:impostor:ready:impostor:8:1|3:0:impostor:ready:culled:8:-1:impostor:0:1|-1:1:impostor:ready:culled:8:-1:impostor:0:1|0:1:near:ready:proxy:5:-1:near:3:1|1:1:near:ready:culled:8:-1:near:0:1|2:1:impostor:ready:culled:8:-1:impostor:0:1|3:1:cluster:ready:culled:8:-1:cluster:0:1|-1:2:impostor:ready:culled:8:-1:impostor:0:1|0:2:impostor:ready:culled:8:-1:impostor:0:1|1:2:impostor:ready:culled:8:-1:impostor:0:1|2:2:impostor:ready:culled:8:-1:impostor:0:1|3:2:impostor:ready:culled:8:-1:impostor:0:1',
    entries: [
      {chunkX: -1, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: 96}},
      {chunkX: 0, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: 96}},
      {chunkX: 1, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: 96}},
      {chunkX: 2, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: 96}},
      {chunkX: 3, chunkZ: -2, chunkDistance: 2, band: 'cluster', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: 96}},
      {chunkX: -1, chunkZ: -1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: 32}},
      {chunkX: 0, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: 32}},
      {chunkX: 1, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: 32}},
      {chunkX: 2, chunkZ: -1, chunkDistance: 1, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: 32}},
      {chunkX: 3, chunkZ: -1, chunkDistance: 2, band: 'cluster', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: 32}},
      {chunkX: -1, chunkZ: 0, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -32}},
      {chunkX: 0, chunkZ: 0, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -32}},
      {chunkX: 1, chunkZ: 0, chunkDistance: 0, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -32}},
      {chunkX: 2, chunkZ: 0, chunkDistance: 1, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -32}},
      {chunkX: 3, chunkZ: 0, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -32}},
      {chunkX: -1, chunkZ: 1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -96}},
      {chunkX: 0, chunkZ: 1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'proxy', fade: 0.6666666666666667, ditherDirection: -1}, {band: 'near', fade: 0.3333333333333333, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -96}},
      {chunkX: 1, chunkZ: 1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -96}},
      {chunkX: 2, chunkZ: 1, chunkDistance: 1, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -96}},
      {chunkX: 3, chunkZ: 1, chunkDistance: 2, band: 'cluster', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -96}},
      {chunkX: -1, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -160}},
      {chunkX: 0, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -160}},
      {chunkX: 1, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -160}},
      {chunkX: 2, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -160}},
      {chunkX: 3, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -160}},
    ],
    states: [
      ['1:0', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['2:0', {from: 'impostor', target: 'impostor', startedAt: 0, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['0:1', {from: 'proxy', target: 'near', startedAt: 900, complete: false, representations: [{band: 'proxy', fade: 0.6666666666666667, ditherDirection: -1}, {band: 'near', fade: 0.3333333333333333, ditherDirection: 1}]}],
      ['3:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['9:9', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-1:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['0:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['1:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['2:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['3:-2', {from: 'culled', target: 'cluster', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}]}],
      ['-1:-1', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['0:-1', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['1:-1', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['2:-1', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['3:-1', {from: 'culled', target: 'cluster', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}]}],
      ['-1:0', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['0:0', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['3:0', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['-1:1', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['1:1', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['2:1', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['3:1', {from: 'culled', target: 'cluster', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}]}],
      ['-1:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['0:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['1:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['2:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
    ],
    transitions: [
      {chunkX: 3, chunkZ: 2, from: 'proxy', to: 'impostor', durationMs: 300},
    ],
  },
  {
    signature: '-1:-2:impostor:ready:culled:4:-1:impostor:4:1|0:-2:impostor:ready:culled:4:-1:impostor:4:1|1:-2:impostor:ready:culled:4:-1:impostor:4:1|2:-2:impostor:ready:culled:4:-1:impostor:4:1|3:-2:impostor:ready:cluster:8:-1:impostor:0:1|-1:-1:impostor:ready:culled:4:-1:impostor:4:1|0:-1:near:ready:culled:4:-1:near:4:1|1:-1:near:ready:culled:4:-1:near:4:1|2:-1:near:ready:impostor:8:-1:near:0:1|3:-1:impostor:ready:cluster:8:-1:impostor:0:1|-1:0:impostor:ready:culled:4:-1:impostor:4:1|0:0:near:ready:culled:4:-1:near:4:1|1:0:near:ready:near:8:1|2:0:near:ready:impostor:8:-1:near:0:1|3:0:impostor:ready:culled:4:-1:impostor:4:1|-1:1:impostor:ready:culled:4:-1:impostor:4:1|0:1:impostor:ready:near:8:-1:impostor:0:1|1:1:near:ready:culled:4:-1:near:4:1|2:1:impostor:ready:culled:4:-1:impostor:4:1|3:1:cluster:ready:culled:4:-1:cluster:4:1|-1:2:cluster:ready:impostor:8:-1:cluster:0:1|0:2:impostor:ready:culled:4:-1:impostor:4:1|1:2:impostor:ready:culled:4:-1:impostor:4:1|2:2:impostor:ready:culled:4:-1:impostor:4:1|3:2:impostor:ready:culled:4:-1:impostor:4:1',
    entries: [
      {chunkX: -1, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: 96}},
      {chunkX: 0, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: 96}},
      {chunkX: 1, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: 96}},
      {chunkX: 2, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: 96}},
      {chunkX: 3, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'cluster', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: 96}},
      {chunkX: -1, chunkZ: -1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: 32}},
      {chunkX: 0, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: 32}},
      {chunkX: 1, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: 32}},
      {chunkX: 2, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: 32}},
      {chunkX: 3, chunkZ: -1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'cluster', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: 32}},
      {chunkX: -1, chunkZ: 0, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -32}},
      {chunkX: 0, chunkZ: 0, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -32}},
      {chunkX: 1, chunkZ: 0, chunkDistance: 0, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -32}},
      {chunkX: 2, chunkZ: 0, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -32}},
      {chunkX: 3, chunkZ: 0, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -32}},
      {chunkX: -1, chunkZ: 1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -96}},
      {chunkX: 0, chunkZ: 1, chunkDistance: 1, band: 'impostor', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -96}},
      {chunkX: 1, chunkZ: 1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -96}},
      {chunkX: 2, chunkZ: 1, chunkDistance: 1, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -96}},
      {chunkX: 3, chunkZ: 1, chunkDistance: 2, band: 'cluster', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'cluster', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -96}},
      {chunkX: -1, chunkZ: 2, chunkDistance: 2, band: 'cluster', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -160}},
      {chunkX: 0, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -160}},
      {chunkX: 1, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -160}},
      {chunkX: 2, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -160}},
      {chunkX: 3, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -160}},
    ],
    states: [
      ['1:0', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['2:0', {from: 'impostor', target: 'near', startedAt: 1150, complete: false, representations: [{band: 'impostor', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['0:1', {from: 'near', target: 'impostor', startedAt: 1150, complete: false, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['3:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['9:9', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-1:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['0:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['1:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['2:-2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['3:-2', {from: 'cluster', target: 'impostor', startedAt: 1150, complete: false, representations: [{band: 'cluster', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['-1:-1', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['0:-1', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['1:-1', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['2:-1', {from: 'impostor', target: 'near', startedAt: 1150, complete: false, representations: [{band: 'impostor', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['3:-1', {from: 'cluster', target: 'impostor', startedAt: 1150, complete: false, representations: [{band: 'cluster', fade: 1, ditherDirection: -1}, {band: 'impostor', fade: 0, ditherDirection: 1}]}],
      ['-1:0', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['0:0', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['3:0', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['-1:1', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['1:1', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['2:1', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['3:1', {from: 'culled', target: 'cluster', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'cluster', fade: 0.5, ditherDirection: 1}]}],
      ['-1:2', {from: 'impostor', target: 'cluster', startedAt: 1150, complete: false, representations: [{band: 'impostor', fade: 1, ditherDirection: -1}, {band: 'cluster', fade: 0, ditherDirection: 1}]}],
      ['0:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['1:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
      ['2:2', {from: 'culled', target: 'impostor', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'impostor', fade: 0.5, ditherDirection: 1}]}],
    ],
    transitions: [
      {chunkX: 3, chunkZ: -2, from: 'cluster', to: 'impostor', durationMs: 300},
      {chunkX: 2, chunkZ: -1, from: 'impostor', to: 'near', durationMs: 300},
      {chunkX: 3, chunkZ: -1, from: 'cluster', to: 'impostor', durationMs: 300},
      {chunkX: 2, chunkZ: 0, from: 'impostor', to: 'near', durationMs: 300},
      {chunkX: 0, chunkZ: 1, from: 'near', to: 'impostor', durationMs: 300},
      {chunkX: -1, chunkZ: 2, from: 'impostor', to: 'cluster', durationMs: 300},
    ],
  },
  {
    signature: '-1:-2:impostor:ready:impostor:8:1|0:-2:impostor:ready:impostor:8:1|1:-2:impostor:ready:impostor:8:1|2:-2:impostor:ready:impostor:8:1|3:-2:impostor:ready:impostor:8:1|-1:-1:impostor:ready:impostor:8:1|0:-1:near:ready:near:8:1|1:-1:near:ready:near:8:1|2:-1:near:ready:near:8:1|3:-1:impostor:ready:impostor:8:1|-1:0:impostor:ready:impostor:8:1|0:0:near:ready:near:8:1|1:0:near:ready:near:8:1|2:0:near:ready:near:8:1|3:0:impostor:ready:impostor:8:1|-1:1:impostor:ready:impostor:8:1|0:1:impostor:ready:impostor:8:1|1:1:near:ready:near:8:1|2:1:impostor:ready:impostor:8:1|3:1:cluster:ready:cluster:8:1|-1:2:cluster:ready:cluster:8:1|0:2:impostor:ready:impostor:8:1|1:2:impostor:ready:impostor:8:1|2:2:impostor:ready:impostor:8:1|3:2:impostor:ready:impostor:8:1',
    entries: [
      {chunkX: -1, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: 96}},
      {chunkX: 0, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: 96}},
      {chunkX: 1, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: 96}},
      {chunkX: 2, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: 96}},
      {chunkX: 3, chunkZ: -2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: 96}},
      {chunkX: -1, chunkZ: -1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: 32}},
      {chunkX: 0, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: 32}},
      {chunkX: 1, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: 32}},
      {chunkX: 2, chunkZ: -1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: 32}},
      {chunkX: 3, chunkZ: -1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: 32}},
      {chunkX: -1, chunkZ: 0, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -32}},
      {chunkX: 0, chunkZ: 0, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -32}},
      {chunkX: 1, chunkZ: 0, chunkDistance: 0, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -32}},
      {chunkX: 2, chunkZ: 0, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -32}},
      {chunkX: 3, chunkZ: 0, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -32}},
      {chunkX: -1, chunkZ: 1, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -96}},
      {chunkX: 0, chunkZ: 1, chunkDistance: 1, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -96}},
      {chunkX: 1, chunkZ: 1, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -96}},
      {chunkX: 2, chunkZ: 1, chunkDistance: 1, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -96}},
      {chunkX: 3, chunkZ: 1, chunkDistance: 2, band: 'cluster', ready: true, representations: [{band: 'cluster', fade: 1, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -96}},
      {chunkX: -1, chunkZ: 2, chunkDistance: 2, band: 'cluster', ready: true, representations: [{band: 'cluster', fade: 1, ditherDirection: 1}], lodAnchor: {x: -32, y: 0, z: -160}},
      {chunkX: 0, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 32, y: 0, z: -160}},
      {chunkX: 1, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 96, y: 0, z: -160}},
      {chunkX: 2, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 160, y: 0, z: -160}},
      {chunkX: 3, chunkZ: 2, chunkDistance: 2, band: 'impostor', ready: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}], lodAnchor: {x: 224, y: 0, z: -160}},
    ],
    states: [
      ['1:0', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['2:0', {from: 'near', target: 'near', startedAt: 1150, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['0:1', {from: 'impostor', target: 'impostor', startedAt: 1150, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['3:2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['9:9', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-1:-2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['0:-2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['1:-2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['2:-2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['3:-2', {from: 'impostor', target: 'impostor', startedAt: 1150, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['-1:-1', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['0:-1', {from: 'near', target: 'near', startedAt: 1000, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['1:-1', {from: 'near', target: 'near', startedAt: 1000, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['2:-1', {from: 'near', target: 'near', startedAt: 1150, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['3:-1', {from: 'impostor', target: 'impostor', startedAt: 1150, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['-1:0', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['0:0', {from: 'near', target: 'near', startedAt: 1000, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['3:0', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['-1:1', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['1:1', {from: 'near', target: 'near', startedAt: 1000, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['2:1', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['3:1', {from: 'cluster', target: 'cluster', startedAt: 1000, complete: true, representations: [{band: 'cluster', fade: 1, ditherDirection: 1}]}],
      ['-1:2', {from: 'cluster', target: 'cluster', startedAt: 1150, complete: true, representations: [{band: 'cluster', fade: 1, ditherDirection: 1}]}],
      ['0:2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['1:2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
      ['2:2', {from: 'impostor', target: 'impostor', startedAt: 1000, complete: true, representations: [{band: 'impostor', fade: 1, ditherDirection: 1}]}],
    ],
    transitions: [
    ],
  },
];
const ANCHORED_RUNS = [
  {
    signature: '-5:2:proxy:ready:culled:4:-1:proxy:0:1|-4:2:proxy:ready:culled:4:-1:proxy:0:1|-3:2:proxy:ready:culled:4:-1:proxy:0:1|-2:2:proxy:ready:culled:4:-1:proxy:0:1|-1:2:culled:waiting:culled:4:1|-5:3:near:ready:culled:4:-1:near:0:1|-4:3:near:ready:culled:4:-1:near:0:1|-3:3:near:ready:culled:4:-1:near:0:1|-2:3:proxy:waiting:culled:4:-1:proxy:0:1|-1:3:culled:ready:culled:4:1|-5:4:near:ready:culled:4:-1:near:0:1|-4:4:near:ready:proxy:4:-1:near:0:1|-3:4:near:ready:culled:4:-1:near:0:1|-2:4:culled:ready:culled:4:1|-1:4:culled:ready:culled:4:1|-5:5:near:ready:culled:4:-1:near:0:1|-4:5:near:ready:culled:4:-1:near:0:1|-3:5:near:ready:near:4:1|-2:5:proxy:ready:culled:4:-1:proxy:0:1|-1:5:culled:ready:culled:4:1|-5:6:proxy:waiting:culled:4:-1:proxy:0:1|-4:6:proxy:ready:culled:4:-1:proxy:0:1|-3:6:proxy:ready:culled:4:-1:proxy:0:1|-2:6:culled:ready:culled:4:1|-1:6:culled:ready:culled:4:1',
    entries: [
      {chunkX: -5, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 0, z: -85}},
      {chunkX: -4, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -109, y: -0.5, z: -85}},
      {chunkX: -3, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -77, y: -0.5, z: -85}},
      {chunkX: -2, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -45, y: 0, z: -85}},
      {chunkX: -1, chunkZ: 2, chunkDistance: 2, band: 'culled', ready: false, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -16, y: 0, z: -80}},
      {chunkX: -5, chunkZ: 3, chunkDistance: 2, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 0.5, z: -117}},
      {chunkX: -4, chunkZ: 3, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -109, y: 0.5, z: -117}},
      {chunkX: -3, chunkZ: 3, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -77, y: 0, z: -117}},
      {chunkX: -2, chunkZ: 3, chunkDistance: 1, band: 'proxy', ready: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 2.220446049250313e-16, ditherDirection: 1}], lodAnchor: {x: -48, y: 0, z: -112}},
      {chunkX: -1, chunkZ: 3, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 0.5, z: -117}},
      {chunkX: -5, chunkZ: 4, chunkDistance: 2, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 1.5, z: -149}},
      {chunkX: -4, chunkZ: 4, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -109, y: 0, z: -149}},
      {chunkX: -3, chunkZ: 4, chunkDistance: 0, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -77, y: 1.5, z: -149}},
      {chunkX: -2, chunkZ: 4, chunkDistance: 1, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -45, y: 1.5, z: -149}},
      {chunkX: -1, chunkZ: 4, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 0, z: -149}},
      {chunkX: -5, chunkZ: 5, chunkDistance: 2, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 0, z: -181}},
      {chunkX: -4, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -109, y: 2.5, z: -181}},
      {chunkX: -3, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -77, y: 2.5, z: -181}},
      {chunkX: -2, chunkZ: 5, chunkDistance: 1, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -45, y: 0, z: -181}},
      {chunkX: -1, chunkZ: 5, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 2.5, z: -181}},
      {chunkX: -5, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 2.220446049250313e-16, ditherDirection: 1}], lodAnchor: {x: -144, y: 0, z: -208}},
      {chunkX: -4, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -109, y: 3.5, z: -213}},
      {chunkX: -3, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -77, y: 0, z: -213}},
      {chunkX: -2, chunkZ: 6, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -45, y: 3.5, z: -213}},
      {chunkX: -1, chunkZ: 6, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 3.5, z: -213}},
    ],
    states: [
      ['-4:4', {from: 'proxy', target: 'near', startedAt: 0, complete: false, representations: [{band: 'proxy', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-3:5', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-5:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-4:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-3:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-2:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-1:2', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-5:3', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-4:3', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-3:3', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-2:3', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, waitingForData: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 2.220446049250313e-16, ditherDirection: 1}]}],
      ['-1:3', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-5:4', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-3:4', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-2:4', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-1:4', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-5:5', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-4:5', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-2:5', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-1:5', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-5:6', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, waitingForData: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 2.220446049250313e-16, ditherDirection: 1}]}],
      ['-4:6', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-3:6', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-2:6', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-1:6', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
    ],
    transitions: [
      {chunkX: -5, chunkZ: 2, from: 'culled', to: 'proxy', durationMs: 220},
      {chunkX: -4, chunkZ: 4, from: 'proxy', to: 'near', durationMs: 220},
      {chunkX: -3, chunkZ: 5, from: 'proxy', to: 'near', durationMs: 220},
    ],
  },
  {
    signature: '-5:2:proxy:ready:culled:2:-1:proxy:2:1|-4:2:proxy:ready:culled:2:-1:proxy:2:1|-3:2:proxy:ready:culled:2:-1:proxy:2:1|-2:2:proxy:ready:culled:2:-1:proxy:2:1|-1:2:culled:ready:culled:4:1|-5:3:proxy:ready:near:4:-1:proxy:0:1|-4:3:near:ready:culled:2:-1:near:2:1|-3:3:near:ready:culled:2:-1:near:2:1|-2:3:near:waiting:culled:4:-1:near:0:1|-1:3:proxy:ready:culled:4:-1:proxy:0:1|-5:4:proxy:ready:near:4:-1:proxy:0:1|-4:4:near:ready:proxy:2:-1:near:2:1|-3:4:near:ready:culled:2:-1:near:2:1|-2:4:near:ready:culled:4:-1:near:0:1|-1:4:proxy:ready:culled:4:-1:proxy:0:1|-5:5:proxy:ready:near:4:-1:proxy:0:1|-4:5:near:ready:culled:2:-1:near:2:1|-3:5:near:ready:near:4:1|-2:5:near:ready:proxy:4:-1:near:0:1|-1:5:proxy:ready:culled:4:-1:proxy:0:1|-5:6:proxy:ready:culled:4:-1:proxy:0:1|-4:6:proxy:ready:culled:2:-1:proxy:2:1|-3:6:proxy:ready:culled:2:-1:proxy:2:1|-2:6:culled:ready:culled:4:1|-1:6:proxy:ready:culled:4:-1:proxy:0:1',
    entries: [
      {chunkX: -5, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -141, y: 0, z: -85}},
      {chunkX: -4, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -109, y: -0.5, z: -85}},
      {chunkX: -3, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -77, y: -0.5, z: -85}},
      {chunkX: -2, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -45, y: 0, z: -85}},
      {chunkX: -1, chunkZ: 2, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: -0.5, z: -85}},
      {chunkX: -5, chunkZ: 3, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 0.5, z: -117}},
      {chunkX: -4, chunkZ: 3, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -109, y: 0.5, z: -117}},
      {chunkX: -3, chunkZ: 3, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -77, y: 0, z: -117}},
      {chunkX: -2, chunkZ: 3, chunkDistance: 1, band: 'near', ready: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 2.220446049250313e-16, ditherDirection: 1}], lodAnchor: {x: -48, y: 0, z: -112}},
      {chunkX: -1, chunkZ: 3, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -13, y: 0.5, z: -117}},
      {chunkX: -5, chunkZ: 4, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 1.5, z: -149}},
      {chunkX: -4, chunkZ: 4, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'proxy', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -109, y: 0, z: -149}},
      {chunkX: -3, chunkZ: 4, chunkDistance: 0, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -77, y: 1.5, z: -149}},
      {chunkX: -2, chunkZ: 4, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -45, y: 1.5, z: -149}},
      {chunkX: -1, chunkZ: 4, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -13, y: 0, z: -149}},
      {chunkX: -5, chunkZ: 5, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 0, z: -181}},
      {chunkX: -4, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -109, y: 2.5, z: -181}},
      {chunkX: -3, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -77, y: 2.5, z: -181}},
      {chunkX: -2, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -45, y: 0, z: -181}},
      {chunkX: -1, chunkZ: 5, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -13, y: 2.5, z: -181}},
      {chunkX: -5, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -141, y: 3.5, z: -213}},
      {chunkX: -4, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -109, y: 3.5, z: -213}},
      {chunkX: -3, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}], lodAnchor: {x: -77, y: 0, z: -213}},
      {chunkX: -2, chunkZ: 6, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -45, y: 3.5, z: -213}},
      {chunkX: -1, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}], lodAnchor: {x: -13, y: 3.5, z: -213}},
    ],
    states: [
      ['-4:4', {from: 'proxy', target: 'near', startedAt: 0, complete: false, representations: [{band: 'proxy', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['-3:5', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-5:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}]}],
      ['-4:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}]}],
      ['-3:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}]}],
      ['-2:2', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}]}],
      ['-1:2', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-5:3', {from: 'near', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-4:3', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['-3:3', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['-2:3', {from: 'culled', target: 'near', startedAt: 110, complete: false, waitingForData: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 2.220446049250313e-16, ditherDirection: 1}]}],
      ['-1:3', {from: 'culled', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-5:4', {from: 'near', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-3:4', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['-2:4', {from: 'culled', target: 'near', startedAt: 110, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-1:4', {from: 'culled', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-5:5', {from: 'near', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'near', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-4:5', {from: 'culled', target: 'near', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'near', fade: 0.5, ditherDirection: 1}]}],
      ['-2:5', {from: 'proxy', target: 'near', startedAt: 110, complete: false, representations: [{band: 'proxy', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-1:5', {from: 'culled', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-5:6', {from: 'culled', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
      ['-4:6', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}]}],
      ['-3:6', {from: 'culled', target: 'proxy', startedAt: 0, complete: false, representations: [{band: 'culled', fade: 0.5, ditherDirection: -1}, {band: 'proxy', fade: 0.5, ditherDirection: 1}]}],
      ['-2:6', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-1:6', {from: 'culled', target: 'proxy', startedAt: 110, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'proxy', fade: 0, ditherDirection: 1}]}],
    ],
    transitions: [
      {chunkX: -5, chunkZ: 3, from: 'near', to: 'proxy', durationMs: 220},
      {chunkX: -2, chunkZ: 3, from: 'proxy', to: 'near', durationMs: 220},
      {chunkX: -1, chunkZ: 3, from: 'culled', to: 'proxy', durationMs: 220},
      {chunkX: -5, chunkZ: 4, from: 'near', to: 'proxy', durationMs: 220},
      {chunkX: -2, chunkZ: 4, from: 'culled', to: 'near', durationMs: 220},
      {chunkX: -1, chunkZ: 4, from: 'culled', to: 'proxy', durationMs: 220},
      {chunkX: -5, chunkZ: 5, from: 'near', to: 'proxy', durationMs: 220},
      {chunkX: -2, chunkZ: 5, from: 'proxy', to: 'near', durationMs: 220},
      {chunkX: -1, chunkZ: 5, from: 'culled', to: 'proxy', durationMs: 220},
      {chunkX: -1, chunkZ: 6, from: 'culled', to: 'proxy', durationMs: 220},
    ],
  },
  {
    signature: '-5:2:proxy:ready:proxy:4:1|-4:2:proxy:ready:proxy:4:1|-3:2:proxy:ready:proxy:4:1|-2:2:proxy:ready:proxy:4:1|-1:2:culled:ready:culled:4:1|-5:3:proxy:ready:proxy:4:1|-4:3:near:ready:near:4:1|-3:3:near:ready:near:4:1|-2:3:near:ready:culled:4:-1:near:0:1|-1:3:proxy:ready:proxy:4:1|-5:4:proxy:ready:proxy:4:1|-4:4:near:ready:near:4:1|-3:4:near:ready:near:4:1|-2:4:near:ready:near:4:1|-1:4:proxy:ready:proxy:4:1|-5:5:proxy:ready:proxy:4:1|-4:5:near:ready:near:4:1|-3:5:near:ready:near:4:1|-2:5:near:ready:near:4:1|-1:5:proxy:ready:proxy:4:1|-5:6:proxy:ready:proxy:4:1|-4:6:proxy:ready:proxy:4:1|-3:6:proxy:ready:proxy:4:1|-2:6:culled:ready:culled:4:1|-1:6:proxy:ready:proxy:4:1',
    entries: [
      {chunkX: -5, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -141, y: 0, z: -85}},
      {chunkX: -4, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -109, y: -0.5, z: -85}},
      {chunkX: -3, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -77, y: -0.5, z: -85}},
      {chunkX: -2, chunkZ: 2, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -45, y: 0, z: -85}},
      {chunkX: -1, chunkZ: 2, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: -0.5, z: -85}},
      {chunkX: -5, chunkZ: 3, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -141, y: 0.5, z: -117}},
      {chunkX: -4, chunkZ: 3, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -109, y: 0.5, z: -117}},
      {chunkX: -3, chunkZ: 3, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -77, y: 0, z: -117}},
      {chunkX: -2, chunkZ: 3, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}], lodAnchor: {x: -45, y: 0.5, z: -117}},
      {chunkX: -1, chunkZ: 3, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 0.5, z: -117}},
      {chunkX: -5, chunkZ: 4, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -141, y: 1.5, z: -149}},
      {chunkX: -4, chunkZ: 4, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -109, y: 0, z: -149}},
      {chunkX: -3, chunkZ: 4, chunkDistance: 0, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -77, y: 1.5, z: -149}},
      {chunkX: -2, chunkZ: 4, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -45, y: 1.5, z: -149}},
      {chunkX: -1, chunkZ: 4, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 0, z: -149}},
      {chunkX: -5, chunkZ: 5, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -141, y: 0, z: -181}},
      {chunkX: -4, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -109, y: 2.5, z: -181}},
      {chunkX: -3, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -77, y: 2.5, z: -181}},
      {chunkX: -2, chunkZ: 5, chunkDistance: 1, band: 'near', ready: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}], lodAnchor: {x: -45, y: 0, z: -181}},
      {chunkX: -1, chunkZ: 5, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 2.5, z: -181}},
      {chunkX: -5, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -141, y: 3.5, z: -213}},
      {chunkX: -4, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -109, y: 3.5, z: -213}},
      {chunkX: -3, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -77, y: 0, z: -213}},
      {chunkX: -2, chunkZ: 6, chunkDistance: 2, band: 'culled', ready: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}], lodAnchor: {x: -45, y: 3.5, z: -213}},
      {chunkX: -1, chunkZ: 6, chunkDistance: 2, band: 'proxy', ready: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}], lodAnchor: {x: -13, y: 3.5, z: -213}},
    ],
    states: [
      ['-4:4', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-3:5', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-5:2', {from: 'proxy', target: 'proxy', startedAt: 0, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-4:2', {from: 'proxy', target: 'proxy', startedAt: 0, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-3:2', {from: 'proxy', target: 'proxy', startedAt: 0, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-2:2', {from: 'proxy', target: 'proxy', startedAt: 0, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-1:2', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-5:3', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-4:3', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-3:3', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-2:3', {from: 'culled', target: 'near', startedAt: 1000, complete: false, representations: [{band: 'culled', fade: 1, ditherDirection: -1}, {band: 'near', fade: 0, ditherDirection: 1}]}],
      ['-1:3', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-5:4', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-3:4', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-2:4', {from: 'near', target: 'near', startedAt: 110, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-1:4', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-5:5', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-4:5', {from: 'near', target: 'near', startedAt: 0, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-2:5', {from: 'near', target: 'near', startedAt: 110, complete: true, representations: [{band: 'near', fade: 1, ditherDirection: 1}]}],
      ['-1:5', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-5:6', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-4:6', {from: 'proxy', target: 'proxy', startedAt: 0, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-3:6', {from: 'proxy', target: 'proxy', startedAt: 0, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
      ['-2:6', {from: 'culled', target: 'culled', startedAt: 0, complete: true, representations: [{band: 'culled', fade: 1, ditherDirection: 1}]}],
      ['-1:6', {from: 'proxy', target: 'proxy', startedAt: 110, complete: true, representations: [{band: 'proxy', fade: 1, ditherDirection: 1}]}],
    ],
    transitions: [
    ],
  },
];

test('tree-like plans keep their recorded entries, states, transitions and signatures', () => {
  assert.deepEqual(treeLikeRuns(), TREE_LIKE_RUNS);
});

test('anchored plans keep their recorded entries, states, transitions and signatures', () => {
  assert.deepEqual(anchoredRuns(), ANCHORED_RUNS);
});

test('pruneStateMap keeps exactly the planned chunk keys, in their order', () => {
  const states = new Map([['0:0', 1], ['5:5', 2], ['-1:2', 3], ['1:-1', 4]]);
  pruneStateMap(states, [{ chunkX: 0, chunkZ: 0 }, { chunkX: 1, chunkZ: -1 }, { chunkX: 7, chunkZ: 7 }]);
  assert.deepEqual([...states.keys()], ['0:0', '1:-1']);
});
