import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFlowerScatter,
  buildGrassScatter,
  compactGrassScatter,
  createVegetationScatterConfig,
  enrichPageVegetationScatter,
} from '../src/editor/stylized/vegetationScatter.js';
import { markAttributeRangeUpdated } from '../src/editor/stylized/attributeUpload.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';
import { grassClumpCellOffset } from '../src/editor/stylized/scatterMath.js';

function makePage({ chunkSize = 4, tileId = 3 } = {}) {
  const tiles = new Uint8Array(chunkSize * chunkSize).fill(tileId);
  const vertexSize = chunkSize + 1;
  const heights = new Float32Array(vertexSize * vertexSize);
  for (let i = 0; i < heights.length; i += 1) heights[i] = 1 + (i % 3) * 0.1;
  return {
    chunkX: 2,
    chunkZ: -1,
    tiles,
    heights,
  };
}

test('createVegetationScatterConfig snapshots grass/flower fields', () => {
  const config = createVegetationScatterConfig({
    enabled: true,
    grass: {
      bladesPerCell: 8,
      bladesPerClump: 4,
      tileIds: [3, 4],
      minWidth: 0.1,
      maxWidth: 0.2,
      minLength: 0.3,
      maxLength: 0.4,
    },
    flowers: {
      enabled: true,
      perChunk: 12,
      tileIds: [3],
      minSize: 0.5,
      maxSize: 0.6,
    },
  }, 2);
  assert.equal(config.tileSize, 2);
  assert.equal(config.grass.clumpsPerCell, 2);
  assert.equal(config.flowers.perChunk, 12);
});

test('buildGrassScatter is deterministic and compactable', () => {
  const page = makePage();
  const scatter = buildGrassScatter({
    page,
    chunkSize: 4,
    tileSize: 2,
    clumpsPerCell: 2,
    tileIds: [3],
    minWidth: 0.1,
    maxWidth: 0.1,
    minLength: 0.2,
    maxLength: 0.2,
  });
  assert.equal(scatter.count, 4 * 4 * 2);
  const again = buildGrassScatter({
    page,
    chunkSize: 4,
    tileSize: 2,
    clumpsPerCell: 2,
    tileIds: [3],
    minWidth: 0.1,
    maxWidth: 0.1,
    minLength: 0.2,
    maxLength: 0.2,
  });
  assert.deepEqual([...scatter.base], [...again.base]);

  const compact = compactGrassScatter(scatter, 1, 4);
  assert.equal(compact.count, 4 * 4);
  assert.equal(compact.clumpsPerCell, 1);
  assert.equal(compact.base[0], scatter.base[0]);
  assert.equal(compact.base[3], scatter.base[6]);
});

test('grass clump prefixes stay distributed inside a cell', () => {
  const points = Array.from({ length: 6 }, (_, index) => (
    grassClumpCellOffset(2, -1, 7, index)
  ));
  assert.equal(new Set(points.map((point) => point.x.toFixed(4))).size, points.length);
  assert.equal(new Set(points.map((point) => point.z.toFixed(4))).size, points.length);
  assert.ok(Math.max(...points.map((point) => point.x))
    - Math.min(...points.map((point) => point.x)) > 0.55);
  assert.ok(Math.max(...points.map((point) => point.z))
    - Math.min(...points.map((point) => point.z)) > 0.55);
});

test('buildFlowerScatter and enrichPageVegetationScatter attach buffers', () => {
  const page = makePage();
  const flowers = buildFlowerScatter({
    page,
    chunkSize: 4,
    tileSize: 2,
    sampleLimit: 8,
    tileIds: [3],
    minSize: 0.4,
    maxSize: 0.5,
  });
  assert.ok(flowers.count > 0);
  assert.ok(flowers.count <= 8);

  enrichPageVegetationScatter(page, {
    tileSize: 2,
    grass: {
      enabled: true,
      clumpsPerCell: 1,
      tileIds: [3],
      minWidth: 0.1,
      maxWidth: 0.1,
      minLength: 0.2,
      maxLength: 0.2,
    },
    flowers: {
      enabled: true,
      perChunk: 5,
      tileIds: [3],
      minSize: 0.4,
      maxSize: 0.5,
    },
  });
  assert.ok(page.grassScatter?.count > 0);
  assert.ok(page.flowerScatter?.count >= 0);
  assert.ok(Number.isFinite(page.timings.grassScatterMs));
});

test('markAttributeRangeUpdated records a partial upload range', () => {
  PerfCounters.reset();
  const attribute = {
    itemSize: 3,
    array: new Float32Array(30),
    updateRanges: [],
    needsUpdate: false,
    clearUpdateRanges() {
      this.updateRanges.length = 0;
    },
    addUpdateRange(start, count) {
      this.updateRanges.push({ start, count });
    },
  };
  const bytes = markAttributeRangeUpdated(attribute, 4);
  assert.equal(bytes, 4 * 3 * 4);
  assert.equal(attribute.needsUpdate, true);
  assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 12 }]);
  assert.equal(PerfCounters.get('attributeBytesUploaded'), bytes);
});
