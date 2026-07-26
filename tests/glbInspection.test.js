import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectGlbJson } from '../scripts/lib/glb-inspection.mjs';

test('GLB inspection measures logical buffers, world bounds, and material triangles', () => {
  const stats = inspectGlbJson({
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{
      mesh: 0,
      translation: [10, 2, -3],
      scale: [2, 3, 4],
    }],
    meshes: [{
      primitives: [{
        indices: 1,
        attributes: { POSITION: 0 },
        material: 0,
      }],
    }],
    materials: [{ name: 'stone' }],
    accessors: [
      {
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-1, 0, -2],
        max: [1, 2, 2],
      },
      {
        componentType: 5123,
        count: 6,
        type: 'SCALAR',
      },
    ],
  });

  assert.equal(stats.logicalVertexBytes, 48);
  assert.equal(stats.logicalIndexBytes, 12);
  assert.equal(stats.logicalAccessorBytes, 60);
  assert.equal(stats.drawParts, 1);
  assert.deepEqual(stats.materialTriangleCounts, { stone: 2 });
  assert.deepEqual(stats.sceneBounds, {
    min: [8, 2, -11],
    max: [12, 8, 5],
  });
});
