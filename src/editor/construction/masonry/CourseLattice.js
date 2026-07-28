import { mixSeed } from '../../workshop/ProceduralRandom.js';

/**
 * The three shape rules that make a drawn wall read as laid masonry.
 *
 * Bed joints ramp along the wall, head joints lean, and a coarse grid cell splits
 * recursively into a mixture of big and small stones. All three are pure
 * functions of the wall-global arc coordinate, so the two stones either side of
 * any joint — including one that falls on a module boundary — resolve *the same*
 * corner positions and meet with no gap. That sharing is the whole reason this
 * lives apart from the packer's per-stone hashing.
 *
 * Three.js-free by construction: it runs inside the compiler worker alongside
 * `CurvedCoursePacker`.
 */

const BED_HASH = 0x3c6ef372;
const TILT_HASH = 0xa54ff53a;
const SPLIT_HASH = 0x510e527f;

/** Arc positions are hashed at 0.1 mm, matching `ConstructionPlanner`'s hasher. */
const POSITION_QUANTUM = 10000;

function lane(hash, shift) {
  return ((hash >>> shift) & 255) / 255;
}

/** A position-keyed hash: both stones at a joint must reach the same value. */
function hashAt(seed, domain, s, discriminator) {
  const key = Math.round(s * POSITION_QUANTUM) ^ Math.imul(discriminator + 1, 0x9e3779b1);
  return mixSeed(seed ^ domain, key);
}

/**
 * Ceiling on the bed wave, as a fraction of course height.
 *
 * Two adjacent bed lines wave independently, so between them a course can lose up
 * to twice the amplitude. At 0.2 the thinnest a course ever gets is 60% of
 * nominal, which keeps bed lines from crossing however the phases land.
 */
export const MAX_BED_AMPLITUDE = 0.2;

/** Under this a split leaf reads as a chip rather than a stone. */
export const MIN_SPLIT_HEIGHT = 0.14;

/**
 * Bed joints that ramp along the wall instead of running dead level.
 *
 * The reference offsets every point vertically from a ramp over its X position
 * plus `rand(loop iteration)`; the same thing here is a pair of sinusoids per
 * course whose wavelength, phase and amplitude are hashed from the course index.
 *
 * Two properties are load-bearing, for the same reason `CurvedCoursePacker`'s
 * `boundaryOffset` has them:
 *
 * - It depends only on `(seed, course, s)` in **wall-global** arc coordinates and
 *   never on `targetWidth`. That value is curvature-limited *per module*, so
 *   scaling by it would make the two modules either side of a bend disagree about
 *   where the bed line runs and tear the seam open.
 * - Course 0 returns 0. The bottom bed line is the ground line, and a wall that
 *   waved there would float off the terrain.
 *
 * @returns {(course: number, s: number) => number} offset in metres.
 */
export function createBedField(seed, courseHeight, { amplitude = 0.14, waves = 2 } = {}) {
  const budget = Math.max(0, Math.min(MAX_BED_AMPLITUDE, amplitude)) * courseHeight;
  const perWave = budget / Math.max(1, waves);
  const cache = new Map();

  const wavesFor = (course) => {
    const cached = cache.get(course);
    if (cached) return cached;
    const built = [];
    for (let wave = 0; wave < waves; wave += 1) {
      const hash = mixSeed(seed ^ BED_HASH, course * 8 + wave);
      built.push({
        // 3 m to 9 m: shorter than a module, so the ramp is visible within one
        // build unit rather than reading as the whole wall leaning.
        frequency: (Math.PI * 2) / (3 + lane(hash, 8) * 6),
        phase: lane(hash, 0) * Math.PI * 2,
        amplitude: perWave * (0.55 + lane(hash, 16) * 0.45),
      });
    }
    cache.set(course, built);
    return built;
  };

  return (course, s) => {
    if (course <= 0) return 0;
    let offset = 0;
    for (const wave of wavesFor(course)) {
      offset += wave.amplitude * Math.sin(s * wave.frequency + wave.phase);
    }
    return offset;
  };
}

/**
 * How far a head joint leans, in metres, measured bottom-to-top.
 *
 * Keyed on the joint's own arc position rather than on a stone index: the two
 * stones meeting at a joint must derive the *same* lean or the wall opens a gap
 * there. That also means a joint landing on a module boundary needs no special
 * case — both modules hash the same position and agree.
 *
 * The course index enters the hash so a joint does not lean the same way all the
 * way up the wall, but never the stone index.
 */
export function jointTilt(seed, course, jointS, courseHeight, amount) {
  if (!(amount > 0)) return 0;
  return (lane(hashAt(seed, TILT_HASH, jointS, course), 8) - 0.5) * 2 * amount * courseHeight;
}

/**
 * Recursively split a base cell, horizontally or vertically.
 *
 * The reference grids the wall coarsely and *then* splits each polygon at random,
 * which is what puts a big block beside two stacked small ones. Doing it in that
 * order — rather than gridding finely to begin with — widens the size
 * distribution without moving the stone count, because the coarse grid is sized
 * to compensate (see `ConstructionStyleCatalog`).
 *
 * Seeded on the cell's own quantised position, never on a running counter, so
 * adding an opening or dropping a ruin stone cannot re-roll the splits elsewhere
 * in the wall.
 *
 * Cells carry `v0`/`v1`, the fractional band they occupy inside their course, so
 * a horizontal split produces a partial bed line that stays between the course's
 * own two bed lines and can never cross them.
 *
 * @returns leaf cells `{ courseIndex, s0, s1, v0, v1 }`, in order along the wall.
 */
