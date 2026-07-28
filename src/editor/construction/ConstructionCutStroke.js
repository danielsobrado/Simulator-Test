import {
  closestPointOnCubicBezierPath,
  createCubicBezierPathFromStroke,
  intersectCubicBezierPaths,
} from './curve/CubicBezierPath.js';

/**
 * "Draw a path through a wall and the engine carves an arch."
 *
 * There is no road or path system in this codebase to hook into — nothing
 * anywhere draws a spatial path — so rather than build one, this is a modifier
 * on the freehand gesture already used to draw walls. Hold Alt while dragging
 * and the stroke becomes a *cut* instead of a wall.
 *
 * A stroke that **crosses** a wall makes an arch; one that **ends against** it
 * makes a door. That covers "through or against" without a second tool.
 */

export const CUT_ARCH_WIDTH = 2.2;
export const CUT_DOOR_WIDTH = 1.3;
/** How close a stroke's end must come to a centreline to count as abutting. */
const ABUT_MARGIN = 0.3;
/** Headroom left between an opening's crown and the wall top above it. */
const CROWN_CLEARANCE = 0.3;

function distanceToPath(path, point) {
  const closest = closestPointOnCubicBezierPath(path, point);
  return closest ? closest.distance : Infinity;
}

/**
 * Resolve a cut stroke against the constructions it touches.
 *
 * @param strokePoints raw canonical `{x, z}` points from the drag.
 * @param records normalized construction records to test against.
 * @param heightAt `(record, s) => number` wall-top height, for sizing the arch.
 * @returns `[{ constructionId, segmentId, arcFraction, kind, width, height }]`
 */
export function resolveCutStroke(strokePoints, records, {
  heightAt = null,
  arcTableFor = null,
  archWidth = CUT_ARCH_WIDTH,
  doorWidth = CUT_DOOR_WIDTH,
} = {}) {
  if (!Array.isArray(strokePoints) || strokePoints.length < 2) return [];
  const stroke = createCubicBezierPathFromStroke(strokePoints, {
    anchorPrefix: 'cut-anchor',
    segmentPrefix: 'cut-segment',
    simplifyTolerance: 0.25,
  });

  const cuts = [];
  for (const record of records) {
    if (record.path.type !== 'cubicBezier') continue;
    const arcTable = arcTableFor?.(record.id) ?? null;
    const half = record.dimensions.thickness / 2;

    const crossings = intersectCubicBezierPaths(stroke, record.path);
    for (const crossing of crossings) {
      cuts.push(buildCut(record, arcTable, crossing, 'arch', archWidth, heightAt));
    }

    if (crossings.length > 0) continue;
    // No crossing: does either end of the stroke stop against the wall?
    for (const end of [strokePoints[0], strokePoints.at(-1)]) {
      if (distanceToPath(record.path, end) > half + ABUT_MARGIN) continue;
      const closest = closestPointOnCubicBezierPath(record.path, end);
      cuts.push(buildCut(record, arcTable, closest, 'door', doorWidth, heightAt));
      break;
    }
  }
  return cuts.filter(Boolean);
}

/**
 * Resolve where on the wall a hit lands.
 *
 * Crossings from `intersectCubicBezierPaths` expose `rightDistance` (sample
 * arc length on the wall), not a Bézier `t`. Feeding a missing `t` as 0 put
 * every arch at the start of the crossed segment.
 */
function hitPlacement(record, arcTable, hit) {
  if (arcTable && Number.isFinite(hit?.rightDistance)) {
    return arcTable.fromArc(hit.rightDistance);
  }
  if (arcTable && Number.isFinite(hit?.t) && hit.segmentId) {
    return {
      segmentId: hit.segmentId,
      arcFraction: arcTable.arcFractionForParameter(hit.segmentId, hit.t),
    };
  }
  if (Number.isFinite(hit?.x) && Number.isFinite(hit?.z)) {
    const closest = closestPointOnCubicBezierPath(record.path, { x: hit.x, z: hit.z });
    if (!closest) return null;
    return {
      segmentId: closest.segmentId,
      arcFraction: arcTable
        ? arcTable.arcFractionForParameter(closest.segmentId, closest.t)
        : closest.t,
    };
  }
  if (hit?.segmentId != null && Number.isFinite(hit?.t)) {
    return { segmentId: hit.segmentId, arcFraction: hit.t };
  }
  return null;
}

function buildCut(record, arcTable, hit, kind, width, heightAt) {
  const placement = hitPlacement(record, arcTable, hit);
  if (!placement?.segmentId) return null;
  const { segmentId, arcFraction } = placement;
  const s = arcTable ? arcTable.toArc(segmentId, arcFraction) : 0;
  const crown = heightAt ? heightAt(record, s) : record.dimensions.height;
  const height = Math.max(0.6, Math.min(crown - CROWN_CLEARANCE, crown * 0.78));
  return {
    constructionId: record.id,
    segmentId,
    arcFraction,
    kind,
    width: Math.min(width, Math.max(0.4, crown * 0.9)),
    height,
  };
}

/**
 * A new window close to an existing one on the same segment joins its group and
 * gets a shared surround. Holding Left Ctrl passes `link: false` and keeps them
 * separate, mirroring the reference game.
 */
export const WINDOW_LINK_ARC = 1.6;

export function resolveWindowGroup(record, { segmentId, arcFraction }, arcTable, { link = true } = {}) {
  if (!link || !arcTable) return null;
  const s = arcTable.toArc(segmentId, arcFraction);
  for (const feature of record.features) {
    if (feature.kind !== 'window' || feature.segmentId !== segmentId) continue;
    const other = arcTable.toArc(feature.segmentId, feature.arcFraction);
    if (Math.abs(other - s) <= WINDOW_LINK_ARC) {
      return feature.group ?? `group-${feature.id}`;
    }
  }
  return null;
}
