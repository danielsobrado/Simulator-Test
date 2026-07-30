/**
 * Derived measurements the geometry is built against.
 *
 * Everything here is a function of the rig, never an absolute height. The source
 * hard-coded the skull centre at y = 1.655 and the hood base at y = 1.352, which
 * is correct for exactly one body and silently wrong for any other — the drow is
 * 4 cm taller and the hood would have sat around its chin.
 *
 * The face direction and the hood rim in particular are shared: `buildDrowHood`
 * sweeps the cowl to the rim, and `buildDrowFur` puts the trim band on the same
 * rim. They read the same function so the two cannot drift apart.
 */

/**
 * Where the cowl opening points: forward and tilted down, so the hood frames the
 * face rather than staring at the horizon.
 */
const FACE_DIR_RAW = [0, -0.28, 0.96];

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * @param {ReturnType<import('../characterBones.js').createRig>} rig
 */
export function createAnatomy(rig) {
  const head = rig.profile.headScale;
  const { headY, neckY, chestY, pelvisY, hipY, kneeY, ankleY } = rig.anchors;

  /** Half-height of the skull ellipsoid. */
  const skullHalfHeight = 0.105 * head;
  const centre = [0, headY + skullHalfHeight, 0.005 * head];
  const radii = [0.089 * head, skullHalfHeight, 0.096 * head];
  const faceDir = normalize3(FACE_DIR_RAW);

  /** Distance from the skull centre out to the cowl's opening plane. */
  const rimForward = 0.105 * head;
  const rimHalfWidth = 0.152 * head;
  const rimHalfHeight = 0.163 * head;

  /**
   * Face-opening rim point at parameter `s` (0 = crown, 0.5 = under the chin).
   *
   * U spans the rim horizontally, W vertically, both perpendicular to the face
   * direction.
   */
  function hoodRimPoint(s, out) {
    const a = s * Math.PI * 2;
    const ux = 1; const uy = 0; const uz = 0;
    const wx = faceDir[1] * uz - faceDir[2] * uy;
    const wy = faceDir[2] * ux - faceDir[0] * uz;
    const wz = faceDir[0] * uy - faceDir[1] * ux;
    const cx = centre[0] + faceDir[0] * rimForward;
    const cy = centre[1] + faceDir[1] * rimForward;
    const cz = centre[2] + faceDir[2] * rimForward;
    out[0] = cx + ux * rimHalfWidth * Math.sin(a) + wx * rimHalfHeight * Math.cos(a);
    out[1] = cy + uy * rimHalfWidth * Math.sin(a) + wy * rimHalfHeight * Math.cos(a);
    out[2] = cz + uz * rimHalfWidth * Math.sin(a) + wz * rimHalfHeight * Math.cos(a);
    return out;
  }

  /** Where the cowl meets the shoulders. */
  const hoodBaseY = chestY + 0.092;
  function hoodBasePoint(s, out) {
    const a = s * Math.PI * 2;
    out[0] = 0.212 * Math.sin(a);
    out[1] = hoodBaseY;
    out[2] = -0.012 - 0.182 * Math.cos(a);
    return out;
  }

  return Object.freeze({
    rig,
    head: Object.freeze({
      centre: Object.freeze(centre),
      radii: Object.freeze(radii),
      faceDir: Object.freeze(faceDir),
      scale: head,
    }),
    hood: Object.freeze({
      rimPoint: hoodRimPoint,
      basePoint: hoodBasePoint,
      baseY: hoodBaseY,
    }),
    /**
     * The torso tube, as fractions of the span from just under the waistband to
     * just under the collar. The radii are the source figure's, scaled by the
     * profile — that is the whole of "slimmer".
     */
    torso: Object.freeze({
      bottomY: pelvisY - 0.07,
      topY: neckY - 0.02,
      rows: Object.freeze([
        // t, rx, rz — a waist, a ribcage, a shoulder line, a collar.
        Object.freeze([0.0000, 0.150, 0.120]),
        Object.freeze([0.1786, 0.142, 0.113]),
        Object.freeze([0.3214, 0.134, 0.106]),
        Object.freeze([0.4643, 0.140, 0.109]),
        Object.freeze([0.6071, 0.156, 0.118]),
        Object.freeze([0.7500, 0.172, 0.126]),
        Object.freeze([0.8929, 0.176, 0.126]),
        Object.freeze([1.0000, 0.160, 0.116]),
      ]),
    }),
    belt: Object.freeze({
      ys: Object.freeze([pelvisY + 0.005, pelvisY + 0.045, pelvisY + 0.085]),
    }),
    neck: Object.freeze({
      ys: Object.freeze([neckY - 0.04, neckY + 0.04, neckY + 0.10]),
    }),
    /** The scarf across the lower face. Offsets ride the skull's scale. */
    scarf: Object.freeze({
      ys: Object.freeze([headY + 0.010 * head, headY + 0.050 * head, headY + 0.088 * head]),
    }),
    leg: Object.freeze({
      hipY: hipY + 0.005,
      kneeY,
      ankleY,
      /** Where the trouser meets the boot shaft. */
      cuffY: ankleY + 0.010,
    }),
  });
}
