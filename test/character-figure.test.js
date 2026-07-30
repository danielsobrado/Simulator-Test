import assert from 'node:assert/strict';
import test from 'node:test';

import { createRig, BIND_STRIDE, B_UPPER_L, B_FORE_L, B_HAND_L, B_THIGH_L, B_SHIN_L, B_FOOT_L, B_ROOT, B_HEAD, BONE_COUNT } from '../src/editor/character/characterBones.js';
import { DROW_PROFILE, HUMAN_PROFILE } from '../src/editor/character/DrowFigureProfile.js';
import { CharacterFigure, solveTwoBone } from '../src/editor/character/CharacterFigure.js';
import { CharacterMotionState } from '../src/editor/character/CharacterMotionState.js';
import { createGait } from '../src/editor/character/gait.js';
import { mul } from '../src/editor/character/boneMath.js';

const FLAT = { heightAt: () => 0 };

function joint(rig, bone) {
  const o = bone * BIND_STRIDE;
  return [rig.bind[o], rig.bind[o + 1], rig.bind[o + 2]];
}

function status({
  x = 0, z = 0, footY = 0, yaw = 0, grounded = true, waterState = 'dry',
} = {}) {
  return {
    position: { x, y: footY + 1.7, z },
    footY,
    grounded,
    yaw,
    pitch: 0,
    waterState,
  };
}

/**
 * Walk the figure a fixed distance with deliberately uneven frame times, and
 * return every plant position it wrote alongside the touchdown flags.
 */
function walk({ frames = 500, speed = 4, gait, rig, jitter = true }) {
  const figure = new CharacterFigure(FLAT, rig, gait);
  const motion = new CharacterMotionState(gait);
  let t = 0;
  let x = 0;
  motion.update(1 / 60, status(), 0);
  figure.update(1 / 60, motion);
  const samples = [];
  for (let i = 0; i < frames; i++) {
    const dt = jitter ? (1 / 120) * (1 + (i % 9)) : 1 / 60;
    t += dt;
    x += speed * dt;
    motion.update(dt, status({ x }), t * 1000);
    figure.update(dt, motion);
    samples.push({
      plant: [figure.plant[0], figure.plant[1], figure.plant[2]],
      touchdown: figure.touchdown[0],
      phase: motion.gaitPhase,
      distance: x,
    });
  }
  return { figure, motion, samples, distance: x, seconds: t };
}

test('the human profile reproduces the source bind table', () => {
  const rig = createRig(HUMAN_PROFILE);
  // The source table was written to three decimal places; agreeing to two
  // millimetres is agreeing exactly.
  const near = (actual, expected, what) => {
    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(actual[i] - expected[i]) < 0.002,
        `${what}[${i}] was ${actual[i]}, expected ~${expected[i]}`,
      );
    }
  };
  near(joint(rig, B_ROOT), [0, 0.95, 0], 'ROOT');
  near(joint(rig, B_HEAD), [0, 1.55, 0], 'HEAD');
  near(joint(rig, B_UPPER_L), [-0.185, 1.400, 0], 'UPPER_L');
  near(joint(rig, B_FORE_L), [-0.230, 1.123, 0], 'FORE_L');
  near(joint(rig, B_HAND_L), [-0.243, 0.866, 0.016], 'HAND_L');
  near(joint(rig, B_THIGH_L), [-0.100, 0.900, 0], 'THIGH_L');
  near(joint(rig, B_SHIN_L), [-0.100, 0.460, 0], 'SHIN_L');
  near(joint(rig, B_FOOT_L), [-0.100, 0.090, 0], 'FOOT_L');
});

test('the drow profile is taller, slimmer and longer in the leg', () => {
  const human = createRig(HUMAN_PROFILE);
  const drow = createRig(DROW_PROFILE);
  assert.ok(drow.lengths.thigh > human.lengths.thigh);
  assert.ok(drow.lengths.shin > human.lengths.shin);
  assert.ok(drow.anchors.headY > human.anchors.headY);
  assert.ok(drow.anchors.shoulderHalfWidth < human.anchors.shoulderHalfWidth);
  // The sole stays on the ground: the drow gets taller upward, not downward.
  assert.equal(drow.anchors.ankleY, human.anchors.ankleY);
});

test('every bind matrix inverts exactly', () => {
  const figure = new CharacterFigure(FLAT);
  const product = new Float32Array(16);
  for (let b = 0; b < BONE_COUNT; b++) {
    mul(product, 0, figure.bind, b * 16, figure.invBind, b * 16);
    for (let k = 0; k < 16; k++) {
      const expected = (k === 0 || k === 5 || k === 10 || k === 15) ? 1 : 0;
      assert.ok(
        Math.abs(product[k] - expected) < 1e-5,
        `bone ${b} element ${k} was ${product[k]}`,
      );
    }
  }
});

