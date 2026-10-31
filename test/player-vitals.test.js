import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerVitals } from '../src/editor/player/PlayerVitals.js';

const idle = { running: false, moving: false, explorationBoost: false, grounded: true, footY: 0 };

test('a cast spends mana and an unaffordable one is refused until it regenerates', () => {
  const vitals = new PlayerVitals();
  vitals.spendCast(5000);
  vitals.spendCast(4000);
  assert.ok(Math.abs(vitals.levels.mana - 0.1) < 1e-9);
  assert.equal(vitals.canCast(2000), false);
  vitals.update(3, idle);
  assert.equal(vitals.canCast(2000), true);
});

test('running drains stamina, boosting drains energy, and rest restores both', () => {
  const vitals = new PlayerVitals();
  vitals.update(5, { ...idle, running: true, moving: true, explorationBoost: true });
  assert.ok(vitals.levels.stamina < 1 && vitals.levels.energy < 1);
  const { stamina, energy } = vitals.levels;
  vitals.update(1, idle);
  assert.ok(vitals.levels.stamina > stamina && vitals.levels.energy > energy);
});

test('only a fall past the safe height onto dry ground costs life', () => {
  const fall = (height, landing = {}) => {
    const vitals = new PlayerVitals();
    vitals.update(0, { ...idle, grounded: false, footY: height });
    vitals.update(0, { ...idle, footY: 0, ...landing });
    return vitals.levels.life;
  };
  assert.equal(fall(5), 1);
  assert.ok(fall(16) < 1);
  assert.equal(fall(16, { waterDepth: 1 }), 1);
  assert.equal(fall(16, { harnessActive: true }), 1);
});

test('spent stamina and energy stay locked until they recover', () => {
  const vitals = new PlayerVitals();
  const exert = { ...idle, running: true, moving: true, explorationBoost: true };
  for (let second = 0; second < 15; second += 1) vitals.update(1, exert);
  assert.equal(vitals.canRun, false);
  assert.equal(vitals.canBoost, false);
  vitals.update(1, idle);
  assert.equal(vitals.canRun, false);
  for (let second = 0; second < 5; second += 1) vitals.update(1, idle);
  assert.equal(vitals.canRun, true);
  assert.equal(vitals.canBoost, true);
});

test('standing still with run held does not drain stamina', () => {
  const vitals = new PlayerVitals();
  vitals.update(5, { ...idle, running: true });
  assert.equal(vitals.levels.stamina, 1);
});

test('a lethal fall leaves the player dead until revived to full', () => {
  const vitals = new PlayerVitals();
  vitals.spendCast(5000);
  vitals.update(0, { ...idle, grounded: false, footY: 100 });
  vitals.update(0, { ...idle, footY: 0 });
  assert.equal(vitals.dead, true);
  vitals.revive();
  assert.equal(vitals.dead, false);
  assert.equal(vitals.levels.mana, 1);
});

test('a scripted harness walk changes nothing', () => {
  const vitals = new PlayerVitals();
  vitals.update(30, { ...idle, running: true, moving: true, explorationBoost: true, harnessActive: true });
  assert.deepEqual(vitals.levels, { life: 1, mana: 1, stamina: 1, energy: 1 });
});

test('listeners hear whole-percent changes only', () => {
  const vitals = new PlayerVitals();
  let calls = 0;
  vitals.subscribe(() => { calls += 1; });
  assert.equal(calls, 1);
  vitals.update(0.016, idle);
  assert.equal(calls, 1);
  vitals.spendCast(2000);
  assert.equal(calls, 2);
});
