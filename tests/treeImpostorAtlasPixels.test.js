import assert from 'node:assert/strict';
import test from 'node:test';
import { createDilatedAtlasTile } from '../src/editor/stylized/impostor/TreeImpostorAtlasPixels.js';

function pixel(data, size, x, y) {
  const offset = (y * size + x) * 4;
  return [...data.slice(offset, offset + 4)];
}

test('atlas dilation fills gutter RGB without expanding coverage alpha', () => {
  const source = new Uint8ClampedArray([10, 20, 30, 255]);
  const tile = createDilatedAtlasTile(source, 1, 3, 1);

  assert.deepEqual(pixel(tile, 3, 1, 1), [10, 20, 30, 255]);
  assert.deepEqual(pixel(tile, 3, 0, 0), [10, 20, 30, 0]);
});

test('normal dilation uses albedo coverage when trunk mask alpha is zero', () => {
  const normal = new Uint8ClampedArray([128, 128, 255, 0]);
  const albedo = new Uint8ClampedArray([80, 60, 40, 255]);
  const tile = createDilatedAtlasTile(normal, 1, 3, 1, {
    coveragePixels: albedo,
    alphaPixels: normal,
  });

  assert.deepEqual(pixel(tile, 3, 1, 1), [128, 128, 255, 0]);
  assert.deepEqual(pixel(tile, 3, 0, 0), [128, 128, 255, 0]);
});

test('foliage mask alpha remains inside the rendered tile', () => {
  const normal = new Uint8ClampedArray([128, 255, 128, 255]);
  const albedo = new Uint8ClampedArray([40, 90, 40, 255]);
  const tile = createDilatedAtlasTile(normal, 1, 3, 1, {
    coveragePixels: albedo,
    alphaPixels: normal,
  });

  assert.equal(pixel(tile, 3, 1, 1)[3], 255);
  assert.equal(pixel(tile, 3, 0, 0)[3], 0);
});