test('a planted foot does not move for the whole of its stance', () => {
  const rig = createRig();
  const gait = createGait({ runSpeed: 5.4, legLengthScale: rig.profile.legLength });
  const { samples } = walk({ rig, gait, speed: 4.2 });

  let touchdowns = 0;
  let anchor = null;
  let worst = 0;
  for (const sample of samples) {
    if (sample.touchdown) {
      touchdowns += 1;
      anchor = sample.plant;
      continue;
    }
    if (!anchor) continue;
    worst = Math.max(worst, Math.hypot(
      sample.plant[0] - anchor[0],
      sample.plant[1] - anchor[1],
      sample.plant[2] - anchor[2],
    ));
  }

  assert.ok(touchdowns > 4, `expected several footfalls, saw ${touchdowns}`);
  // Not "small": zero. During stance nothing in the figure is capable of moving
  // a plant, and that is the property the whole design rests on.
  assert.equal(worst, 0);
});

test('gait phase is driven by distance, not by time', () => {
  const rig = createRig();
  const gait = createGait({ runSpeed: 5.4, legLengthScale: rig.profile.legLength });
  const slow = walk({
    rig, gait, speed: 4.2, frames: 240, jitter: false,
  });
  const fast = walk({
    rig, gait, speed: 4.2, frames: 960, jitter: false,
  });

  // Same ground covered, so the same point in the stride, whatever the frame
  // rate that covered it.
  const atSameDistance = fast.samples.find((s) => s.distance >= slow.distance);
  assert.ok(atSameDistance, 'the fine-grained run should cover the same ground');
  const slowPhase = slow.samples.at(-1).phase;
  const delta = Math.abs(atSameDistance.phase - slowPhase);
  const wrapped = Math.min(delta, 1 - delta);
  assert.ok(wrapped < 0.02, `phase drifted by ${wrapped} between frame rates`);
});

test('the figure and the motion state share one stride', () => {
  const rig = createRig();
  const gait = createGait({ runSpeed: 5.4, legLengthScale: rig.profile.legLength });
  const figure = new CharacterFigure(FLAT, rig, gait);
  const motion = new CharacterMotionState(gait);
  assert.equal(figure.gait, motion.gait);
});

test('the stride keeps cadence plausible at this game`s speeds', () => {
  // Configured walk is 9 m/s and run 16.2. A realistic stride there would be six
  // cycles a second; the cadence-derived stride has to hold it far below that.
  const gait = createGait({ runSpeed: 16.2, legLengthScale: 1.045 });
  for (const speed of [2, 5, 9, 16.2]) {
    const stride = 2 * gait.strideHalfLength(speed);
    const cyclesPerSecond = speed / stride;
    assert.ok(
      cyclesPerSecond <= 5.4,
      `at ${speed} m/s the cadence was ${cyclesPerSecond.toFixed(2)} cycles/s`,
    );
  }
});

test('two-bone IK never reaches past the limb it is given', () => {
  const out = new Float32Array(3);
  const l1 = 0.46;
  const l2 = 0.39;
  // A target far beyond reach: the solver must pull it in, not lock straight.
  solveTwoBone(0, 1, 0, 0, -6, 3, 0, 0, 1, l1, l2, out);
  const upper = Math.hypot(out[0] - 0, out[1] - 1, out[2] - 0);
  assert.ok(Math.abs(upper - l1) < 1e-3, `upper segment was ${upper}, expected ${l1}`);
});

test('leaving the ground tucks the feet instead of stretching the legs', () => {
  const rig = createRig();
  const gait = createGait({ runSpeed: 5.4, legLengthScale: rig.profile.legLength });
  const figure = new CharacterFigure(FLAT, rig, gait);
  const motion = new CharacterMotionState(gait);

  let t = 0;
  for (let i = 0; i < 60; i++) {
    t += 1 / 60;
    motion.update(1 / 60, status({ x: t * 3 }), t * 1000);
    figure.update(1 / 60, motion);
  }
  const groundedFootY = figure.footPos[1];

  // Now jump: the player's soles rise a metre and stay there.
  for (let i = 0; i < 45; i++) {
    t += 1 / 60;
    motion.update(1 / 60, status({ x: t * 3, footY: 1.0, grounded: false }), t * 1000);
    figure.update(1 / 60, motion);
  }

  assert.ok(figure.air > 0.9, `airborne blend only reached ${figure.air}`);
  assert.ok(
    figure.footPos[1] > groundedFootY + 0.5,
    'the feet should come up with the body, not stay welded to the ground',
  );
  // And the legs must still be solvable, not clamped at full extension.
  const hipY = figure.world[12 * 16 + 13];
  const reach = rig.lengths.thigh + rig.lengths.shin;
  assert.ok(hipY - figure.footPos[1] < reach, 'the leg is stretched to its limit');
});
