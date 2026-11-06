import { RockManifestStore } from '../src/editor/stylized/RockManifestStore.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedRockView } from '../src/editor/stylized/StylizedRockView.js';
import { StylizedSurfaceView as StylizedSurfaceViewBase } from '../src/editor/stylized/StylizedSurfaceViewBase.js';
import { CollisionResidency } from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_BUILD_DEFERRED } from '../src/editor/collision/CollisionBuildResult.js';
import { setUnderwaterBlend } from '../src/editor/water/underwaterState.js';

function rockHarness() {
  const rocks = Object.create(StylizedRockView.prototype);
  rocks.prototypes = [{}];
  rocks.terrainView = { focusChunk: { chunkX: 0, chunkZ: 0 } };
  rocks.placementsByChunk = new Map();
  rocks.blockerRequests = new Set();
  rocks.pendingManifestBuilds = new Map();
  rocks.manifestBuildsThisFrame = 1;
  rocks.manifestFrameStartedAt = performance.now() - 1000;
  rocks.manifestBuildBudgetMs = 100;
  rocks.manifestKey = (x, z) => `key:${x}:${z}`;
  rocks.manifestOptions = (chunkX, chunkZ) => ({
    kind: 'frame-progress', chunkX, chunkZ, chunkSize: 1, tileSize: 1,
    perChunk: 1, tileIds: new Set([1]), tileAt: () => 1, heightAt: () => 0,
    prototypeCount: 1, minScale: 1, maxScale: 1, radiusForScale: () => 0,
  });
  rocks.riverbankRocksForChunk = rocks.coastStonesForChunk = rocks.seabedRocksForChunk
    = rocks.formationRocksForChunk = function* () { return []; };
  // This harness isolates queue ownership; surface fitting has separate tests.
  rocks.resolveGroundPlacements = function* (placements) { yield; return placements; };
  rocks.manifestStore = new RockManifestStore(rocks);
  rocks.manifestStore.queue.buildsPerFrame = 1;
  const surface = Object.create(StylizedSurfaceViewBase.prototype);
  surface.rockView = rocks;
  surface.enabled = true;
  surface.waterSlots = [];
  surface.updateRendererCounters = () => {};
  return { rocks, surface, manifests: rocks.manifestStore.cache };
}

test('collision halo progresses before rendering, including when land rendering is suspended', (t) => {
  const { rocks, surface, manifests } = rockHarness();
  setUnderwaterBlend(1);
  t.after(() => setUnderwaterBlend(0));
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const residency = new CollisionResidency({
    world,
    config: { residentRadius: 0, unloadRadius: 1, prefetchSeconds: 0.5,
      buildsPerFrame: 1, buildBudgetMs: 100 },
    buildOwnerChunk: (x, z) => rocks.getPreparedBlockersForChunk(x, z)
      ? { revision: 1, colliders: [] } : COLLISION_BUILD_DEFERRED,
  });
  for (let frame = 1; frame <= 9; frame++) {
    rocks.getPreparedBlockersForChunk(0, 0);
    // Requests precede the next budgeted preparation tick.
    surface.beginFrame(frame);
    residency.update({ focus: { x: 1, z: -1 } });
    residency.flush();
    assert.equal(manifests.size, frame, 'collision must advance one cold halo manifest each frame');
    // A second frame entry in a layer must share the consumed allowance.
    surface.update(frame, null);
    assert.equal(rocks.prepareManifestForChunk(30, 30), null);
    assert.equal(manifests.size, frame, "read-only requests do not advance work");
  }
  assert.equal(world.isOwnerChunkReady(0, 0), true);
  assert.equal(residency.getStatus().queuedBuilds, 0);
});

test('interleaved collision and render requests retain both incremental rock builders', () => {
  const { rocks, manifests } = rockHarness();
  const slices = new Map();
  for (const key of ['-1:-1', '-4:-4']) {
    const [x, z] = key.split(':').map(Number);
    const build = { key: rocks.manifestKey(x, z), cacheKey: key, builder: {
      step() {
        const count = (slices.get(key) ?? 0) + 1;
        slices.set(key, count);
        return count < 3 ? null : [{ stableId: key }];
      },
    } };
    rocks.manifestStore.pending.set(key, { ...build, stage: 0, placements: [], startedAt: performance.now() });
  }
  for (let frame = 0; frame < 6; frame++) {
    rocks.manifestBuildsThisFrame = 0;
    rocks.manifestFrameStartedAt = performance.now();
    const chunk = frame % 2 === 0 ? -1 : -4;
    const key = `${chunk}:${chunk}`;
    rocks.manifestStore.step({ key, chunkX: chunk, chunkZ: chunk }, () => false);
  }
  assert.deepEqual([...slices.values()], [3, 3]);
  assert.equal(manifests.size, 2);
  assert.equal(rocks.manifestStore.pending.size, 0);
});
