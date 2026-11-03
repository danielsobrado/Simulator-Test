import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectDirector } from '../src/editor/vfx/effects/EffectDirector.js';
import { createParticleBufferWriter, PARTICLE_STREAMS } from '../src/editor/vfx/particles/ParticleBufferWriter.js';
import { createParticleSimulator, createSpawnParams } from '../src/editor/vfx/particles/ParticleSimulator.js';
import { createParticleTypeRegistry } from '../src/editor/vfx/particles/ParticleTypeRegistry.js';
import { EFFECT_RECIPES } from '../src/editor/vfx/recipes/index.js';
import { GRIMOIRE_SPELLS } from '../src/editor/spells/grimoire/grimoireCatalog.js';
import { createSpellParticleTypes } from '../src/editor/vfx/types/index.js';

const flat = () => 0;

function spawnAt(simulator, types, id, setup = () => {}) {
  const params = createSpawnParams();
  params.x = 0; params.y = 5; params.z = 0;
  params.reset();
  setup(params);
  return simulator.emit(types.indexOf(id), params);
}

test('particles age out and the pool stays dense', () => {
  const types = createParticleTypeRegistry({ puff: { life: 1 }, long: { life: 10 } });
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 8 });
  spawnAt(simulator, types, 'puff');
  spawnAt(simulator, types, 'long');
  simulator.update(0.5);
  assert.equal(simulator.count, 2);
  simulator.update(0.6);
  assert.equal(simulator.count, 1);
  assert.equal(types.get(simulator.state.type[0]).id, 'long');
});

test('a full pool drops spawns instead of overwriting live particles', () => {
  const types = createParticleTypeRegistry({ puff: { life: 1 } });
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 2 });
  for (let index = 0; index < 4; index += 1) spawnAt(simulator, types, 'puff');
  assert.equal(simulator.count, 2);
  assert.equal(simulator.dropped, 2);
});

test('debris bounces off the terrain, loses energy and comes to rest', () => {
  const types = createParticleTypeRegistry({
    rock: { life: 20, gravity: 9.8, collide: 'bounce', restitution: 0.4, size: 0.01 },
  });
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 4 });
  spawnAt(simulator, types, 'rock');
  let lowest = Infinity;
  for (let frame = 0; frame < 600; frame += 1) {
    simulator.update(1 / 60);
    lowest = Math.min(lowest, simulator.state.py[0]);
  }
  assert.ok(lowest >= -1e-3, 'fell through the ground');
  assert.ok(Math.abs(simulator.state.vy[0]) < 1e-3, 'never settled');
});

test('impact and trail sub-emitters spawn their types', () => {
  const types = createParticleTypeRegistry({
    hot: { life: 5, gravity: 9.8, collide: 'die', trail: { type: 'smoke', rate: 30 }, onImpact: { type: 'dust', count: 3 } },
    smoke: { life: 0.2 },
    dust: { life: 2 },
  });
  types.validateReferences();
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 256 });
  spawnAt(simulator, types, 'hot');
  for (let frame = 0; frame < 90; frame += 1) simulator.update(1 / 60);
  const ids = Array.from({ length: simulator.count }, (_, index) => types.get(simulator.state.type[index]).id);
  assert.ok(!ids.includes('hot'), 'the hot particle should die on contact');
  assert.equal(ids.filter((id) => id === 'dust').length, 3);
});

test('a floating-origin snap moves every particle with the world', () => {
  const types = createParticleTypeRegistry({ puff: { life: 5 } });
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 4 });
  spawnAt(simulator, types, 'puff', (params) => { params.x = 100; params.z = -50; });
  simulator.shiftOrigin(64, -32);
  assert.equal(simulator.state.px[0], 36);
  assert.equal(simulator.state.pz[0], -18);
});

