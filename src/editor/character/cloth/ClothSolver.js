/**
 * Garment simulation — verlet cloth on coarse grids.
 *
 * Wind is *apparent* wind — the field wind minus the character's own velocity —
 * with quadratic drag, so the robe streams back when the drow runs without
 * needing a special case for it.
 *
 * Allocation: none per frame. All state is typed arrays sized at construction.
 */

import {
  C_TORSO, C_LEGS, C_ARM_L, C_ARM_R,
} from './ClothPanel.js';
import {
  B_ROOT, B_NECK,
  B_UPPER_L, B_FORE_L, B_HAND_L, B_UPPER_R, B_FORE_R, B_HAND_R,
  B_THIGH_L, B_SHIN_L, B_FOOT_L, B_THIGH_R, B_SHIN_R, B_FOOT_R,
} from '../characterBones.js';

/** Constraint relaxation iterations. Six is where the robe stops looking rubbery. */
const ITERATIONS = 6;

/** Capsule table: [boneA, boneB, radius, mask]. Rebuilt from joints each frame. */
const CAPSULES = Object.freeze([
  [B_ROOT, B_NECK, 0.175, C_TORSO],
  [B_THIGH_L, B_SHIN_L, 0.125, C_LEGS],
  [B_SHIN_L, B_FOOT_L, 0.098, C_LEGS],
  [B_THIGH_R, B_SHIN_R, 0.125, C_LEGS],
  [B_SHIN_R, B_FOOT_R, 0.098, C_LEGS],
  [B_UPPER_L, B_FORE_L, 0.078, C_ARM_L],
  [B_FORE_L, B_HAND_L, 0.068, C_ARM_L],
  [B_UPPER_R, B_FORE_R, 0.078, C_ARM_R],
  [B_FORE_R, B_HAND_R, 0.068, C_ARM_R],
]);

export class ClothSolver {
  /**
   * @param {import('./ClothPanel.js').ClothPanel[]} panels
   * @param {{ heightAt(x: number, z: number): number }} terrain
   * @param {{ sample(out: Float32Array, seconds: number): void }} wind
   *   Field wind in m/s. Supplied rather than read from a settings singleton so
   *   the solver is testable headlessly and so the weather system stays the one
   *   owner of what the wind is doing.
   */
  constructor(panels, terrain, wind) {
    this.panels = panels;
    this.terrain = terrain;
    this.wind = wind;
    this._wind = new Float32Array(3);
    this._field = new Float32Array(3);
    this._t = 0;
    /** Capsule radii scale with the body, or a slim drow wears a fat robe. */
    this.capsuleScale = 1;
  }

