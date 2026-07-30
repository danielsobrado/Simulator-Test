/**
 * The gait contract, shared by the figure and the motion state.
 *
 * `strideHalfLength` has to agree between the two or the feet skate: the motion
 * state advances `gaitPhase` by distance travelled divided by a full stride, and
 * the figure places each footfall half a stride ahead of the body. If either
 * side computed its own the two would drift apart, and the symptom — feet
 * sliding a few centimetres per step — is subtle enough to survive review and
 * obvious enough to ruin the shot. Hence one object both are handed.
 *
 * Note that no-sliding does *not* require any particular stride length. It only
 * requires that the same number is used to advance the phase and to place the
 * foot: over one cycle the body travels a stride and each foot steps once by a
 * stride, whatever that stride happens to be. That freedom is what lets the
 * stride below be chosen for how it looks rather than for anatomy.
 *
 * And it has to be, because this game does not move at human speeds. The
 * configured walk is 9 m/s and the run 16.2 — a sprinter's 100 m pace and then
 * some. Held to a realistic 1.5 m stride the drow's legs would blur at six cycles
 * a second. So the stride is derived from a *cadence* instead: pick a plausible
 * number of paces per second, and let the stride be however long it has to be to
 * cover the ground. Long strides at a fast cadence read as sprinting; short
 * strides at an impossible cadence read as a bug.
 */

/** Cycles per second at a standstill and at a full run. */
const CADENCE_MIN = 0.85;
const CADENCE_MAX = 1.60;

/**
 * Bounds on half a stride, metres, before the leg-length scale.
 *
 * The upper bound is what actually binds at this game's speeds. Past about a
 * metre and a half the swing foot has to travel further than the leg can reach
 * and the IK starts clamping, which reads as a skid at the top of every step.
 */
const HALF_MIN = 0.30;
const HALF_MAX = 1.55;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @param {object} [options]
 * @param {number} [options.runSpeed] speed at which the run pose saturates, m/s
 * @param {number} [options.legLengthScale] from the body profile
 */
export function createGait({ runSpeed = 5.4, legLengthScale = 1 } = {}) {
  const saturation = Math.max(0.5, runSpeed);
  return {
    runSpeed: saturation,
    legLengthScale,

    /** 0 at a standstill, 1 at a full run. Drives lean, bob, swing and duty. */
    runFactor(speed) {
      return clamp(speed / saturation, 0, 1);
    },

    /** Half a stride, metres — body to next footfall. */
    strideHalfLength(speed) {
      const cadence = CADENCE_MIN + (CADENCE_MAX - CADENCE_MIN) * this.runFactor(speed);
      return clamp(speed / (2 * cadence), HALF_MIN, HALF_MAX) * legLengthScale;
    },
  };
}

/** Shortest signed difference between two angles, radians. */
export function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Framerate-independent exponential approach toward an angle. */
export function angleDamp(cur, target, rate, dt) {
  return cur - angleDelta(cur, target) * (1 - Math.exp(-rate * dt));
}

export { CADENCE_MIN, CADENCE_MAX, HALF_MIN, HALF_MAX };
