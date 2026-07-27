import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWaterField,
  decodeWaterFlowComponent,
  encodeWaterFlowComponent,
  enrichPageWaterField,
} from '../src/editor/water/WaterField.js';

function riverSample(x, z) {
  const length = Math.hypot(3, 4);
  return {
    coverage: 1,
    surfaceHeight: 10 - z * 0.01,
    bedHeight: 8,
    depth: 2 - z * 0.01,
    shoreDistance: 2,
    flowX: 3 / length,
    flowZ: 4 / length,
  };
}

function flowAt(field, x, z) {
  const index = (z * field.width + x) * 2;
  return {
    x: decodeWaterFlowComponent(field.flowPixels[index]),
    z: decodeWaterFlowComponent(field.flowPixels[index + 1]),
  };
}

test('flow components round-trip through the compact texture encoding', () => {
  for (const value of [-1, -0.75, 0, 0.42, 1]) {
    const decoded = decodeWaterFlowComponent(encodeWaterFlowComponent(value));
    assert.ok(Math.abs(decoded - value) <= 1 / 127);
  }
});

test('water fields preserve current direction and shared chunk edges', () => {
  const left = createWaterField({ originX: 0, originZ: 0, chunkSize: 2, sampleWater: riverSample });
  const right = createWaterField({ originX: 2, originZ: 0, chunkSize: 2, sampleWater: riverSample });
  assert.equal(left.flowPixels.length, left.width * left.height * 2);

  const centre = flowAt(left, 1, 1);
  assert.ok(Math.abs(centre.x - 0.6) <= 1 / 127);
  assert.ok(Math.abs(centre.z - 0.8) <= 1 / 127);

  for (let z = 0; z < left.height; z += 1) {
    assert.deepEqual(flowAt(left, left.width - 1, z), flowAt(right, 0, z));
  }
});

test('page enrichment creates current fields when an older page has none', () => {
  const page = {
    originX: 0,
    originZ: 0,
    tiles: new Uint8Array(4),
    heights: new Float32Array(9),
    waterFieldPixels: new Uint16Array(1),
  };
  enrichPageWaterField(page, riverSample);
  assert.equal(page.waterFlowWidth, 3);
  assert.equal(page.waterFlowHeight, 3);
  assert.equal(page.waterFlowPixels.length, 18);
  assert.equal(page.waterFieldRevision, 1);
});
