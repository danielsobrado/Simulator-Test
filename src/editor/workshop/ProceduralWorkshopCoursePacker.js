/**
 * Constrained interval packing for one masonry course.
 *
 * Implements
 * docs/plans/procedural-medieval-construction/04-masonry-and-stone-generation.md
 * §4 (exact fill without drift), §5 (joint staggering against forbidden bands
 * from the course below) and §6 (interval packing).
 *
 * Added 2026-07-25. Before this, both wall generators drew an unconstrained
 * random width per stone and then clipped or truncated it against the remaining
 * span — precisely what §6 rules out ("Do not use unconstrained random widths
 * followed by clipping"). The classic generator additionally faked its running
 * bond by shrinking only the first stone of alternate courses, so joints lined up
 * vertically everywhere else.
 *
 * Pure data: no Three.js, no geometry. Deterministic given the same `random`
 * stream, and it consumes a fixed number of draws per course so callers keep
 * their own downstream determinism.
 */

/** Widths are drawn within this fraction of the style's target width. */
const WIDTH_SPREAD_LOW = 0.72;
const WIDTH_SPREAD_HIGH = 1.28;

/**
 * A joint is "forbidden" within this fraction of a target width of a joint in the
 * course below. Wide enough to read as a broken bond, narrow enough that a course
 * can always satisfy it.
 */
const JOINT_BAND_RATIO = 0.25;

/** Coverage tolerance for the §6 step-9 validation. */
const COVERAGE_EPSILON = 1e-6;

/**
 * Forbidden bands are widened by this much before solving, so a relocated joint
 * lands strictly *outside* the band rather than exactly on its edge. Without it,
 * joints settle at precisely `band` away and floating-point error decides whether
 * a "is this joint clear?" comparison passes.
 */
const BAND_EPSILON = 1e-6;

/**
 * Move a joint to the nearest position in `[low, high]` that is at least `band`
 * away from every joint in the course below.
 *
 * Solved by subtracting the forbidden intervals from the legal window and taking
 * the nearest surviving point, rather than nudging past one band at a time —
 * stepping out of one band frequently steps straight into another.
 *
 * When the bands cover the whole legal window there is no lawful position; the
 * clamped original is returned. That is the deterministic fallback §5 asks for,
 * and it is why callers must not assume perfect staggering on narrow spans.
 */
function nudgeOutOfBands(joint, bands, band, low, high) {
  const clamped = Math.min(high, Math.max(low, joint));
  const margin = band + BAND_EPSILON;
  const blocking = bands
    .map((centre) => [centre - margin, centre + margin])
    .filter(([start, end]) => end > low && start < high)
    .sort((a, b) => a[0] - b[0]);
  if (blocking.length === 0) return clamped;

  // Allowed sub-intervals are the gaps between merged forbidden intervals.
  const allowed = [];
  let cursor = low;
  for (const [start, end] of blocking) {
    if (start > cursor) allowed.push([cursor, Math.min(start, high)]);
    cursor = Math.max(cursor, end);
    if (cursor >= high) break;
  }
  if (cursor < high) allowed.push([cursor, high]);
  if (allowed.length === 0) return clamped;

  let best = clamped;
  let bestDistance = Infinity;
  for (const [start, end] of allowed) {
    if (end < start) continue;
    const candidate = Math.min(end, Math.max(start, clamped));
    const distance = Math.abs(candidate - clamped);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Pack one course into `[-span / 2, +span / 2]`.
 *
 * @param {object} options
 * @param {number} options.span total width to fill
 * @param {number} options.targetWidth style target stone width
 * @param {number} options.minWidth smallest stone the style permits
 * @param {() => number} options.random seeded PRNG in [0, 1)
 * @param {number[]} [options.forbiddenJoints] interior joint positions of the course below
 * @returns {{ stones: {center: number, width: number}[], joints: number[] }}
 *   `joints` are this course's interior joints, to feed the course above.
 */
export function packCourse({
  span,
  targetWidth,
  minWidth,
  random,
  forbiddenJoints = [],
}) {
  const half = span / 2;
  if (span <= minWidth) {
    return { stones: [{ center: 0, width: span }], joints: [] };
  }

  // §6.3 estimate the stone count, then §6.4 draw candidate widths.
  const count = Math.max(1, Math.round(span / targetWidth));
  const weights = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const weight = WIDTH_SPREAD_LOW + random() * (WIDTH_SPREAD_HIGH - WIDTH_SPREAD_LOW);
    weights.push(weight);
    total += weight;
  }

  // §6.5 and §4: scale the candidates so they fill the interval exactly. Nothing
  // is clipped, so no stone is ever truncated by the wall edge and there is no
  // accumulated floating-point drift.
  let cursor = -half;
  const joints = [];
  for (let index = 0; index < count - 1; index += 1) {
    cursor += (weights[index] / total) * span;
    joints.push(cursor);
  }

  // §5 joint staggering. One bounded pass, keeping each joint far enough from its
  // neighbours that both adjacent stones stay legal.
  const band = targetWidth * JOINT_BAND_RATIO;
  for (let index = 0; index < joints.length; index += 1) {
    const previous = index === 0 ? -half : joints[index - 1];
    const next = index === joints.length - 1 ? half : joints[index + 1];
    const low = previous + minWidth;
    const high = next - minWidth;
    if (low >= high) continue;
    joints[index] = nudgeOutOfBands(
      Math.min(high, Math.max(low, joints[index])),
      forbiddenJoints,
      band,
      low,
      high,
    );
  }

  // §6.8: emit no slivers. Dissolve any sub-minimum stone by dropping one of the
  // joints bordering it, which merges it into a neighbour. Each pass removes
  // exactly one joint, so this always terminates; the span endpoints are never
  // removed, so coverage stays exact.
  const bounds = [-half, ...joints, half];
  for (let guard = bounds.length; guard > 0; guard -= 1) {
    let merged = false;
    for (let index = 0; index < bounds.length - 1; index += 1) {
      if (bounds[index + 1] - bounds[index] >= minWidth) continue;
      const lastIndex = bounds.length - 1;
      if (index + 1 < lastIndex) bounds.splice(index + 1, 1);
      else if (index > 0) bounds.splice(index, 1);
      else break; // one stone spanning the interval; nothing left to merge
      merged = true;
      break;
    }
    if (!merged) break;
  }

  const stones = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    stones.push({
      center: (bounds[index] + bounds[index + 1]) / 2,
      width: bounds[index + 1] - bounds[index],
    });
  }

  // §6.9 validate exact coverage.
  const covered = stones.reduce((sum, stone) => sum + stone.width, 0);
  if (Math.abs(covered - span) > COVERAGE_EPSILON * Math.max(1, span)) {
    throw new Error(
      `Masonry course packing covered ${covered} of ${span}; coverage must be exact.`,
    );
  }

  return { stones, joints: bounds.slice(1, -1) };
}
