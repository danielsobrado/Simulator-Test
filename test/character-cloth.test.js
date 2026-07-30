import assert from 'node:assert/strict';
import test from 'node:test';

import { createRig } from '../src/editor/character/characterBones.js';
import { createAnatomy } from '../src/editor/character/geometry/drowAnatomy.js';
import { makeDrowPanels } from '../src/editor/character/cloth/drowGarments.js';
import { ClothSolver } from '../src/editor/character/cloth/ClothSolver.js';
import { CharacterFigure } from '../src/editor/character/CharacterFigure.js';
import { CharacterMotionState } from '../src/editor/character/CharacterMotionState.js';
import { CharacterWind } from '../src/editor/character/CharacterWind.js';
import { createGait } from '../src/editor/character/gait.js';
import { M_FUR } from '../src/editor/character/materialSlots.js';

const FLAT = { heightAt: () => 0 };
const STILL_AIR = { sample: (out) => { out[0] = 0; out[1] = 0; out[2] = 0; } };

function build() {
  const rig = createRig();
  const anatomy = createAnatomy(rig);
  const panels = makeDrowPanels(rig, anatomy);
  // The view assigns these; the solver never reads them, but the geometry
  // builder refuses to run without them and the test mirrors production order.
  panels.forEach((p, i) => { p.nodeRow = 4 + i; });
  return { rig, anatomy, panels };
}

function status({ x = 0, z = 0, footY = 0, yaw = 0 } = {}) {
  return {
    position: { x, y: footY + 1.7, z },
    footY,
    grounded: true,
    yaw,
    pitch: 0,
    waterState: 'dry',
  };
}

function run({
  panels, rig, wind = STILL_AIR, seconds = 2, hz = 60, speed = 0,
}) {
  const gait = createGait({ runSpeed: 5.4, legLengthScale: rig.profile.legLength });
  const figure = new CharacterFigure(FLAT, rig, gait);
  const motion = new CharacterMotionState(gait);
  const solver = new ClothSolver(panels, FLAT, wind);
  solver.capsuleScale = rig.profile.torsoRadius;

  const dt = 1 / hz;
  let t = 0;
  let x = 0;
  motion.update(dt, status(), 0);
  figure.update(dt, motion);
  solver.settle(figure);
  const steps = Math.round(seconds * hz);
  for (let i = 0; i < steps; i++) {
    t += dt;
    x += speed * dt;
    motion.update(dt, status({ x }), t * 1000);
    figure.update(dt, motion);
    solver.update(dt, figure, motion);
  }
  return { figure, motion, solver };
}

test('rest lengths come from the bind pose', () => {
  const { panels } = build();
  for (const p of panels) {
    for (let j = 0; j < p.rows; j++) {
      for (let i = 0; i < p.cols; i++) {
        const k = j * p.cols + i;
        const a = k * 3;
        const b = (j * p.cols + ((i + 1) % p.cols)) * 3;
        const expected = Math.hypot(
          p.bindPos[a] - p.bindPos[b],
          p.bindPos[a + 1] - p.bindPos[b + 1],
          p.bindPos[a + 2] - p.bindPos[b + 2],
        );
        assert.ok(
          Math.abs(p.restU[k] - expected) < 1e-6,
          `${p.name} restU[${k}] disagrees with the bind pose`,
        );
      }
    }
  }
});

test('every panel has a welded top row and free lower rows', () => {
  const { panels } = build();
  for (const p of panels) {
    for (let i = 0; i < p.cols; i++) {
      assert.equal(p.pinRate[i], Infinity, `${p.name} top row must be welded`);
    }
    const bottom = (p.rows - 1) * p.cols;
    assert.ok(
      Number.isFinite(p.pinRate[bottom]) && p.pinRate[bottom] < 2,
      `${p.name} bottom row must hang loose`,
    );
  }
});

test('the drow has hair, and it is a simulated panel', () => {
  const { panels } = build();
  const hair = panels.find((p) => p.name === 'hair');
  assert.ok(hair, 'the drow needs hair');
  assert.equal(hair.matId, M_FUR);
  // Long at the back, a hairline at the front. That asymmetry is what keeps it
  // out of the face and the scarf.
  let frontLowest = Infinity;
  let backLowest = Infinity;
  for (let j = 0; j < hair.rows; j++) {
    for (let i = 0; i < hair.cols; i++) {
      const a = (i / hair.cols) * Math.PI * 2;
      const y = hair.bindPos[(j * hair.cols + i) * 3 + 1];
      if (Math.cos(a) > 0.9) frontLowest = Math.min(frontLowest, y);
      if (Math.cos(a) < -0.9) backLowest = Math.min(backLowest, y);
    }
  }
  assert.ok(
    frontLowest - backLowest > 0.25,
    `hair should fall much further behind (front ${frontLowest}, back ${backLowest})`,
  );
});

