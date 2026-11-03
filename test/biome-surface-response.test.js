import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBiomeLooks } from '../src/editor/biomes/BiomeLooks.js';
import { DUNE_LATTICE_SCALE, duneLatticeFrequency } from '../src/editor/biomes/BiomeSurfaceLooks.js';
import { BiomeSurfaceResponse, blendBiomeSurface } from '../src/editor/biomes/BiomeSurfaceResponse.js';
import { RIPPLE_WINDOW_METRES, RIPPLE_TEXELS, rippleStepCoefficients, rippleWindowTexel } from '../src/editor/water/RippleField.js';
import { readDeformationTexel, stampDisc, updateGroundDeformation } from '../src/editor/stylized/deformation/groundDeformationState.js';
import { createSpellSurfacePress } from '../src/editor/spells/spellSurfacePress.js';
import { WaterInteractionSurface } from '../src/editor/stylized/WaterInteractionSurface.js';
import { loadBiomeLooks } from '../tests/helpers/biomeLooks.js';

const SNOW = { color: '#ffffff', frost: '#eeeeee' };

test('the shipped table gives glacier slush, oasis water and bog mud their own response', () => {
  const { surface } = loadBiomeLooks();
  const [desert, glacier, wetland, grassland] = [1, 11, 12, 4];
  assert.ok(surface.ripples.fade[glacier] < surface.ripples.fade[grassland], 'slush stills faster than open water');
  assert.ok(surface.ripples.fade[desert] > surface.ripples.fade[grassland], 'an oasis carries rings further');
  assert.ok(surface.ripples.drops[wetland] > 0, 'bog water is stippled');
  assert.ok(surface.prints.ground[desert] > 0 && surface.prints.ground[grassland] === 0, 'desert sand takes prints, meadows do not');
  assert.ok(surface.prints.lifetime[glacier] > surface.prints.lifetime[desert], 'snow keeps prints longer than blown sand');
  assert.ok(surface.dunes[desert] && surface.dunes[32], 'both sand biomes shape their dunes');
});

test('dunes snap to whole lattice frequencies, so the sand pattern still closes over its period', () => {
  const { a, b } = duneLatticeFrequency(0.2, 30);
  assert.ok(Number.isInteger(a) && Number.isInteger(b));
  const wavelength = 1 / (DUNE_LATTICE_SCALE * Math.hypot(a, b));
  assert.ok(Math.abs(wavelength - 0.2) < 0.05, `snapped to ${wavelength}`);
  assert.deepEqual(duneLatticeFrequency(2, 90), { a: 1, b: 0 }, 'too long a wavelength still draws one cycle');
});

test('surface columns are validated', () => {
  assert.throws(() => resolveBiomeLooks({ snow: SNOW, byTileId: { 4: { ripples: { speed: 9 } } } }), /ripples\.speed/);
  assert.throws(() => resolveBiomeLooks({ snow: SNOW, byTileId: { 4: { prints: { colour: '#000000' } } } }), /prints\.colour/);
  assert.throws(() => resolveBiomeLooks({ snow: SNOW, byTileId: { 4: { prints: { tint: 'red' } } } }), /prints\.tint/);
  const looks = resolveBiomeLooks({ snow: SNOW, surface: { ripples: { fade: 5 } }, byTileId: { 4: { ripples: { fade: 1 } } } });
  assert.equal(looks.surface.ripples.fade[4], 1);
  assert.equal(looks.surface.ripples.fade[6], 5, 'unlisted biomes take the defaults');
});

test('a lake takes the response of the land round it, weighted toward the ground underfoot', () => {
  const looks = resolveBiomeLooks({ snow: SNOW, byTileId: { 1: { ripples: { fade: 6 } }, 11: { ripples: { fade: 0.5 } } } });
  assert.equal(blendBiomeSurface(looks.surface, [0, 0], [4, 1]), null, 'open water alone has no say');
  const blend = blendBiomeSurface(looks.surface, [0, 1, 11], [4, 3, 1]);
  assert.ok(Math.abs(blend.ripples.fade - (6 * 3 + 0.5) / 4) < 1e-6);
});

test('crossing into a biome eases its settings in rather than snapping', () => {
  const looks = resolveBiomeLooks({ snow: SNOW, byTileId: { 11: { ripples: { fade: 0.5 } } } });
  const response = new BiomeSurfaceResponse({ surface: looks.surface, getTile: () => 11, getTileSize: () => 2 });
  const first = response.update(0.016, { x: 0, z: 0 }).ripples.fade;
  assert.ok(first > 2.5 && first < 3, `one frame in: ${first}`);
  for (let frame = 0; frame < 300; frame += 1) response.update(0.016, { x: 0, z: 0 });
  assert.ok(Math.abs(response.current.ripples.fade - 0.5) < 0.01);
});

