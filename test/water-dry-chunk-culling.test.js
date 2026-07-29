import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createWaterField, waterFieldHasCoverage } from '../src/editor/water/WaterField.js';

const WATER_FIELD_CHANNELS = 4;

function fieldFor(coverageAt) {
  return createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 4,
    sampleWater: (x, z) => {
      const coverage = coverageAt(x, z);
      return {
        coverage,
        surfaceHeight: coverage > 0 ? 2 : 0,
        bedHeight: 0,
        depth: coverage > 0 ? 2 : 0,
        flowX: 0,
        flowZ: 0,
        shoreDistance: coverage > 0 ? 0 : 8,
      };
    },
  });
}

test('a field with no covered vertex reads as dry', () => {
  const field = fieldFor(() => 0);
  assert.equal(waterFieldHasCoverage(field.pixels), false);
});

test('a single covered vertex is enough to read as wet', () => {
  const field = fieldFor((x, z) => (x === 2 && z === 2 ? 1 : 0));
  assert.equal(waterFieldHasCoverage(field.pixels), true);
});

test('partial coverage on a shoreline reads as wet', () => {
  const field = fieldFor((x) => (x >= 3 ? 0.25 : 0));
  assert.equal(waterFieldHasCoverage(field.pixels), true);
});

test('coverage is read from channel 0 only', () => {
  // Depth, surface height and shore distance are non-zero on a dry chunk, so a
  // predicate that scanned every channel would call this field wet.
  const field = fieldFor(() => 0);
  const nonZeroChannels = field.pixels.some(
    (value, index) => index % WATER_FIELD_CHANNELS !== 0 && value !== 0,
  );
  assert.equal(nonZeroChannels, true);
  assert.equal(waterFieldHasCoverage(field.pixels), false);
});

test('an encoded negative zero still reads as dry', () => {
  const pixels = new Uint16Array(WATER_FIELD_CHANNELS);
  pixels[0] = 0x8000;
  assert.equal(waterFieldHasCoverage(pixels), false);
});

test('a missing field reads as dry rather than throwing', () => {
  assert.equal(waterFieldHasCoverage(null), false);
  assert.equal(waterFieldHasCoverage(undefined), false);
});

test('refraction is a build-time branch so a far material never carries the nodes', async () => {
  const source = await readFile(
    new URL('../src/editor/stylized/StylizedWaterMaterial.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /enableRefraction = true,/);
  assert.match(source, /if \(enableRefraction && quality\.refraction && water\.refraction\.enabled\)/);
  // The viewport nodes must sit inside that branch — hoisting them out would
  // reintroduce the whole-frame copy for every chunk regardless of the flag.
  const branch = source.match(
    /if \(enableRefraction && quality\.refraction[\s\S]*?\n {2}\}/,
  )?.[0] ?? '';
  assert.match(branch, /viewportDepthTexture/);
  assert.match(branch, /viewportOpaqueMipTexture/);
});

test('the slot only builds the refractive variant for chunks near the viewer', async () => {
  const source = await readFile(
    new URL('../src/editor/stylized/StylizedWaterSlot.js', import.meta.url),
    'utf8',
  );
  // The plain variant is the one built up front; the refractive one is lazy, so
  // a session that never approaches water never creates it.
  assert.match(source, /this\.material = this\.createMaterial\(false\);/);
  assert.match(source, /this\.refractiveMaterial = null;/);
  const resolve = source.match(/resolveMaterial\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.match(resolve, /isWithinRefractionRange\(\)/);
  assert.match(resolve, /this\.refractiveMaterial === null/);
  assert.ok(
    resolve.indexOf('isWithinRefractionRange') < resolve.indexOf('createMaterial(true)'),
    'range is checked before the refractive material is built',
  );
});

test('both material variants are disposed with the slot', async () => {
  const source = await readFile(
    new URL('../src/editor/stylized/StylizedWaterSlot.js', import.meta.url),
    'utf8',
  );
  const dispose = source.match(/dispose\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.match(dispose, /this\.material\.dispose\(\);/);
  assert.match(dispose, /this\.refractiveMaterial\?\.dispose\(\);/);
});

test('the water slot hides dry chunks so the viewport copy is not triggered', async () => {
  const source = await readFile(
    new URL('../src/editor/stylized/StylizedWaterSlot.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /waterFieldHasCoverage/);
  // Coverage must be recomputed on upload, not cached from the generated page.
  assert.match(
    source,
    /this\.hasWaterCoverage = waterFieldHasCoverage\(this\.waterFieldPixels\);/,
  );
  // Visibility must be decided after the upload, otherwise a chunk that just
  // gained water would stay hidden for a frame.
  const update = source.match(/update\(timestamp\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.ok(update.includes('this.uploadField(page)'), 'update uploads the field');
  assert.ok(
    update.indexOf('this.uploadField(page)')
      < update.indexOf('this.mesh.visible = this.hasWaterCoverage'),
    'visibility is resolved after the upload',
  );
});
