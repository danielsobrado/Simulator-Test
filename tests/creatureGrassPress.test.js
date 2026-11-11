import assert from 'node:assert/strict';
import test from 'node:test';
import { pressGrassUnderCreatures } from '../src/editor/exploration/creatureGrassPress.js';
import { MeadowInteractionMap } from '../src/editor/stylized/meadow/MeadowInteractionMap.js';

const walker = (x, z, targetHeight = 1.85) => ({ root: { position: { x, z } }, definition: { targetHeight } });

/** A straight serpent along +x from its root, resting except where `raised` says. */
function serpent({ x = 0, z = 0, rings = 40, length = 10, radius = 0.5, raised = () => false, visible = true } = {}) {
  const spine = new Float32Array(rings * 3), ground = new Float32Array(rings);
  for (let i = 0; i < rings; i += 1) {
    spine[i * 3] = i * length / rings;
    spine[i * 3 + 1] = raised(i) ? radius * 4 : radius;
  }
  return { root: { visible, position: { x, z } }, spine, ground, shape: { radius, length } };
}

function collect(options) {
  const discs = [];
  const pressed = pressGrassUnderCreatures({ press: (x, z, radius) => discs.push({ x, z, radius }),
    playerBody: { x: 0, z: 0 }, reach: 13.5, ...options });
  assert.equal(pressed, discs.length);
  return discs;
}

test('a walker near the player presses one disc, a far one none', () => {
  const discs = collect({ walkers: [walker(3, 4), walker(40, 0)] });
  assert.equal(discs.length, 1);
  assert.deepEqual([discs[0].x, discs[0].z], [3, 4]);
  assert.ok(Math.abs(discs[0].radius - 0.26) < 0.01, 'a hero-sized walker presses the hero radius');
});

test('nothing is pressed without a player body or a press map', () => {
  assert.equal(pressGrassUnderCreatures({ press: () => assert.fail(), playerBody: null, reach: 13.5, walkers: [walker(0, 0)] }), 0);
  assert.equal(pressGrassUnderCreatures({ press: null, playerBody: { x: 0, z: 0 }, reach: 13.5, walkers: [walker(0, 0)] }), 0);
  assert.equal(pressGrassUnderCreatures({ press: () => assert.fail(), playerBody: { x: 0, z: 0 }, reach: 0, walkers: [walker(0, 0)] }), 0);
});

test('a serpent presses along its resting body, one disc per body radius', () => {
  const discs = collect({ serpents: [serpent()] });
  // 10 m of body at a 0.5 m radius: rings are 0.25 m apart, so every second one.
  assert.equal(discs.length, 20);
  assert.ok(discs.every(disc => disc.z === 0 && disc.radius > 0.5));
  for (let i = 1; i < discs.length; i += 1) assert.ok(discs[i].x - discs[i - 1].x <= discs[i].radius);
});

test('a reared head, a hidden serpent and a distant one press nothing', () => {
  const reared = collect({ serpents: [serpent({ raised: i => i < 10 })] });
  assert.equal(reared.length, 15);
  assert.ok(reared.every(disc => disc.x >= 2.5));
  assert.equal(collect({ serpents: [serpent({ visible: false })] }).length, 0);
  assert.equal(collect({ serpents: [serpent({ x: 200 })] }).length, 0);
});

test('the discs land in the meadow press map', () => {
  const map = new MeadowInteractionMap({ resolution: 64, worldSize: 27 });
  try {
    map.update({ x: 0, y: 0, z: 0 }, { stamp: false });
    assert.equal(map.peak, 0);
    pressGrassUnderCreatures({ press: (x, z, radius) => map.pressDisc(x, z, radius, 1, 0.35),
      playerBody: { x: 0, z: 0 }, reach: map.worldSize / 2, walkers: [walker(2, 2)] });
    assert.ok(map.peak > 0, 'a walker inside the window leaves ink');
  } finally {
    map.dispose();
  }
});
