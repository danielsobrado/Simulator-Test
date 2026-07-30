import assert from 'node:assert/strict';
import test from 'node:test';

import { createDrowPalette, BLACK_CRUSH_FLOOR } from '../src/editor/character/materials/DrowPalette.js';
import {
  M_ROBE, M_MANTLE, M_LEATHER, M_SKIN, M_TRIM, M_FUR, M_EYE, MATERIAL_SLOT_COUNT,
} from '../src/editor/character/materialSlots.js';

const palette = createDrowPalette();

const albedo = (slot) => [
  palette.albedo[slot * 4],
  palette.albedo[slot * 4 + 1],
  palette.albedo[slot * 4 + 2],
];
const roughness = (slot) => palette.albedo[slot * 4 + 3];
const params = (slot) => palette.params.slice(slot * 4, slot * 4 + 4);
const sheenColor = (slot) => [
  palette.sheenTint[slot * 4],
  palette.sheenTint[slot * 4 + 1],
  palette.sheenTint[slot * 4 + 2],
];
const emissive = (slot) => palette.sheenTint[slot * 4 + 3];

/** Rec. 709 luminance, which is what the tone mapper is going to see. */
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('every slot is populated', () => {
  assert.equal(palette.albedo.length, MATERIAL_SLOT_COUNT * 4);
  assert.equal(palette.params.length, MATERIAL_SLOT_COUNT * 4);
  assert.equal(palette.sheenTint.length, MATERIAL_SLOT_COUNT * 4);
  for (const value of [...palette.albedo, ...palette.params, ...palette.sheenTint]) {
    assert.ok(Number.isFinite(value));
  }
});

test('nothing crushes to black under ACES', () => {
  // The scene tone-maps with ACES at 1.12 exposure. Authored at true black the
  // drow would be a flat silhouette with no form in it at all, and the bevel
  // lighting and baked cavity occlusion would stop being visible.
  for (let slot = 0; slot < MATERIAL_SLOT_COUNT; slot++) {
    if (slot === M_EYE) continue; // the eyes are emission, not albedo
    const channels = albedo(slot);
    assert.ok(
      Math.max(...channels) >= BLACK_CRUSH_FLOOR,
      `slot ${slot} is ${channels} — below the crush floor`,
    );
  }
});

test('the drow reads as a drow: dark cloth, obsidian skin, silver hair', () => {
  // Cloth is far darker than the fur and the trim it is edged with; that
  // contrast is the whole silhouette at fifteen metres.
  assert.ok(luminance(albedo(M_ROBE)) < 0.05);
  assert.ok(luminance(albedo(M_MANTLE)) < 0.05);
  assert.ok(luminance(albedo(M_SKIN)) < 0.10, 'drow skin is obsidian, not olive');
  assert.ok(luminance(albedo(M_FUR)) > 0.5, 'drow hair is stark white');
  assert.ok(
    luminance(albedo(M_FUR)) > luminance(albedo(M_ROBE)) * 10,
    'the hair has to read against the cloak',
  );
});

test('the violet is in the hue and the sheen, not the saturation', () => {
  // Direct sun in this scene is warm, so a strongly violet albedo comes back out
  // of the multiply as warm grey. What survives is a small blue-over-red bias
  // plus a genuinely violet sheen.
  for (const slot of [M_ROBE, M_MANTLE, M_SKIN]) {
    const [r, , b] = albedo(slot);
    assert.ok(b > r, `slot ${slot} should lean blue, not red`);
    assert.ok(b < r * 3, `slot ${slot} is too saturated to survive a warm sun`);
  }
  const [sr, , sb] = sheenColor(M_MANTLE);
  assert.ok(sb > sr * 1.5, 'the piwafwi needs a genuinely violet sheen');
  assert.ok(
    params(M_MANTLE)[0] > params(M_ROBE)[0],
    'the piwafwi carries more sheen than the robe under it — that is its read',
  );
});

test('only the eyes emit, and they emit hard', () => {
  for (let slot = 0; slot < MATERIAL_SLOT_COUNT; slot++) {
    if (slot === M_EYE) continue;
    assert.equal(emissive(slot), 0, `slot ${slot} must not emit`);
  }
  assert.ok(emissive(M_EYE) > 1, 'the eyes have to burn through the cowl occlusion');
  const [r, , b] = sheenColor(M_EYE);
  assert.ok(b > r, 'drow eyes are violet-white');
});

test('only the hair carries the anisotropic streak', () => {
  for (let slot = 0; slot < MATERIAL_SLOT_COUNT; slot++) {
    const streak = params(slot)[1];
    if (slot === M_FUR) assert.ok(streak > 0, 'hair needs its highlight');
    else assert.equal(streak, 0, `slot ${slot} is not hair`);
  }
});

test('transmission stays low on the heavy cloth', () => {
  // Sunlight through a black robe multiplied by a warm sun comes back grey, so a
  // generous transmission term desaturates the garment until the albedo stops
  // mattering. Heavy wool is close to opaque.
  assert.ok(params(M_ROBE)[2] < 0.1);
  assert.ok(params(M_MANTLE)[2] < 0.1);
  assert.ok(params(M_LEATHER)[2] < 0.05);
});

test('roughness is plausible everywhere', () => {
  for (let slot = 0; slot < MATERIAL_SLOT_COUNT; slot++) {
    const r = roughness(slot);
    assert.ok(r > 0 && r <= 1, `slot ${slot} roughness ${r}`);
  }
  assert.ok(roughness(M_SKIN) < 0.6, 'obsidian skin needs a specular edge on the cheekbone');
  assert.ok(roughness(M_ROBE) > 0.7, 'wool is not satin');
});

test('the trim is bright enough to carry the house sigil', () => {
  assert.ok(luminance(albedo(M_TRIM)) > luminance(albedo(M_ROBE)) * 5);
});

test('overrides reach the palette and bad slots are rejected', () => {
  const patched = createDrowPalette({
    [M_SKIN]: { albedo: [0.2, 0.1, 0.3], roughness: 0.9, emissive: 0 },
  });
  // Float32Array storage, so compare with a tolerance rather than exactly.
  const wanted = [0.2, 0.1, 0.3];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(patched.albedo[M_SKIN * 4 + i] - wanted[i]) < 1e-6);
  }
  assert.ok(Math.abs(patched.albedo[M_SKIN * 4 + 3] - 0.9) < 1e-6);
  // The default palette must not have been mutated.
  assert.notEqual(palette.albedo[M_SKIN * 4], 0.2);
  assert.throws(() => createDrowPalette({ 99: { albedo: [1, 1, 1] } }), /palette slot/);
});
