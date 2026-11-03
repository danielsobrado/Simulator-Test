import assert from 'node:assert/strict';
import test from 'node:test';
import { waterBlobPose } from '../src/editor/vfx/render/WaterBlobLayer.js';
import { createEffectDirector } from '../src/editor/vfx/effects/EffectDirector.js';
import { createParticleSimulator } from '../src/editor/vfx/particles/ParticleSimulator.js';
import { createSpellParticleTypes } from '../src/editor/vfx/types/index.js';
import { EFFECT_RECIPES } from '../src/editor/vfx/recipes/index.js';

const SPEC = { from: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 3, z: 0 }, radius: 1, rise: 1, hold: 4, collapse: 0.5 };

test('the blob is drawn up from the ground, hangs, then collapses back and is gone', () => {
  const start = waterBlobPose(SPEC, 0.01);
  assert.ok(start.y < 0.1 && start.radius < 0.4, 'it starts small, at the ground');
  const hanging = waterBlobPose(SPEC, 3);
  assert.equal(hanging.y, 3);
  assert.equal(hanging.radius, 1);
  assert.equal(hanging.presence, 1);
  const falling = waterBlobPose(SPEC, 5.3);
  assert.ok(falling.y < 3 && falling.radius < 1, 'collapsing, it drops and shrinks');
  assert.equal(waterBlobPose(SPEC, 5.6), null);
});

test('Watery Sphere raises one blob, stirs the ground under it and crashes into a splash', () => {
  const types = createSpellParticleTypes();
  const flat = () => 0;
  const simulator = createParticleSimulator({ types, groundHeight: flat, capacity: 8192 });
  const blobs = [];
  const played = [];
  let presses = 0;
  let director = null;
  director = createEffectDirector({
    simulator, types, groundHeight: flat, getListener: () => ({ x: 0, y: 2, z: 10 }),
    lights: { acquire: () => ({ release() {}, setPosition() {} }) },
    decals: { spawn: () => 0 }, shake: { add() {} }, sound: { play() {} },
    blobs: { spawn: (spec) => { blobs.push(spec); return spec; } },
    pressGround: () => { presses += 1; },
    play: (id, context) => { played.push(id); return director.play(EFFECT_RECIPES[id], context); },
  });
  director.play(EFFECT_RECIPES.waterySphere, { origin: { x: 0, y: 1.4, z: 0 }, target: { x: 0, y: 0, z: -12 }, right: { x: 1, y: 0, z: 0 } });
  for (let frame = 0; frame < 60 * 12; frame += 1) { director.update(1 / 60); simulator.update(1 / 60); }
  assert.equal(blobs.length, 1);
  assert.ok(blobs[0].center.y > blobs[0].from.y + 2, 'it hangs well above the ground');
  assert.ok(presses > 40, 'the surface under it stays stirred');
  assert.ok(played.includes('tidalOrbImpact'), 'it ends in a splash');
});

test('biome surface spots sit inside the biome and face nearby water', async () => {
  const { findBiomeSurfacePose } = await import('../src/editor/performance/qa/WorldVisualSurfaceDemo.js');
  // Desert (1) west of x = 0 cells, a lake east of cell x = 6 inside it.
  const generator = {
    source: { bounds: { minCellX: -40, minCellZ: -40, widthCells: 80, heightCells: 80 } },
    sampleTile: (x) => (x < 20 ? 1 : 4),
    sampleWater: (x) => ({ kind: x >= 6 && x < 20 ? 2 : 0 }),
  };
  const spot = findBiomeSurfacePose(generator, 2, 1, { attempts: 200000 });
  assert.ok(spot.water, 'a shore spot was found');
  assert.equal(generator.sampleTile(Math.floor(spot.x / 2), 0), 1);
  const ahead = { x: spot.x - Math.sin(spot.yaw) * 10, z: spot.z - Math.cos(spot.yaw) * 10 };
  assert.ok(generator.sampleWater(ahead.x / 2).kind > 0, 'the camera faces the water');
  assert.deepEqual(findBiomeSurfacePose(generator, 2, 1, { attempts: 200000 }), spot, 'the same spot every run');
  assert.equal(findBiomeSurfacePose(generator, 2, 9, { attempts: 5000 }), null, 'an absent biome has no spot');
});
