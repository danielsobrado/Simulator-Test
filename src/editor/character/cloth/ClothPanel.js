/**
 * One simulated garment: a closed tube of particles, `cols` around by `rows`
 * down.
 *
 * The grids are deliberately coarse because the render mesh does not use them
 * directly — the vertex shader reconstructs a smooth surface from them with
 * Catmull-Rom, so tessellation and simulation cost are completely decoupled.
 * Doubling the visible smoothness costs nothing here.
 *
 * Every particle carries a bind-pose position and one bone. Its kinematic target
 * each frame is that bind position pushed through the bone's skinning matrix —
 * exactly what a rigidly-skinned vertex would do. A per-particle `pinRate`
 * decides how hard it is pulled toward that target, in units of 1/second:
 *
 *   Infinity   the waistband, the collar, the shoulder of a sleeve. Welded.
 *   10-60      follows the body closely, with a frame or two of give.
 *   1-5        follows loosely — this is where a garment starts to read as cloth.
 *   0.2-0.5    shape memory only. Stops a free hem from slowly collapsing into a
 *              rope without meaningfully resisting motion.
 *
 * Expressing the pull as a rate rather than a per-frame blend is not a detail: a
 * "0.05 blend" applied 165 times a second is a 12 ms time constant, which is a
 * weld. Anything time-based in a system that also has to survive a frame-rate
 * change has to be written as a rate — `test/character-cloth.test.js` pins it.
 */

/** Which body capsules a panel is allowed to collide against. */
export const C_TORSO = 1;
export const C_LEGS = 2;
export const C_ARM_L = 4;
export const C_ARM_R = 8;

export class ClothPanel {
  constructor(spec) {
    this.name = spec.name;
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.matId = spec.matId;
    this.renderCols = spec.renderCols;
    this.renderRows = spec.renderRows;
    this.weaveU = spec.weaveU;
    this.weaveV = spec.weaveV;
    this.aoTop = spec.aoTop;
    this.aoBottom = spec.aoBottom;
    this.collide = spec.collide;
    /** Rows at the bottom that check the ground. */
    this.groundRows = spec.groundRows || 0;
    /** Row in the shared transform texture where this panel's grid starts. */
    this.nodeRow = 0;

    const n = this.cols * this.rows;
    this.count = n;
    this.bindPos = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.target = new Float32Array(n * 3);
    this.bone = new Int32Array(n);
    this.pinRate = new Float32Array(n);

    // Rest lengths: around the ring, down the panel, and the bending pair two
    // rows apart. Measured from the bind pose, so the garment's rest shape *is*
    // its authored shape.
    this.restU = new Float32Array(n);
    this.restV = new Float32Array(n);
    this.restB = new Float32Array(n);
  }

  /** Called once the bind positions are filled in. */
  finalise() {
    const { cols, rows, bindPos } = this;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = (j * cols + i) * 3;
        const bu = (j * cols + ((i + 1) % cols)) * 3;
        this.restU[j * cols + i] = dist3(bindPos, a, bindPos, bu);
        if (j + 1 < rows) {
          const bv = ((j + 1) * cols + i) * 3;
          this.restV[j * cols + i] = dist3(bindPos, a, bindPos, bv);
        }
        if (j + 2 < rows) {
          const bb = ((j + 2) * cols + i) * 3;
          this.restB[j * cols + i] = dist3(bindPos, a, bindPos, bb);
        }
      }
    }
    this.pos.set(bindPos);
    this.prev.set(bindPos);
    return this;
  }

  /**
   * Rebase after a floating-origin shift. Simulated positions are absolute
   * render-space coordinates carried across frames, so a rebase that moved the
   * world without moving them would fling every garment a chunk sideways and
   * then let the constraints drag it back over the next second.
   */
  shiftWorld(shiftX, shiftZ) {
    for (let o = 0; o < this.pos.length; o += 3) {
      this.pos[o] -= shiftX;
      this.pos[o + 2] -= shiftZ;
      this.prev[o] -= shiftX;
      this.prev[o + 2] -= shiftZ;
    }
  }
}

function dist3(a, ia, b, ib) {
  return Math.hypot(a[ia] - b[ib], a[ia + 1] - b[ib + 1], a[ia + 2] - b[ib + 2]);
}
