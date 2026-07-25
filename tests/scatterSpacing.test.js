import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStableChunkManifest } from '../src/editor/stylized/StableScatterManifest.js';
import { aggregateCanopyClusters } from '../src/editor/stylized/lod/canopyCluster.js';

/**
 * Reference Matérn-II acceptance: every candidate loses to any overlapping
 * candidate with a lower (priority, stableId) order. Deliberately brute force —
 * the production path uses a bucket index and must agree with this exactly.
 */
function referenceAccepted(candidates, maxAccepted, chunkX, chunkZ) {
  const byOwner = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.ownerChunkX}:${candidate.ownerChunkZ}`;
    const owned = byOwner.get(key) ?? [];
    owned.push(candidate);
    byOwner.set(key, owned);
  }
  const order = (left, right) => (
    left.priority - right.priority || left.stableId.localeCompare(right.stableId)
  );
  const authoritative = [...byOwner.values()]
    .flatMap((owned) => [...owned].sort(order).slice(0, maxAccepted));
  return authoritative
    .filter((candidate) => !authoritative.some((other) => {
      if (other === candidate || order(other, candidate) >= 0) return false;
      const deltaX = candidate.x - other.x;
      const deltaZ = candidate.z - other.z;
      const clear = candidate.radius + other.radius;
      return deltaX * deltaX + deltaZ * deltaZ < clear * clear;
    }))
    .filter((candidate) => (
      candidate.ownerChunkX === chunkX && candidate.ownerChunkZ === chunkZ
    ))
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.stableId);
}

function run({ perChunk, maxAccepted, clearRadius }) {
  const seen = [];
  const placements = buildStableChunkManifest({
    kind: 'tree',
    chunkX: 3,
    chunkZ: -2,
    chunkSize: 32,
    tileSize: 2,
    perChunk,
    maxAccepted,
    tileIds: [6],
    tileAt: () => 6,
    heightAt: (x, z) => Math.sin(x * 0.05) * 3 + Math.cos(z * 0.04) * 2,
    prototypeCount: 4,
    minScale: 0.8,
    maxScale: 1.4,
    radiusForScale: (scale) => clearRadius * scale,
    candidateEvaluator: (candidate) => {
      seen.push(candidate);
      return true;
    },
  });
  return {
    actual: placements.map((placement) => placement.stableId),
    expected: referenceAccepted(seen, maxAccepted, 3, -2),
    placements,
  };
}

test('bucket-indexed spacing accepts exactly the brute-force Matérn-II set', () => {
  for (const clearRadius of [0, 1.5, 3.5, 9]) {
    for (const { perChunk, maxAccepted } of [
      { perChunk: 24, maxAccepted: 12 },
      { perChunk: 96, maxAccepted: 48 },
      { perChunk: 192, maxAccepted: 192 },
    ]) {
      const { actual, expected } = run({ perChunk, maxAccepted, clearRadius });
      assert.deepEqual(
        actual,
        expected,
        `radius=${clearRadius} perChunk=${perChunk} maxAccepted=${maxAccepted}`,
      );
    }
  }
});

test('accepted placements never overlap each other', () => {
  const { placements } = run({ perChunk: 192, maxAccepted: 192, clearRadius: 3.5 });
  assert.ok(placements.length > 1);
  for (const left of placements) {
    for (const right of placements) {
      if (left === right) continue;
      const distance = Math.hypot(left.x - right.x, left.z - right.z);
      assert.ok(
        distance >= left.radius + right.radius,
        `${left.stableId} overlaps ${right.stableId}`,
      );
    }
  }
});

test('bucketed canopy components match a brute-force flood fill', () => {
  const placements = Array.from({ length: 220 }, (_, index) => {
    const angle = index * 2.399963;
    const radius = Math.sqrt(index) * 4.5;
    return {
      stableId: `tree:${index}`,
      patchId: `patch-${index % 3}`,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      height: 0,
      scale: 1,
      spacingRadius: 2 + (index % 5) * 0.4,
    };
  });

  const gap = 2;
  const byId = new Map(placements.map((placement) => [placement.stableId, placement]));
  const brute = new Map();
  for (const [patchId] of new Map(placements.map((p) => [p.patchId, true]))) {
    const group = placements.filter((placement) => placement.patchId === patchId);
    const remaining = new Set(group);
    const components = [];
    for (const seed of group) {
      if (!remaining.has(seed)) continue;
      remaining.delete(seed);
      const component = [seed];
      for (let cursor = 0; cursor < component.length; cursor += 1) {
        for (const candidate of [...remaining]) {
          const reach = component[cursor].spacingRadius + candidate.spacingRadius + gap;
          const distance = Math.hypot(
            component[cursor].x - candidate.x,
            component[cursor].z - candidate.z,
          );
          if (distance <= reach) {
            remaining.delete(candidate);
            component.push(candidate);
          }
        }
      }
      components.push(new Set(component.map((placement) => placement.stableId)));
    }
    brute.set(patchId, components);
  }

  const clusters = aggregateCanopyClusters({
    chunkX: 0,
    chunkZ: 0,
    placements,
    connectionGap: gap,
  });
  // Every cluster's members must fall inside one brute-force component.
  const componentCounts = new Map();
  for (const cluster of clusters) {
    const key = `${cluster.patchId}:${cluster.componentIndex}`;
    componentCounts.set(key, (componentCounts.get(key) ?? 0) + cluster.count);
  }
  for (const [patchId, components] of brute) {
    const seen = [...componentCounts.entries()]
      .filter(([key]) => key.startsWith(`${patchId}:`))
      .map(([, count]) => count)
      .sort((left, right) => left - right);
    const expected = components.map((component) => component.size)
      .sort((left, right) => left - right);
    assert.deepEqual(seen, expected, `patch ${patchId} component sizes`);
  }
  assert.ok(byId.size === placements.length);
});

test('acceptance is independent of the candidate halo width', () => {
  const forHalo = (haloChunks) => buildStableChunkManifest({
    kind: 'rock',
    chunkX: 0,
    chunkZ: 0,
    chunkSize: 32,
    tileSize: 2,
    perChunk: 64,
    haloChunks,
    tileIds: [6],
    tileAt: () => 6,
    heightAt: () => 0,
    prototypeCount: 2,
    minScale: 1,
    maxScale: 1,
    radiusForScale: () => 2.5,
  }).map((placement) => placement.stableId);
  assert.deepEqual(forHalo(2), forHalo(1));
});