  /**
   * @param {number} dt
   * @param {import('../CharacterFigure.js').CharacterFigure} fig
   * @param {import('../CharacterMotionState.js').CharacterMotionState} ch
   */
  update(dt, fig, ch) {
    // Two sub-steps at 30 Hz and below. Verlet with hard pins is stable, but a
    // long step lets the hem overshoot through the legs before the collision
    // pass sees it.
    let h = Math.min(dt, 1 / 30);
    let steps = 1;
    if (h > 1 / 55) { steps = 2; h *= 0.5; }
    this._t += dt;

    this.wind.sample(this._field, this._t);
    // Apparent wind. Subtracting the character's own velocity is what makes a
    // run lay the robe out behind without a separate "running" case.
    this._wind[0] = this._field[0] - ch.speed * Math.sin(ch.facing);
    this._wind[1] = this._field[1];
    this._wind[2] = this._field[2] - ch.speed * Math.cos(ch.facing);

    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.panels.length; i++) {
        this._step(this.panels[i], h, fig);
      }
    }
  }

  /**
   * Drop every garment straight onto its kinematic target.
   *
   * Done once, on the first update. The panels are authored in bind space at the
   * world origin, and letting them fall from there to wherever the player
   * actually spawned takes a second of visible flapping.
   */
  settle(fig) {
    const skin = fig.skin;
    for (const p of this.panels) {
      for (let k = 0; k < p.count; k++) {
        const b = p.bone[k] * 16;
        const o = k * 3;
        const x = p.bindPos[o]; const y = p.bindPos[o + 1]; const z = p.bindPos[o + 2];
        p.pos[o] = skin[b] * x + skin[b + 4] * y + skin[b + 8] * z + skin[b + 12];
        p.pos[o + 1] = skin[b + 1] * x + skin[b + 5] * y + skin[b + 9] * z + skin[b + 13];
        p.pos[o + 2] = skin[b + 2] * x + skin[b + 6] * y + skin[b + 10] * z + skin[b + 14];
      }
      p.prev.set(p.pos);
    }
  }

  shiftWorld(shiftX, shiftZ) {
    for (const p of this.panels) p.shiftWorld(shiftX, shiftZ);
  }

  _step(p, h, fig) {
    const n = p.count;
    const pos = p.pos;
    const prev = p.prev;
    const target = p.target;
    const skin = fig.skin;

    // ---- kinematic targets, from the skeleton -------------------------
    for (let k = 0; k < n; k++) {
      const b = p.bone[k] * 16;
      const o = k * 3;
      const x = p.bindPos[o]; const y = p.bindPos[o + 1]; const z = p.bindPos[o + 2];
      target[o] = skin[b] * x + skin[b + 4] * y + skin[b + 8] * z + skin[b + 12];
      target[o + 1] = skin[b + 1] * x + skin[b + 5] * y + skin[b + 9] * z + skin[b + 13];
      target[o + 2] = skin[b + 2] * x + skin[b + 6] * y + skin[b + 10] * z + skin[b + 14];
    }

    // ---- integrate ----------------------------------------------------
    // Quadratic drag against the apparent wind. At walking pace this is a
    // fraction of gravity; in a gale it is several times it, which is what lays
    // a cloak out flat with no special case anywhere.
    const wx = this._wind[0]; const wy = this._wind[1]; const wz = this._wind[2];
    const wmag = Math.hypot(wx, wy, wz);
    const drag = 0.085 * wmag;
    const damping = 0.90 ** (h * 60);
    const h2 = h * h;

    for (let k = 0; k < n; k++) {
      if (!Number.isFinite(p.pinRate[k])) continue; // welded; skip the integrator
      const o = k * 3;
      // Turbulence, hashed off the particle index so it does not pulse in unison
      // across the garment.
      const ph = k * 1.7 + this._t * 4.5;
      const tx = Math.sin(ph) * 0.9;
      const ty = Math.sin(ph * 1.31 + 2.1) * 0.7;
      const tz = Math.cos(ph * 0.87 + 0.4) * 0.9;

      const ax = wx * drag + tx * drag * 0.25;
      const ay = wy * drag - 9.81 + ty * drag * 0.25;
      const az = wz * drag + tz * drag * 0.25;

      const vx = (pos[o] - prev[o]) * damping;
      const vy = (pos[o + 1] - prev[o + 1]) * damping;
      const vz = (pos[o + 2] - prev[o + 2]) * damping;

      prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
      pos[o] += vx + ax * h2;
      pos[o + 1] += vy + ay * h2;
      pos[o + 2] += vz + az * h2;
    }

    // ---- constraints ---------------------------------------------------
    for (let it = 0; it < ITERATIONS; it++) {
      this._anchors(p, h);
      this._distance(p, it);
    }
    this._collide(p, fig);
  }

  /** Pull each particle toward its skinned target at its own rate. */
  _anchors(p, h) {
    const n = p.count;
    const pos = p.pos;
    const target = p.target;
    for (let k = 0; k < n; k++) {
      const rate = p.pinRate[k];
      const o = k * 3;
      if (!Number.isFinite(rate)) {
        pos[o] = target[o];
        pos[o + 1] = target[o + 1];
        pos[o + 2] = target[o + 2];
        continue;
      }
      if (rate <= 0) continue;
      // Divided by the iteration count so the total pull over one frame is the
      // rate the table asks for, not six times it.
      const w = (1 - Math.exp(-rate * h)) / ITERATIONS;
      pos[o] += (target[o] - pos[o]) * w;
      pos[o + 1] += (target[o + 1] - pos[o + 1]) * w;
      pos[o + 2] += (target[o + 2] - pos[o + 2]) * w;
    }
  }

  /**
   * Distance and bending constraints, Gauss-Seidel.
   *
   * Welded particles have infinite mass: they take none of the correction, so a
   * hem cannot drag the waistband off the hips.
   */
  _distance(p, iteration) {
    const {
      cols, rows, pos, restU, restV, restB, pinRate,
    } = p;
    // Bending is solved softly and only on the later iterations. Solved hard it
    // fights the distance constraints and the garment goes stiff.
    const bendK = iteration >= ITERATIONS - 3 ? 0.22 : 0;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        // around the ring
        solveLink(pos, k, j * cols + ((i + 1) % cols), restU[k], pinRate, 1);
        // down the panel
        if (j + 1 < rows) {
          solveLink(pos, k, (j + 1) * cols + i, restV[k], pinRate, 1);
        }
        // bending, two rows apart
        if (bendK > 0 && j + 2 < rows) {
          solveLink(pos, k, (j + 2) * cols + i, restB[k], pinRate, bendK);
        }
      }
    }
  }

  /** Push particles out of the body capsules and off the ground. */
  _collide(p, fig) {
    const n = p.count;
    const pos = p.pos;
    const joint = fig.joint;
    const scale = this.capsuleScale;

    for (let c = 0; c < CAPSULES.length; c++) {
      const cap = CAPSULES[c];
      if ((p.collide & cap[3]) === 0) continue;
      const a = cap[0] * 3; const b = cap[1] * 3;
      const ax = joint[a]; const ay = joint[a + 1]; const az = joint[a + 2];
      const bx = joint[b]; const by = joint[b + 1]; const bz = joint[b + 2];
      const ex = bx - ax; const ey = by - ay; const ez = bz - az;
      const elen2 = ex * ex + ey * ey + ez * ez || 1e-6;
      const r = cap[2] * scale;

      for (let k = 0; k < n; k++) {
        if (!Number.isFinite(p.pinRate[k])) continue;
        const o = k * 3;
        let t = ((pos[o] - ax) * ex + (pos[o + 1] - ay) * ey + (pos[o + 2] - az) * ez) / elen2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + ex * t; const cy = ay + ey * t; const cz = az + ez * t;
        const dx = pos[o] - cx; const dy = pos[o + 1] - cy; const dz = pos[o + 2] - cz;
        const d = Math.hypot(dx, dy, dz);
        if (d >= r || d < 1e-6) continue;
        const push = (r - d) / d;
        pos[o] += dx * push;
        pos[o + 1] += dy * push;
        pos[o + 2] += dz * push;
      }
    }

    // The hem rides on the ground rather than through it. Only the bottom rows
    // check, because that is the only place it can happen and `heightAt` is a
    // filtered lookup, not free.
    if (p.groundRows > 0) {
      const start = (p.rows - p.groundRows) * p.cols;
      for (let k = start; k < n; k++) {
        const o = k * 3;
        const g = this.terrain.heightAt(pos[o], pos[o + 2]) + 0.012;
        if (pos[o + 1] < g) pos[o + 1] = g;
      }
    }
  }
}

/**
 * One distance constraint. Mass weighting is binary — a welded particle does not
 * move at all — which is both correct and much cheaper than carrying inverse
 * masses through the inner loop.
 */
function solveLink(pos, ka, kb, rest, pinRate, stiffness) {
  const a = ka * 3; const b = kb * 3;
  const dx = pos[b] - pos[a];
  const dy = pos[b + 1] - pos[a + 1];
  const dz = pos[b + 2] - pos[a + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-7) return;
  const diff = ((d - rest) / d) * stiffness;

  const fa = Number.isFinite(pinRate[ka]);
  const fb = Number.isFinite(pinRate[kb]);
  if (fa && fb) {
    const half = diff * 0.5;
    pos[a] += dx * half; pos[a + 1] += dy * half; pos[a + 2] += dz * half;
    pos[b] -= dx * half; pos[b + 1] -= dy * half; pos[b + 2] -= dz * half;
  } else if (fa) {
    pos[a] += dx * diff; pos[a + 1] += dy * diff; pos[a + 2] += dz * diff;
  } else if (fb) {
    pos[b] -= dx * diff; pos[b + 1] -= dy * diff; pos[b + 2] -= dz * diff;
  }
}

export { ITERATIONS };
