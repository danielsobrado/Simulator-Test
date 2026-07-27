import { MAX_CONSTRUCTION_TOP_POINTS } from '../ConstructionSchema.js';
import { createWallTopProfile } from './WallTopProfile.js';

/**
 * The raise/lower edit, as a pure function over `record.top`.
 *
 * Kept out of the controller so the falloff, the bracketing and the pruning are
 * testable without a renderer or an input event.
 */

export const TOP_STEP = 0.25;
export const TOP_RADIUS_DEFAULT = 3;
export const TOP_RADIUS_RANGE = Object.freeze([1, 12]);
export const TOP_HEIGHT_RANGE = Object.freeze([0.5, 30]);

/** Control points written per edit, including the two bracket points. */
const SAMPLES_PER_EDIT = 8;
/** A point closer than this to the curve the others already describe is noise. */
const PRUNE_TOLERANCE = 0.03;
/**
 * Only compact once the profile approaches its cap.
 *
 * Pruning after every edit erodes the shape: one step is 0.25 m tall, so a
 * tolerance anywhere near that will happily delete the peak the user just made
 * because its neighbours come close enough. Deferring until the list is nearly
 * full keeps ordinary editing lossless and pays the fidelity cost only when
 * there is no room left.
 */
const PRUNE_THRESHOLD = Math.floor(MAX_CONSTRUCTION_TOP_POINTS * 0.75);

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/**
 * Brush falloff: 1 at the centre, **exactly** 0 at `radius`.
 *
 * A plain Gaussian at sigma = radius/2 still carries 13.5% of its peak at the
 * edge, which would raise the bracket points along with everything else — and
 * the brackets are the whole mechanism confining the edit, since the profile
 * clamps to its outermost point. Subtracting the edge value and renormalising
 * gives compact support while keeping the Gaussian's shape in the middle
 * (~55% at half the radius), so the brush still feels soft.
 */
export function falloffWeight(distance, radius) {
  const span = Math.abs(distance);
  if (span >= radius) return 0;
  const sigma = Math.max(1e-6, radius / 2);
  const edge = Math.exp(-(radius * radius) / (2 * sigma * sigma));
  const raw = Math.exp(-(span * span) / (2 * sigma * sigma));
  return (raw - edge) / (1 - edge);
}

/**
 * Drop control points the remaining ones already describe.
 *
 * Without this the list grows by `SAMPLES_PER_EDIT` per keypress and hits the
 * 64-point cap in a few seconds of holding an arrow key.
 */
export function pruneTopProfile(record, arcTable, tolerance = PRUNE_TOLERANCE) {
  const points = record.top.profile;
  if (points.length <= 2) return points;

  const kept = [...points];
  // Walk from the interior outward; the outermost points define the clamp
  // regions either side and are never candidates.
  let index = 1;
  while (index < kept.length - 1) {
    if (kept.length <= 2) break;
    const candidate = kept[index];
    const without = kept.filter((_, position) => position !== index);
    const probe = createWallTopProfile(
      { ...record, top: { ...record.top, style: 'flat', profile: without } },
      arcTable,
    );
    const s = arcTable.toArc(candidate.segmentId, candidate.arcFraction);
    if (Math.abs(probe.heightAt(s) - candidate.height) <= tolerance) {
      kept.splice(index, 1);
      continue;
    }
    index += 1;
  }
  return kept;
}

/**
 * Apply one raise or lower step centred on an arc position.
 *
 * Writes bracketing control points at the falloff edge at their *current*
 * height. Those brackets are what confine the edit: the profile clamps outside
 * its outermost point, so without them a lone control point would set the
 * height of the entire wall.
 *
 * @returns the new `top`, or `null` when nothing changed.
 */
export function applyTopEdit(record, arcTable, {
  centre,
  direction,
  radius = TOP_RADIUS_DEFAULT,
  step = TOP_STEP,
}) {
  if (!Number.isFinite(centre) || !direction) return null;
  const profile = createWallTopProfile(record, arcTable);
  const total = arcTable.totalLength;
  const low = Math.max(0, centre - radius);
  const high = Math.min(total, centre + radius);
  if (!(high > low)) return null;

  const merged = new Map();
  const keyOf = (segmentId, arcFraction) => `${segmentId}:${arcFraction.toFixed(5)}`;
  for (const point of record.top.profile) {
    merged.set(keyOf(point.segmentId, point.arcFraction), { ...point });
  }

  let changed = false;
  for (let sample = 0; sample <= SAMPLES_PER_EDIT; sample += 1) {
    const s = low + ((high - low) * sample) / SAMPLES_PER_EDIT;
    const { segmentId, arcFraction } = arcTable.fromArc(s);
    const key = keyOf(segmentId, arcFraction);
    const existing = merged.get(key);
    const current = existing ? existing.height : profile.heightAt(s);
    const weight = falloffWeight(s - centre, radius);
    const height = clamp(
      current + direction * step * weight,
      TOP_HEIGHT_RANGE[0],
      TOP_HEIGHT_RANGE[1],
    );
    if (Math.abs(height - current) > 1e-9) changed = true;
    merged.set(key, { segmentId, arcFraction, height });
  }
  if (!changed) return null;

  const profilePoints = [...merged.values()].sort((a, b) => (
    arcTable.toArc(a.segmentId, a.arcFraction) - arcTable.toArc(b.segmentId, b.arcFraction)
  ));
  const next = { ...record.top, profile: profilePoints };
  const pruned = profilePoints.length > PRUNE_THRESHOLD
    ? pruneTopProfile({ ...record, top: next }, arcTable)
    : profilePoints;
  if (pruned.length > MAX_CONSTRUCTION_TOP_POINTS) {
    // Refuse rather than truncate: dropping arbitrary points would move parts
    // of the wall the user never touched.
    return null;
  }
  return { ...next, profile: pruned };
}

/** The palette's Flat Top action: discard the profile, keep the mean height. */
export function flattenTop(record, arcTable, { samples = 64 } = {}) {
  const profile = createWallTopProfile(record, arcTable);
  let total = 0;
  for (let index = 0; index <= samples; index += 1) {
    total += profile.heightAt((arcTable.totalLength * index) / samples);
  }
  return {
    style: 'flat',
    base: clamp(total / (samples + 1), TOP_HEIGHT_RANGE[0], TOP_HEIGHT_RANGE[1]),
    profile: [],
  };
}