test('the buffer writer sorts back to front and packs five vec4 streams', () => {
  const types = createParticleTypeRegistry({ puff: { life: 5, fadeIn: 0 } });
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 8 });
  for (const z of [-2, -10, -5]) spawnAt(simulator, types, 'puff', (params) => { params.z = z; });
  simulator.update(0.1);
  const writer = createParticleBufferWriter(8);
  const written = writer.write(simulator, { x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(written, 3);
  assert.deepEqual(PARTICLE_STREAMS, ['vfxA', 'vfxB', 'vfxC', 'vfxD', 'vfxE']);
  const depths = [0, 1, 2].map((index) => writer.streams.vfxA[index * 4 + 2]);
  assert.deepEqual(depths, [-10, -5, -2]);
});

test('effect events fire in timeline order, including ones scheduled late', () => {
  const types = createParticleTypeRegistry({ puff: { life: 1 } });
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 8 });
  const director = createEffectDirector({ simulator, types, groundHeight: flat, getListener: () => ({ x: 0, y: 0, z: 0 }) });
  const log = [];
  director.play((fx) => {
    fx.at(0.2, () => log.push('b'));
    fx.at(0.1, () => {
      log.push('a');
      fx.at(0.15, () => log.push('a2'));
    });
  }, {});
  for (let frame = 0; frame < 30; frame += 1) director.update(1 / 60);
  assert.deepEqual(log, ['a', 'a2', 'b']);
  assert.equal(director.activeCount, 0);
});

function createRecipeHarness() {
  const types = createSpellParticleTypes();
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 8192 });
  const calls = { lights: 0, decals: 0, sounds: 0, shake: 0, presses: 0, maxPressRadius: 0, marks: {} };
  let director = null;
  const services = {
    simulator,
    types,
    groundHeight: flat,
    getListener: () => ({ x: 0, y: 2, z: 10 }),
    lights: { acquire: () => { calls.lights += 1; return { release() {}, setPosition() {} }; } },
    decals: { spawn: () => { calls.decals += 1; return 0; } },
    shake: { add: () => { calls.shake += 1; } },
    sound: { play: () => { calls.sounds += 1; } },
    pressGround: (x, z, radius) => {
      calls.presses += 1;
      calls.maxPressRadius = Math.max(calls.maxPressRadius, radius);
    },
    markGround: (x, z, radius, mark) => {
      calls.marks[mark] = (calls.marks[mark] ?? 0) + 1;
    },
    play: (id, context) => director.play(EFFECT_RECIPES[id], context),
  };
  director = createEffectDirector(services);
  return { director, simulator, calls };
}

const CONTEXT = Object.freeze({
  origin: { x: 0.3, y: 1.4, z: -0.5 },
  target: { x: 0, y: 0, z: -18 },
  normal: { x: 0, y: 1, z: 0 },
  direction: { x: 0, y: -0.07, z: -1 },
  forward: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  caster: { x: 0, y: 0, z: 0 },
  sunDirection: { x: 0.4, y: 0.8, z: 0.2 },
});

test('every grimoire spell names a recipe', () => {
  for (const spell of GRIMOIRE_SPELLS) {
    assert.equal(typeof EFFECT_RECIPES[spell.recipe], 'function', `${spell.id} has no recipe`);
  }
  assert.equal(GRIMOIRE_SPELLS.length, 19);
});

for (const spell of GRIMOIRE_SPELLS) {
  test(`${spell.label} plays to completion within the particle budget`, () => {
    const { director, simulator, calls } = createRecipeHarness();
    director.play(EFFECT_RECIPES[spell.recipe], { ...CONTEXT });
    let peak = 0;
    for (let frame = 0; frame < 60 * 40; frame += 1) {
      director.update(1 / 60);
      simulator.update(1 / 60);
      peak = Math.max(peak, simulator.count);
    }
    assert.ok(peak > 40, `${spell.id} barely emits (${peak})`);
    assert.equal(simulator.dropped, 0, `${spell.id} overflowed the pool`);
    assert.ok(calls.sounds > 0, `${spell.id} is silent`);
    assert.equal(director.activeCount, 0, `${spell.id} never finishes`);
    for (let index = 0; index < simulator.count; index += 1) {
      assert.ok(Number.isFinite(simulator.state.px[index]) && Number.isFinite(simulator.state.py[index]), `${spell.id} produced NaN`);
    }
  });
}

