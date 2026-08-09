import assert from 'node:assert/strict';
import test from 'node:test';

import { CharacterMotionState } from '../src/editor/character/CharacterMotionState.js';
import { createGait } from '../src/editor/character/gait.js';

function status({ x = 0, z = 0, yaw = 0 } = {}) {
  return {
    position: { x, y: 1.7, z },
    footY: 0,
    grounded: true,
    yaw,
    pitch: 0,
    waterState: 'dry',
  };
}

test('reset clears differentiated velocity before movement resumes', () => {
  const motion = new CharacterMotionState(createGait({ runSpeed: 10 }));
  const dt = 1 / 60;

  motion.update(dt, status(), 0);
  motion.update(dt, status({ x: 0.2 }), 16.7);
  assert.ok(motion.speed > 0);

  motion.reset(status({ x: 100 }));
  motion.update(dt, status({ x: 100 }), 33.4);

  assert.equal(motion.speed, 0);
  assert.equal(motion.accelerationX, 0);
  assert.equal(motion.accelerationZ, 0);
  assert.equal(motion.stepping, false);
});

test('teleport discontinuities do not become acceleration spikes', () => {
  const motion = new CharacterMotionState(createGait({ runSpeed: 10 }));
  const dt = 1 / 60;

  motion.update(dt, status(), 0);
  motion.update(dt, status({ x: 0.2 }), 16.7);
  assert.ok(motion.speed > 0);

  motion.update(dt, status({ x: 100 }), 33.4);

  assert.equal(motion.speed, 0);
  assert.equal(motion.accelerationX, 0);
  assert.equal(motion.accelerationZ, 0);
  assert.equal(motion.stepping, false);
});