export function splitCell(cell, {
  seed,
  chance = 0.4,
  maxDepth = 2,
  minWidth = 0.2,
  minHeight = MIN_SPLIT_HEIGHT,
  courseHeight = 1,
}) {
  const leaves = [];

  const visit = (node, depth) => {
    if (depth >= maxDepth || !(chance > 0)) {
      leaves.push(node);
      return;
    }
    const width = node.s1 - node.s0;
    const height = (node.v1 - node.v0) * courseHeight;
    const hash = hashAt(
      seed,
      SPLIT_HASH,
      (node.s0 + node.s1) / 2,
      // The band discriminator separates the two children of a horizontal split,
      // which share an arc centre and would otherwise hash identically.
      node.courseIndex * 8 + Math.round((node.v0 + node.v1) * 4),
    );
    // Halving per level keeps the leaf-count expectation at 1 + c + c^2, which is
    // what the style catalog's base cell size is calibrated against.
    if (lane(hash, 8) >= chance / (depth + 1)) {
      leaves.push(node);
      return;
    }

    // Prefer splitting the long axis, or repeated splits produce splinters.
    const vertical = lane(hash, 16) < (width >= height ? 0.66 : 0.34);
    if (vertical) {
      const mid = node.s0 + width * (0.35 + lane(hash, 24) * 0.3);
      if (mid - node.s0 < minWidth || node.s1 - mid < minWidth) {
        leaves.push(node);
        return;
      }
      visit({ ...node, s1: mid }, depth + 1);
      visit({ ...node, s0: mid }, depth + 1);
      return;
    }

    const fraction = 0.4 + lane(hash, 24) * 0.2;
    const mid = node.v0 + (node.v1 - node.v0) * fraction;
    if ((mid - node.v0) * courseHeight < minHeight
      || (node.v1 - mid) * courseHeight < minHeight) {
      leaves.push(node);
      return;
    }
    visit({ ...node, v1: mid }, depth + 1);
    visit({ ...node, v0: mid }, depth + 1);
  };

  visit({ ...cell, v0: cell.v0 ?? 0, v1: cell.v1 ?? 1 }, 0);
  return leaves;
}

/**
 * Resolve one leaf cell into the four corners of its stone face.
 *
 * A corner's height is the bed line evaluated **at that corner's own arc
 * position**, not at the cell centre — that is what carries the ramp continuously
 * across a joint, because the neighbour's corner sits at the same position and
 * evaluates the same function.
 *
 * Top corners are clamped to the wall body's own height so a wave near the crown
 * cannot push field masonry up through the coping. `ceilingAt` comes from
 * `WallTopProfile`, which is wall-global, so both modules at a seam clamp alike.
 *
 * The returned corners are anchored on the cell's *arc* centre in X — not on the
 * face bounding box — so `anchorS` remains the exact midpoint of the cell's
 * packed footprint and `anchorS ± packedWidth / 2` still recovers the cell edges
 * however far the joints lean. Y is anchored on the bounding box, which has no
 * such contract.
 *
 * @returns `{ corners, anchorS, anchorY, width, height }` with `corners`
 *   counter-clockwise from bottom-left, relative to `(anchorS, anchorY)`, or null
 *   if the cell collapsed under the ceiling clamp.
 */
export function resolveCellCorners(cell, {
  bedOffset,
  courseHeight,
  tiltLeft = 0,
  tiltRight = 0,
  ceilingAt = null,
  minHeight = 0.08,
}) {
  const bedAt = (course, s) => course * courseHeight + bedOffset(course, s);

  const corner = (v, jointS, tilt) => {
    const s = jointS + tilt * (v - 0.5);
    const bottom = bedAt(cell.courseIndex, s);
    const top = bedAt(cell.courseIndex + 1, s);
    let y = bottom + (top - bottom) * v;
    if (ceilingAt) y = Math.min(y, ceilingAt(s));
    return [s, Math.max(0, y)];
  };

  const points = [
    corner(cell.v0, cell.s0, tiltLeft),
    corner(cell.v0, cell.s1, tiltRight),
    corner(cell.v1, cell.s1, tiltRight),
    corner(cell.v1, cell.s0, tiltLeft),
  ];

  let minS = Infinity;
  let maxS = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [s, y] of points) {
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const width = maxS - minS;
  const height = maxY - minY;
  // The ceiling clamp can flatten a top-course leaf to nothing.
  if (!(height > minHeight) || !(width > 1e-6)) return null;

  const anchorS = (cell.s0 + cell.s1) / 2;
  const anchorY = (minY + maxY) / 2;
  return {
    corners: points.map(([s, y]) => [s - anchorS, y - anchorY]),
    anchorS,
    anchorY,
    width,
    height,
  };
}

/**
 * Scale a face ring about its own bounding-box centre.
 *
 * About the centre rather than about the anchor, so opening the mortar joint —
 * or damping the shape jitter — shrinks the stone in place instead of also
 * sliding it along the wall.
 */
export function scaleCorners(corners, scaleX, scaleY) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return corners.map(([x, y]) => [
    centerX + (x - centerX) * scaleX,
    centerY + (y - centerY) * scaleY,
  ]);
}
