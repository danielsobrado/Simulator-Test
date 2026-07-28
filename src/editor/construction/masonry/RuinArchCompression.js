/**
 * Compression-aware support for ruined opening arches.
 */

import {
  CONSTRUCTION_SUPPORT_ROLE,
  RUIN_REMOVAL_REASON,
} from './ConstructionSupportRoles.js';
import { coverageWithinSpan, intervalOverlap } from './RuinSupportIntervals.js';

function compareJambOrder(a, b) {
  const ordinal = (a.support?.jambOrdinal ?? 0) - (b.support?.jambOrdinal ?? 0);
  if (ordinal !== 0) return ordinal;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function unitCentre(stone) {
  const span = stone.support?.span;
  return span ? (span[0] + span[1]) * 0.5 : stone.s ?? 0;
}

function compareAlongWall(a, b) {
  const centre = unitCentre(a) - unitCentre(b);
  if (Math.abs(centre) > 1e-9) return centre;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function faceKey(stone) {
  const explicit = stone.support?.face;
  if (Number.isFinite(explicit) && explicit !== 0) return Math.sign(explicit);
  const offset = stone.offsetNormal ?? 0;
  return offset === 0 ? 0 : Math.sign(offset);
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
  return ordered.at(-1) ?? null;
}

function springHasJambBearing(spring, jamb, profile) {
  if (!spring || !jamb) return false;
  if (!verticalContact(spring, jamb, profile.support.verticalTolerance)) return false;
  const pad = Math.max(0.08, profile.support.minimumAbsoluteOverlap);
  return spanContact(spring, jamb, pad);
}

function fieldCoverage(stone, fieldPool, survivors, profile) {
  const supports = [];
  for (const lower of fieldPool) {
    if (!survivors.has(lower._ruinId)) continue;
    if (!verticalContact(stone, lower, profile.support.verticalTolerance)) continue;
    if (!spanContact(stone, lower, profile.support.maximumCantilever)) continue;
    supports.push(lower.support.span);
  }
  return coverageWithinSpan(
    stone.support.span[0],
    stone.support.span[1],
    supports,
  );
}

function springHasFieldBearing(spring, fieldPool, survivors, profile) {
  if (!spring) return false;
  const coverage = fieldCoverage(spring, fieldPool, survivors, profile);
  return coverage.ratio >= profile.openings.springFieldSupportRatio
    && coverage.leftOverhang <= profile.support.maximumCantilever
    && coverage.rightOverhang <= profile.support.maximumCantilever;
}

function canRemainAsStub(unit, reachable, fieldPool, survivors, profile) {
  if (!reachable) return false;
  const rest = fieldCoverage(unit, fieldPool, survivors, profile);
  return rest.ratio >= profile.openings.springFieldSupportRatio
    && rest.leftOverhang <= profile.openings.partialArchMaxCantilever
    && rest.rightOverhang <= profile.openings.partialArchMaxCantilever;
}

function resolveFaceChain({
  units,
  keystones,
  leftJamb,
  rightJamb,
  fieldPool,
  survivors,
  profile,
}) {
  const ring = [...units].sort(compareAlongWall);
  const leftSpring = ring[0] ?? null;
  const rightSpring = ring.at(-1) ?? null;
  const leftSpringSupported = Boolean(leftSpring) && survivors.has(leftSpring._ruinId) && (
    springHasJambBearing(leftSpring, leftJamb, profile)
    || springHasFieldBearing(leftSpring, fieldPool, survivors, profile)
  );
  const rightSpringSupported = Boolean(rightSpring) && survivors.has(rightSpring._ruinId) && (
    springHasJambBearing(rightSpring, rightJamb, profile)
    || springHasFieldBearing(rightSpring, fieldPool, survivors, profile)
  );

  const chain = [...ring, ...keystones].sort(compareAlongWall);
  const reachLeft = new Set();
  const reachRight = new Set();
  if (leftSpringSupported) {
    const start = chain.indexOf(leftSpring);
    reachLeft.add(leftSpring._ruinId);
    for (let index = start + 1; index < chain.length; index += 1) {
      const previous = chain[index - 1];
      const unit = chain[index];
      if (!reachLeft.has(previous._ruinId) || !survivors.has(unit._ruinId)) break;
      if (!ringContact(previous, unit, profile)) break;
      reachLeft.add(unit._ruinId);
    }
  }
  if (rightSpringSupported) {
    const start = chain.indexOf(rightSpring);
    reachRight.add(rightSpring._ruinId);
    for (let index = start - 1; index >= 0; index -= 1) {
      const next = chain[index + 1];
      const unit = chain[index];
      if (!reachRight.has(next._ruinId) || !survivors.has(unit._ruinId)) break;
      if (!ringContact(unit, next, profile)) break;
      reachRight.add(unit._ruinId);
    }
  }

  const remove = new Map();
  const keystoneSupport = new Map();
  for (const unit of chain) {
    if (!survivors.has(unit._ruinId)) continue;
    const fromLeft = reachLeft.has(unit._ruinId);
    const fromRight = reachRight.has(unit._ruinId);
    const isKeystone = unit.support?.role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE;
    if (isKeystone) {
      keystoneSupport.set(unit._ruinId, fromLeft && fromRight);
      continue;
    }
    if (fromLeft && fromRight) continue;

    const stub = canRemainAsStub(
      unit,
      fromLeft || fromRight,
      fieldPool,
      survivors,
      profile,
    );
    if (profile.openings.archRequiresBothSprings
      && !(leftSpringSupported && rightSpringSupported)
      && !stub) {
      remove.set(unit._ruinId, RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED);
    } else if (!stub) {
      remove.set(unit._ruinId, RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED);
    }
  }

  return {
    remove,
    keystoneSupport,
    leftSpringSupported,
    rightSpringSupported,
    leftSpringId: leftSpring?._ruinId ?? null,
    rightSpringId: rightSpring?._ruinId ?? null,
  };
}

function lintelSupported(lintel, leftJamb, rightJamb, fieldPool, survivors, profile) {
  if (!lintel || !survivors.has(lintel._ruinId)) return false;
  const onJambs = springHasJambBearing(lintel, leftJamb, profile)
    && springHasJambBearing(lintel, rightJamb, profile);
  if (onJambs) return true;
  const field = fieldCoverage(lintel, fieldPool, survivors, profile);
  return field.ratio >= profile.support.strongOverlapRatio
    && field.leftOverhang <= profile.support.maximumCantilever
    && field.rightOverhang <= profile.support.maximumCantilever;
}

/** Resolve each rendered arch face independently, then require shared keystones to be supported by all faces. */
export function resolveArchCompression({
  arches,
  leftJambs = [],
  rightJambs = [],
  fieldPool = [],
  survivors,
  profile,
}) {
  const remove = new Map();
  const available = arches.filter((unit) => survivors.has(unit._ruinId));
  if (available.length === 0) {
    return {
      remove,
      leftSpringSupported: false,
      rightSpringSupported: false,
      kept: 0,
    };
  }

  const leftJamb = topJamb(leftJambs, survivors);
  const rightJamb = topJamb(rightJambs, survivors);
  const keystones = available.filter(
    (unit) => unit.support?.role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
  );
  const ringUnits = available.filter(
    (unit) => unit.support?.role === CONSTRUCTION_SUPPORT_ROLE.ARCH,
  );

  if (ringUnits.length === 0) {
    for (const lintel of keystones) {
      if (!lintelSupported(lintel, leftJamb, rightJamb, fieldPool, survivors, profile)) {
        remove.set(lintel._ruinId, RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED);
      }
    }
    return {
      remove,
      leftSpringSupported: keystones.length > 0 && remove.size === 0,
      rightSpringSupported: keystones.length > 0 && remove.size === 0,
      kept: keystones.length - remove.size,
    };
  }

  const byFace = new Map();
  for (const unit of ringUnits) {
    const face = faceKey(unit);
    if (!byFace.has(face)) byFace.set(face, []);
    byFace.get(face).push(unit);
  }

  const keySupportCounts = new Map(keystones.map((unit) => [unit._ruinId, 0]));
  const faceResults = [];
  for (const units of byFace.values()) {
    const result = resolveFaceChain({
      units,
      keystones,
      leftJamb,
      rightJamb,
      fieldPool,
      survivors,
      profile,
    });
    faceResults.push(result);
    for (const [id, reason] of result.remove) remove.set(id, reason);
    for (const [id, supported] of result.keystoneSupport) {
      if (supported) keySupportCounts.set(id, (keySupportCounts.get(id) ?? 0) + 1);
    }
  }

  for (const keystone of keystones) {
    const supportedFaces = keySupportCounts.get(keystone._ruinId) ?? 0;
    if (profile.openings.removeFloatingKeystone && supportedFaces !== faceResults.length) {
      remove.set(keystone._ruinId, RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED);
    }
  }

  let kept = 0;
  for (const unit of available) {
    if (!remove.has(unit._ruinId)) kept += 1;
  }
  return {
    remove,
    leftSpringSupported: faceResults.every((result) => result.leftSpringSupported),
    rightSpringSupported: faceResults.every((result) => result.rightSpringSupported),
    leftSpringId: faceResults[0]?.leftSpringId ?? null,
    rightSpringId: faceResults[0]?.rightSpringId ?? null,
    kept,
  };
}