test('the reference explosion builds all seven layers plus light, scorch and shake', () => {
  const { director, simulator, calls } = createRecipeHarness();
  director.play(EFFECT_RECIPES.fireballExplosion, { ...CONTEXT });
  const seen = new Set();
  const types = createSpellParticleTypes();
  for (let frame = 0; frame < 60 * 3; frame += 1) {
    director.update(1 / 60);
    simulator.update(1 / 60);
    for (let index = 0; index < simulator.count; index += 1) seen.add(types.get(simulator.state.type[index]).id);
  }
  for (const layer of [
    'explosion.flash', 'explosion.shock.ground', 'explosion.fireball', 'explosion.spark',
    'explosion.fragment', 'explosion.fragment.smoke', 'explosion.debris', 'explosion.smoke',
  ]) {
    assert.ok(seen.has(layer), `missing layer ${layer}`);
  }
  assert.ok(calls.lights >= 2);
  assert.ok(calls.decals >= 2);
  assert.ok(calls.shake >= 1);
  assert.ok(calls.maxPressRadius > 8, 'the blast should flatten the meadow outward');
});

test('Thunderwave blows the grass flat in a widening wave', () => {
  const { director, simulator, calls } = createRecipeHarness();
  director.play(EFFECT_RECIPES.thunderwave, { ...CONTEXT });
  for (let frame = 0; frame < 60; frame += 1) {
    director.update(1 / 60);
    simulator.update(1 / 60);
  }
  assert.ok(calls.presses > 10);
  assert.ok(calls.maxPressRadius > 9);
});

test('spells mark the meadow, and held marks are refreshed sparingly rather than every frame', () => {
  const { director, simulator, calls } = createRecipeHarness();
  director.play(EFFECT_RECIPES.fireballExplosion, { ...CONTEXT });
  for (let frame = 0; frame < 60 * 14; frame += 1) {
    director.update(1 / 60);
    simulator.update(1 / 60);
  }
  assert.ok(calls.marks.scorch > 0 && calls.marks.singe > 0, 'a fireball chars and singes the grass');
  // Twelve seconds held: every frame would be ~720 stamps per mark.
  assert.ok(calls.marks.scorch < 90, `scorch restamped ${calls.marks.scorch} times`);
  for (const [recipe, mark] of [['blight', 'wither'], ['coneOfCold', 'frost'], ['acidSplashImpact', 'acid'], ['moonbeam', 'moon']]) {
    const harness = createRecipeHarness();
    harness.director.play(EFFECT_RECIPES[recipe], { ...CONTEXT });
    for (let frame = 0; frame < 60 * 4; frame += 1) harness.director.update(1 / 60);
    assert.ok(harness.calls.marks[mark] > 0, `${recipe} leaves no ${mark} mark`);
  }
});

test('smoke thins as it ages and leans into the breeze', () => {
  const types = createParticleTypeRegistry({
    smoke: { life: 4, opacity: 0.8, opacityEnd: 0.25, fadeIn: 0, fadeOut: 1, windDrift: 0.8 },
  });
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 4, wind: { x: 2, z: 0 } });
  spawnAt(simulator, types, 'smoke');
  const look = {};
  simulator.evaluate(0, look);
  const early = look.alpha;
  for (let frame = 0; frame < 180; frame += 1) simulator.update(1 / 60);
  simulator.evaluate(0, look);
  assert.ok(look.alpha < early * 0.7, `opacity should fall toward opacityEnd (${early} → ${look.alpha})`);
  assert.ok(simulator.state.vx[0] > 1.2, `horizontal motion should relax toward the wind (${simulator.state.vx[0]})`);
  assert.ok(simulator.state.px[0] > 1, 'the puff drifted downwind');
});
