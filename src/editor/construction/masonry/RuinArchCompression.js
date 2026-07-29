/**
 * Compression-aware support for ruined opening arches.
 *
 * Group presence of any jamb is not enough: springs must bear on a jamb crown
 * or strong field masonry, and voussoirs survive only along a continuous
 * compression path from the abutments (both sides for a closed ring / keystone,
 * one side plus field rest for a short partial stub).
 */

import {
  CONSTRUCTION_SUPPORT_ROLE,
  RUIN_REMOVAL_REASON,
} from './ConstructionSupportRoles.js';
import { coverageWithinSpan, intervalOverlap } from './RuinSupportIntervals.js';

function compareArchOrder(a, b) {
  const ordinal = (a.support?.archOrdinal ?? 0) - (b.support?.archOrdinal ?? 0);
  if (ordinal !== 0) return ordinal;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function compareJambOrder(a, b) {
  const ordinal = (a.support?.jambOrdinal ?? 0) - (b.support?.jambOrdinal ?? 0);
  if (ordinal !== 0) return ordinal;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function unitCentre(stone) {
  const span = stone.support?.span;
  if (span) return (span[0] + span[1]) * 0.5;
  return stone.s ?? 0;
}

function verticalContact(upper, lower, tolerance) {
  const gap = upper.support.bottom - lower.support.top;
  return gap >= -tolerance && gap <= tolerance;
}

function spanContact(a, b, pad) {
  return intervalOverlap(
    a.support.span[0] - pad,
    a.support.span[1] + pad,
    b.support.span[0],
    b.support.span[1],
  ) > 0;
}

function ringContact(a, b, profile) {
  const pad = Math.max(0.04, profile.openings.voussoirContactRatio * 0.5);
  if (!spanContact(a, b, pad)) return false;
  // Voussoirs along a ring touch laterally more than stacked beds. Near the
  // spring they can be nearly vertical — allow near-touch in Y as well as
  // true overlap so compression does not die on a zero-overlap abut.
  const verticalOverlap = intervalOverlap(
    a.support.bottom,
    a.support.top,
    b.support.bottom,
    b.support.top,
  );
  if (verticalOverlap > 0) return true;
  const gap = Math.max(
    0,
    Math.max(a.support.bottom, b.support.bottom)
      - Math.min(a.support.top, b.support.top),
  );
  return gap <= Math.max(0.05, profile.support.verticalTolerance);
}

function topJamb(jambs, survivors) {
  const ordered = [...jambs]
    .filter((stone) => survivors.has(stone._ruinId))
    .sort(compareJambOrder);
  return ordered.length > 0 ? ordered[ordered.length - 1] : null;
}

function springHasJambBearing(spring, jamb, profile) {
  if (!spring || !jamb) return false;
  if (!verticalContact(spring, jamb, profile.support.verticalTolerance)) return false;
  // Springs often abut the jamb crown edge-to-edge; allow a small touch pad.
  const pad = Math.max(0.08, profile.support.minimumAbsoluteOverlap);
  return spanContact(spring, jamb, pad);
}

function springHasFieldBearing(spring, fieldPool, survivors, profile) {
  if (!spring) return false;
  const supports = [];
  for (const lower of fieldPool) {
    if (!survivors.has(lower._ruinId)) continue;
    if (!verticalContact(spring, lower, profile.support.verticalTolerance)) continue;
    if (!spanContact(spring, lower, profile.support.maximumCantilever)) continue;
    supports.push(lower.support.span);
  }
  const coverage = coverageWithinSpan(
    spring.support.span[0],
    spring.support.span[1],
    supports,
  );
  return coverage.ratio >= profile.openings.springFieldSupportRatio
    && coverage.leftOverhang <= profile.support.maximumCantilever
    && coverage.rightOverhang <= profile.support.maximumCantilever;
}

function fieldRestRatio(stone, fieldPool, survivors, profile) {
  const supports = [];
  for (const lower of fieldPool) {
    if (!survivors.has(lower._ruinId)) continue;
    if (!verticalContact(stone, lower, profile.support.verticalTolerance)) continue;
    supports.push(lower.support.span);
  }
  return coverageWithinSpan(
    stone.support.span[0],
    stone.support.span[1],
    supports,
  );
}

/**
 * Identify left/right springs and resolve which arch units remain in compression.
 */
export function resolveArchCompression({
  arches,
  leftJambs = [],
  rightJambs = [],
  fieldPool = [],
  survivors,
  profile,
}) {
  const ordered = [...arches].sort(compareArchOrder);
  const remove = new Map();
  if (ordered.length === 0) {
    return {
      remove,
      leftSpringSupported: false,
      rightSpringSupported: false,
      kept: 0,
    };
  }

  const nonKey = ordered.filter(
    (unit) => unit.support?.role !== CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
  );
  const centres = (nonKey.length > 0 ? nonKey : ordered).map(unitCentre);
  const openingCentre = centres.reduce((sum, value) => sum + value, 0) / centres.length;

  const leftHalf = nonKey.filter((unit) => unitCentre(unit) <= openingCentre);
  const rightHalf = nonKey.filter((unit) => unitCentre(unit) >= openingCentre);
  let leftSpring = leftHalf[0] ?? nonKey[0] ?? ordered[0];
  let rightSpring = rightHalf[rightHalf.length - 1]
    ?? nonKey[nonKey.length - 1]
    ?? ordered[ordered.length - 1];
  if (leftSpring === rightSpring && ordered.length > 1) {
    leftSpring = ordered[0];
    rightSpring = ordered[ordered.length - 1];
  }

  const leftJamb = topJamb(leftJambs, survivors);
  const rightJamb = topJamb(rightJambs, survivors);
  const leftSpringSupported = survivors.has(leftSpring._ruinId) && (
    springHasJambBearing(leftSpring, leftJamb, profile)
    || springHasFieldBearing(leftSpring, fieldPool, survivors, profile)
  );
  const rightSpringSupported = survivors.has(rightSpring._ruinId) && (
    springHasJambBearing(rightSpring, rightJamb, profile)
    || springHasFieldBearing(rightSpring, fieldPool, survivors, profile)
  );

  const reachLeft = new Set();
  const reachRight = new Set();
  const leftIndex = ordered.indexOf(leftSpring);
  const rightIndex = ordered.indexOf(rightSpring);

  if (leftSpringSupported && leftIndex >= 0) {
    reachLeft.add(leftSpring._ruinId);
    for (let index = leftIndex + 1; index < ordered.length; index += 1) {
      const prev = ordered[index - 1];
      const unit = ordered[index];
      if (!reachLeft.has(prev._ruinId)) break;
      if (!survivors.has(unit._ruinId)) break;
      if (!ringContact(prev, unit, profile)) break;
      reachLeft.add(unit._ruinId);
    }
  }

  if (rightSpringSupported && rightIndex >= 0) {
    reachRight.add(rightSpring._ruinId);
    for (let index = rightIndex - 1; index >= 0; index -= 1) {
      const next = ordered[index + 1];
      const unit = ordered[index];
      if (!reachRight.has(next._ruinId)) break;
      if (!survivors.has(unit._ruinId)) break;
      if (!ringContact(unit, next, profile)) break;
      reachRight.add(unit._ruinId);
    }
  }

  for (const unit of ordered) {
    if (!survivors.has(unit._ruinId)) continue;
    const fromLeft = reachLeft.has(unit._ruinId);
    const fromRight = reachRight.has(unit._ruinId);
    const isKeystone = unit.support?.role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE;

    if (fromLeft && fromRight) continue;

    if (isKeystone && profile.openings.removeFloatingKeystone) {
      remove.set(unit._ruinId, RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED);
      continue;
    }

    const rest = fieldRestRatio(unit, fieldPool, survivors, profile);
    const okStub = (fromLeft || fromRight)
      && rest.ratio >= profile.openings.springFieldSupportRatio
      && rest.leftOverhang <= profile.openings.partialArchMaxCantilever
      && rest.rightOverhang <= profile.openings.partialArchMaxCantilever;

    if (profile.openings.archRequiresBothSprings && !(leftSpringSupported && rightSpringSupported)) {
      if (!okStub) {
        remove.set(unit._ruinId, RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED);
      }
      continue;
    }

    if (!okStub) {
      remove.set(unit._ruinId, RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED);
    }
  }

  let kept = 0;
  for (const unit of ordered) {
    if (survivors.has(unit._ruinId) && !remove.has(unit._ruinId)) kept += 1;
  }

  return {
    remove,
    leftSpringSupported,
    rightSpringSupported,
    leftSpringId: leftSpring?._ruinId ?? null,
    rightSpringId: rightSpring?._ruinId ?? null,
    kept,
  };
}
