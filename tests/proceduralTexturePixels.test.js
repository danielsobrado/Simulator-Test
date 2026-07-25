import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SURFACE_KINDS,
  SURFACE_PROPERTIES,
  createSurfaceTexturePixels,
  sampleSurface,
} from '../src/editor/assets/proceduralTexturePixels.js';

const SIZE = 32;

test('every surface kind has complete shading metadata', () => {
  assert.ok(SURFACE_KINDS.length >= 20);
  for (const kind of SURFACE_KINDS) {
    const properties = SURFACE_PROPERTIES[kind];
    assert.ok(properties, `${kind} is missing surface properties`);
    assert.match(properties.color, /^#[0-9a-f]{6}$/i, `${kind} has an invalid colour`);
    assert.ok(properties.metalness >= 0 && properties.metalness <= 1, `${kind} metalness out of range`);
    assert.ok(properties.density > 0, `${kind} needs a positive texel density`);
    assert.ok(Number.isFinite(properties.relief), `${kind} needs a relief strength`);
  }
});

test('generated pixels are fully populated and opaque', () => {
  for (const kind of SURFACE_KINDS) {
    const pixels = createSurfaceTexturePixels(kind, { size: SIZE });

    assert.equal(pixels.size, SIZE);
    for (const channelName of ['color', 'normal', 'roughness']) {
      const channel = pixels[channelName];
      assert.ok(channel instanceof Uint8Array, `${kind} ${channelName} must be bytes`);
      assert.equal(channel.length, SIZE * SIZE * 4);
      for (let offset = 3; offset < channel.length; offset += 4) {
        assert.equal(channel[offset], 255, `${kind} ${channelName} must be opaque`);
      }
    }
  }
});

test('surfaces are exactly periodic over one UV tile so textures never seam', () => {
  for (const kind of SURFACE_KINDS) {
    for (let step = 0; step < 24; step += 1) {
      const u = step * 0.0237 + 0.013;
      const v = step * 0.0411 + 0.007;
      const base = sampleSurface(kind, u, v);

      for (const [deltaU, deltaV] of [[1, 0], [0, 1], [1, 1], [-2, 3]]) {
        const shifted = sampleSurface(kind, u + deltaU, v + deltaV);
        for (let channel = 0; channel < base.length; channel += 1) {
          assert.ok(
            Math.abs(base[channel] - shifted[channel]) < 1e-9,
            `${kind} is not periodic across the tile boundary`,
          );
        }
      }
    }
  }
});

test('generation is deterministic and seed controlled', () => {
  const first = createSurfaceTexturePixels('plaster', { size: SIZE });
  const second = createSurfaceTexturePixels('plaster', { size: SIZE });
  assert.deepEqual(Array.from(first.color), Array.from(second.color));
  assert.deepEqual(Array.from(first.normal), Array.from(second.normal));

  const reseeded = createSurfaceTexturePixels('plaster', { size: SIZE, seed: 4242 });
  assert.notDeepEqual(Array.from(reseeded.color), Array.from(first.color));
});

test('normal maps stay unit length in tangent space', () => {
  const pixels = createSurfaceTexturePixels('stoneBlock', { size: SIZE });
  for (let offset = 0; offset < pixels.normal.length; offset += 4) {
    const x = (pixels.normal[offset] / 255) * 2 - 1;
    const y = (pixels.normal[offset + 1] / 255) * 2 - 1;
    const z = (pixels.normal[offset + 2] / 255) * 2 - 1;
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 0.02, 'normal is not unit length');
    assert.ok(z > 0, 'tangent-space normals must point out of the surface');
  }
});

test('unknown surface kinds and sizes fail closed', () => {
  assert.throws(() => createSurfaceTexturePixels('marzipan'), /Unknown procedural surface kind/);
  assert.throws(() => sampleSurface('marzipan', 0, 0), /Unknown procedural surface kind/);
  assert.throws(() => createSurfaceTexturePixels('plaster', { size: 3 }), /at least 4/);
  assert.throws(() => createSurfaceTexturePixels('plaster', { size: 12.5 }), /integer/);
});