test('the wave equation stays stable and a ring fades to 5 % over the biome fade', () => {
  for (const seconds of [1 / 240, 1 / 60, 1 / 20, 1]) {
    assert.ok(rippleStepCoefficients(4, 3, seconds).c2 <= 0.45, `unstable at ${seconds}s`);
  }
  const { damping } = rippleStepCoefficients(1.4, 2, 1 / 60);
  const steps = 2 * 2 * 60;
  assert.ok(Math.abs(damping ** steps - 0.05) < 1e-3);
});

test('the ripple window wraps canonical positions like the deformation field, sign and all', () => {
  assert.equal(rippleWindowTexel(-0.0625), RIPPLE_TEXELS - 0.5);
  assert.equal(rippleWindowTexel(7_340_032 + 1.5), 1.5 / (RIPPLE_WINDOW_METRES / RIPPLE_TEXELS));
});

test('a spell disc presses a crater, full depth inside and nothing past the rim', () => {
  updateGroundDeformation(500);
  stampDisc(2000.5, -300.5, 2, 0.6, 0.5);
  assert.ok(Math.abs(readDeformationTexel(2000.5, -300.5)[0] - 0.6) < 0.01);
  assert.ok(readDeformationTexel(2000.5 + 1.6, -300.5)[0] < 0.6);
  assert.equal(readDeformationTexel(2000.5 + 2.4, -300.5)[0], 0);
});

test('a growing blast stamps a few craters, a held puddle only one', () => {
  const stamps = [];
  const pressed = [];
  let seconds = 0;
  const press = createSpellSurfacePress({
    water: { press: (...args) => pressed.push(args) },
    getOrigin: () => ({ x: 1000, z: -1000 }),
    stampDisc: (...args) => stamps.push(args),
    now: () => seconds,
  });
  for (let frame = 0; frame < 30; frame += 1, seconds += 1 / 60) press(1, 2, 0.5 + frame * 0.2, 1, 0.8);
  assert.equal(pressed.length, 30, 'the water hears every press');
  assert.ok(stamps.length >= 3 && stamps.length <= 5, `${stamps.length} blast stamps`);
  assert.equal(stamps[0][0], 1001, 'stamps are canonical');
  assert.ok(stamps.every(([, , radius]) => radius <= 4), 'craters are clipped to the window');
  stamps.length = 0;
  for (let refresh = 0; refresh < 50; refresh += 1, seconds += 0.1) press(5, 5, 3, 0.9, 0.55);
  assert.equal(stamps.length, 1, 'a held disc is stamped once');
});

test('wades, swim strokes and ambient drops each splash the field once', () => {
  const splashes = [];
  let listener = null;
  const status = { position: { x: 3, z: 4 }, waterBodyId: 7, waterKind: 1, waterState: 'swimming' };
  const surface = new WaterInteractionSurface({
    terrainView: {
      worldStore: { generator: {} },
      floatingOrigin: { readState: (target) => Object.assign(target, { x: 100, z: 200 }) },
    },
    player: {
      state: { x: 3, z: 4 },
      subscribeWaterEvents: (fn) => { listener = fn; return () => {}; },
      readFrameStatus: (target) => Object.assign(target, status),
    },
    config: { enabled: true, qualityTier: 'high', interaction: { enabled: true } },
    rippleField: { splash: (...args) => splashes.push(args), update() {}, dispose() {} },
    random: () => 0.5,
  });
  surface.update(1, true, { speed: 1, fade: 1, splash: 1, drops: 0 });
  listener({ type: 'water-enter', current: { waterBodyId: 7, waterKind: 1 }, timestamp: 1000 });
  surface.update(1.1, true, { speed: 1, fade: 1, splash: 1, drops: 0 });
  surface.update(1.2, true, { speed: 1, fade: 1, splash: 1, drops: 0 });
  assert.equal(splashes.length, 1, 'one entry, one splash, however many frames it lives');
  assert.deepEqual(splashes[0].slice(0, 2), [103, 204]);
  surface.update(2.2, true, { speed: 1, fade: 1, splash: 1, drops: 20 });
  assert.ok(splashes.length >= 4, 'a quarter second of 20 drops a second');
});