test('the pin-rate contract is frame-rate independent', () => {
  // The contract is that `pinRate` is 1/seconds, not a per-frame blend. A "0.05
  // blend" applied 165 times a second is a 12 ms time constant — a weld — while
  // the same blend at 30 Hz is a loose drape, and the garment would be a
  // different garment on a different monitor.
  //
  // What that does *not* promise is bit-identical free hems. Six Gauss-Seidel
  // iterations a substep means a 165 Hz run relaxes its constraints nearly three
  // times as often as a 30 Hz one, so an unpinned tip converges slightly further.
  // That is a property of position-based cloth, not of the pin rates, and the
  // bounds below are graded by pin rate to say exactly that.
  const slow = build();
  const fast = build();
  run({ panels: slow.panels, rig: slow.rig, seconds: 3, hz: 30 });
  run({ panels: fast.panels, rig: fast.rig, seconds: 3, hz: 165 });

  let worstOverall = 0;
  for (let pi = 0; pi < slow.panels.length; pi++) {
    const p = slow.panels[pi];
    const q = fast.panels[pi];
    for (let j = 0; j < p.rows; j++) {
      const rate = p.pinRate[j * p.cols];
      let worstRow = 0;
      for (let i = 0; i < p.cols; i++) {
        const o = (j * p.cols + i) * 3;
        worstRow = Math.max(worstRow, Math.hypot(
          p.pos[o] - q.pos[o],
          p.pos[o + 1] - q.pos[o + 1],
          p.pos[o + 2] - q.pos[o + 2],
        ));
      }
      worstOverall = Math.max(worstOverall, worstRow);

      if (!Number.isFinite(rate)) {
        // Welded rows sit exactly on their skinned target, so all that separates
        // the two runs is float32 rounding in the skeleton's own damped pose —
        // tens of micrometres. Three orders of magnitude below anything a blend
        // would produce.
        assert.ok(
          worstRow < 1e-3,
          `${p.name} row ${j} is welded but drifted ${worstRow.toFixed(6)} m`,
        );
      } else if (rate >= 10) {
        assert.ok(
          worstRow < 0.05,
          `${p.name} row ${j} (rate ${rate}) drifted ${worstRow.toFixed(4)} m across frame rates`,
        );
      }
    }
  }
  assert.ok(
    worstOverall < 0.10,
    `garments settled ${worstOverall.toFixed(4)} m apart across frame rates`,
  );
});

test('the solve survives a gale, a sprint and long frames', () => {
  const { panels, rig } = build();
  const gale = new CharacterWind(() => ({
    enabled: true, intensity: 1.6, windX: -1, windZ: 0.4,
  }));
  const gait = createGait({ runSpeed: 5.4, legLengthScale: rig.profile.legLength });
  const figure = new CharacterFigure(FLAT, rig, gait);
  const motion = new CharacterMotionState(gait);
  const solver = new ClothSolver(panels, FLAT, gale);

  let t = 0;
  let x = 0;
  motion.update(1 / 60, status(), 0);
  figure.update(1 / 60, motion);
  solver.settle(figure);
  for (let i = 0; i < 900; i++) {
    // Deliberately vicious: a 12 fps frame every couple of seconds.
    const dt = i % 137 === 0 ? 1 / 12 : 1 / 60;
    t += dt;
    x += 9 * dt;
    motion.update(dt, status({ x, yaw: Math.sin(t * 0.9) * 2 }), t * 1000);
    figure.update(dt, motion);
    solver.update(dt, figure, motion);
  }

  for (const p of panels) {
    for (let k = 0; k < p.pos.length; k++) {
      assert.ok(Number.isFinite(p.pos[k]), `${p.name} went non-finite at ${k}`);
    }
    // Nothing should have been flung away from the body it hangs on.
    for (let k = 0; k < p.count; k++) {
      const dx = p.pos[k * 3] - x;
      const dz = p.pos[k * 3 + 2];
      assert.ok(
        Math.hypot(dx, dz) < 3,
        `${p.name} node ${k} is ${Math.hypot(dx, dz).toFixed(2)} m from the drow`,
      );
    }
  }
});

test('a floating-origin rebase moves the garments with the world', () => {
  const { panels, rig } = build();
  const { solver } = run({ panels, rig, seconds: 0.5 });
  const before = panels[0].pos.slice();
  solver.shiftWorld(1024, -512);
  for (let k = 0; k < before.length; k += 3) {
    assert.ok(Math.abs(panels[0].pos[k] - (before[k] - 1024)) < 1e-3);
    assert.ok(Math.abs(panels[0].pos[k + 2] - (before[k + 2] + 512)) < 1e-3);
  }
});

test('there is always some wind, even with weather off', () => {
  const out = new Float32Array(3);
  const wind = new CharacterWind(() => ({
    enabled: false, intensity: 0, windX: 0, windZ: 0,
  }));
  let moved = false;
  for (let i = 0; i < 40; i++) {
    wind.sample(out, i * 0.25);
    if (Math.hypot(out[0], out[1], out[2]) > 0.05) moved = true;
  }
  assert.ok(moved, 'a robe that is perfectly still reads as a statue');
});
