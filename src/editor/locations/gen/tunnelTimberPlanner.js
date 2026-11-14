import { buildTunnelSpine } from './tunnelSpine.js';
import { createRng, fbm3 } from './noise.js';
import { resolveMineTimberConfig } from './mineTimberConfig.js';
import { hashPosition } from './timberGeometry.js';

const P = (x, y, z) => ({ x, y, z });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function weightedPick(rng, weightsObj) {
  const entries = Object.entries(weightsObj).filter(([, w]) => w > 0);
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  if (total <= 0) return entries[0]?.[0];
  let r = rng() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function sampleSpineAt(spine, s) {
  const clampedS = clamp(s, 0, spine.totalLength);
  for (let i = 0; i < spine.segments.length; i += 1) {
    const seg = spine.segments[i];
    if (clampedS <= seg.sEnd || i === spine.segments.length - 1) {
      const t = seg.len3d > 1e-6 ? clamp((clampedS - seg.sStart) / seg.len3d, 0, 1) : 0;
      return {
        s: clampedS,
        point: P(seg.ax + seg.dx * t, seg.ay + seg.dy * t, seg.az + seg.dz * t),
        dir: P(seg.dirX, 0, seg.dirZ),
        right: P(seg.rightX, 0, seg.rightZ),
        curvature: seg.curvature,
      };
    }
  }
  const first = spine.segments[0];
  return {
    s: 0,
    point: P(first.ax, first.ay, first.az),
    dir: P(first.dirX, 0, first.dirZ),
    right: P(first.rightX, 0, first.rightZ),
    curvature: first.curvature,
  };
}

function probeLateral(grid, origin, dirX, dirZ, height, maxReach) {
  const step = Math.max(0.08, grid.voxel * 0.25);
  const y = origin.y + height;
  for (let d = 0.25; d <= maxReach; d += step) {
    const val = grid.sample(origin.x + dirX * d, y, origin.z + dirZ * d);
    if (val < 0) return d;
  }
  return null;
}

function probeRoofY(grid, x, startY, z, maxReach) {
  const step = Math.max(0.08, grid.voxel * 0.25);
  let prev = grid.sample(x, startY, z);
  for (let dy = step; dy <= maxReach; dy += step) {
    const val = grid.sample(x, startY + dy, z);
    if (val < 0) {
      const frac = prev > 0 ? prev / (prev - val) : 0;
      return startY + dy - step + step * frac;
    }
    prev = val;
  }
  return null;
}

function probeFloorY(grid, x, refY, z) {
  const step = Math.max(0.06, grid.voxel * 0.2);
  let prev = grid.sample(x, refY + 0.65, z);
  if (prev < 0) return refY;
  for (let drop = step; drop <= 1.65; drop += step) {
    const y = refY + 0.65 - drop;
    const val = grid.sample(x, y, z);
    if (val < 0) {
      const frac = prev > 0 ? prev / (prev - val) : 0;
      return y + step * (1 - frac);
    }
    prev = val;
  }
  return refY;
}

/**
 * Probes the real `DensityGrid` geological cross-section at a passage station:
 * lateral wall distances at 4 heights, shoulder bearing for partial supports,
 * ceiling profile across the span, floor bearing elevations, and instability.
 */
export function probeTunnelCrossSection(b, center, dir, right, nominalWidth, nominalHeight, config) {
  const { grid } = b;
  const nomHalf = nominalWidth * 0.5;
  const maxProbe = nomHalf + 2.4;
  const heights = [0.45, 1.1, 1.75, 2.25];

  let leftMin = maxProbe;
  let rightMin = maxProbe;
  let leftHits = 0;
  let rightHits = 0;
  let leftShoulder = null;
  let rightShoulder = null;

  for (let i = 0; i < heights.length; i += 1) {
    const h = heights[i];
    if (h > nominalHeight - 0.15) continue;
    const dl = probeLateral(grid, center, -right.x, -right.z, h, maxProbe);
    const dr = probeLateral(grid, center, right.x, right.z, h, maxProbe);
    if (dl !== null) {
      leftHits += 1;
      if (dl < leftMin) leftMin = dl;
      if (h >= 1.65) leftShoulder = leftShoulder === null ? dl : Math.min(leftShoulder, dl);
    }
    if (dr !== null) {
      rightHits += 1;
      if (dr < rightMin) rightMin = dr;
      if (h >= 1.65) rightShoulder = rightShoulder === null ? dr : Math.min(rightShoulder, dr);
    }
  }

  const openThresh = nomHalf + config.placement.openingWidthThreshold;
  const leftOpen = leftHits === 0 || leftMin > openThresh;
  const rightOpen = rightHits === 0 || rightMin > openThresh;

  const sampleSpanL = leftOpen ? nomHalf : leftMin;
  const sampleSpanR = rightOpen ? nomHalf : rightMin;

  const roofProbeMax = nominalHeight + 2.4;
  const roofCenterY = probeRoofY(grid, center.x, center.y + 1.0, center.z, roofProbeMax) ?? (center.y + nominalHeight);
  const roofLeftY = probeRoofY(
    grid,
    center.x - right.x * sampleSpanL * 0.65,
    center.y + 1.0,
    center.z - right.z * sampleSpanL * 0.65,
    roofProbeMax,
  ) ?? roofCenterY;
  const roofRightY = probeRoofY(
    grid,
    center.x + right.x * sampleSpanR * 0.65,
    center.y + 1.0,
    center.z + right.z * sampleSpanR * 0.65,
    roofProbeMax,
  ) ?? roofCenterY;

  const floorCenterY = probeFloorY(grid, center.x, center.y, center.z);
  const floorLeftY = probeFloorY(grid, center.x - right.x * sampleSpanL * 0.8, center.y, center.z - right.z * sampleSpanL * 0.8);
  const floorRightY = probeFloorY(grid, center.x + right.x * sampleSpanR * 0.8, center.y, center.z + right.z * sampleSpanR * 0.8);

  const totalSpan = sampleSpanL + sampleSpanR;
  const avgRoofH = ((roofLeftY + roofCenterY + roofRightY) / 3) - center.y;
  const overbreakWidth = Math.max(0, totalSpan - nominalWidth);
  const overbreakRoof = Math.max(0, avgRoofH - nominalHeight);
  const roofSkew = Math.abs(roofLeftY - roofRightY);
  const instability = clamp(
    overbreakWidth * 0.42 + overbreakRoof * 0.65 + roofSkew * 0.35,
    0,
    1,
  );

  return {
    leftWall: leftOpen ? null : leftMin,
    rightWall: rightOpen ? null : rightMin,
    leftShoulder,
    rightShoulder,
    leftOpen,
    rightOpen,
    isChamberOrJunction: leftOpen || rightOpen,
    roofLeftY,
    roofCenterY,
    roofRightY,
    floorLeftY,
    floorCenterY,
    floorRightY,
    totalSpan,
    overbreakRoof,
    instability,
    dir,
    right,
  };
}

function isNearAvoidZone(point, avoidZones, extraMargin = 0) {
  if (!avoidZones || avoidZones.length === 0) return false;
  for (const zone of avoidZones) {
    const r = (zone.radius ?? 1.5) + extraMargin;
    if (Math.hypot(point.x - zone.x, point.z - zone.z) < r && Math.abs(point.y - (zone.y ?? point.y)) < (zone.height ?? 4)) {
      return true;
    }
  }
  return false;
}

function selectArchetype({ rng, probe, config, defaultCondition, inHeavyCluster }) {
  const aCfg = config.archetypes;
  if (inHeavyCluster || probe.instability >= aCfg.overbreakHeavyThreshold || probe.totalSpan >= aCfg.spanHeavyThreshold) {
    if (rng() < 0.22 && defaultCondition === 'repaired') return 'repaired';
    return 'heavy';
  }
  if (defaultCondition === 'aged' || defaultCondition === 'neglected') {
    const r = rng();
    if (r < 0.52) return 'aged';
    if (r < 0.72) return 'repaired';
    if (r < 0.88) return 'standard';
    return 'heavy';
  }
  // Check if partial single-post shoulder support is structurally justified on one tight solid shoulder.
  const canPartialLeft = probe.leftShoulder !== null && probe.rightWall !== null
    && probe.leftShoulder < probe.rightWall - 0.25 && probe.leftShoulder < 1.95;
  const canPartialRight = probe.rightShoulder !== null && probe.leftWall !== null
    && probe.rightShoulder < probe.leftWall - 0.25 && probe.rightShoulder < 1.95;

  const weights = {
    standard: aCfg.standard.weight,
    heavy: aCfg.heavy.weight * (0.6 + probe.instability),
    light: aCfg.light.weight * (1.2 - probe.instability),
    repaired: aCfg.repaired.weight,
    aged: aCfg.aged.weight,
    partial: (canPartialLeft || canPartialRight) ? aCfg.partial.weight * 2.2 : 0,
  };
  return weightedPick(rng, weights);
}

/**
 * Plans deterministic, geology-adapted, clearance-safe timber support frames
 * along a mine passage (defined by an `excavatedTunnel` shape or point array).
 */
export function planTunnelSupports(b, spec, userConfig = {}) {
  const config = resolveMineTimberConfig(userConfig);
  const spine = spec.shape?.spine ?? buildTunnelSpine(spec.points);
  const nominalWidth = spec.width ?? 3.6;
  const nominalHeight = spec.height ?? 3.2;
  const seed = (b.seed ?? 1) ^ (spec.seedOffset ?? 0) ^ 0x51a9d3;
  const rng = createRng(seed);

  const pCfg = config.placement;
  const cCfg = config.clearance;
  const dCfg = config.beamDimensions;

  const startS = spec.entranceOffset ?? pCfg.entranceOffset;
  const endS = Math.max(startS + 0.5, spine.totalLength - (spec.endMargin ?? pCfg.endMargin));
  const defaultCondition = spec.condition ?? 'maintained';
  const avoidZones = spec.avoidZones ?? [];

  // Protected lateral envelope in passage `right` coordinates.
  const rail = spec.rail ?? null;
  const minClearLeft = -(rail ? Math.max(cCfg.walkHalfWidth, -rail.offset + cCfg.railHalfWidth) : cCfg.walkHalfWidth);
  const minClearRight = rail ? Math.max(cCfg.walkHalfWidth, rail.offset + cCfg.railHalfWidth) : cCfg.walkHalfWidth;

  const plans = [];
  let s = startS;
  let heavyClusterLeft = 0;
  let prevArchetype = null;
  let frameIndex = 0;

  while (s <= endS) {
    const station = sampleSpineAt(spine, s);
    const frameSeed = hashPosition(station.point.x, station.point.y, station.point.z, seed + frameIndex * 37);
    const frameRng = createRng(frameSeed);

    // Avoid branch openings, chambers, and junction centers.
    if (isNearAvoidZone(station.point, avoidZones, pCfg.junctionClearance * 0.5)) {
      s += pCfg.minSpacing * 0.85;
      continue;
    }

    const probe = probeTunnelCrossSection(b, station.point, station.dir, station.right, nominalWidth, nominalHeight, config);
    if (probe.isChamberOrJunction) {
      s += pCfg.minSpacing * 0.8;
      continue;
    }

    // Geological zone noise creates coherent heavy-ground clusters and calmer light sections.
    const zoneStress = fbm3(station.point.x * 0.08, 0.5, station.point.z * 0.08, seed + 19, 2);
    if (frameIndex > 0 && heavyClusterLeft === 0 && (zoneStress > 0.66 || probe.instability > 0.40) && frameRng() < pCfg.heavyClusterChance) {
      heavyClusterLeft = pCfg.heavyClusterMinCount
        + Math.floor(frameRng() * (pCfg.heavyClusterMaxCount - pCfg.heavyClusterMinCount + 1));
    }

    const inHeavyCluster = heavyClusterLeft > 0;
    if (heavyClusterLeft > 0) heavyClusterLeft -= 1;

    let archetype = selectArchetype({
      rng: frameRng,
      probe,
      config,
      defaultCondition,
      inHeavyCluster,
    });
    // Avoid stark chaotic jumps (e.g. heavy -> light -> heavy) unless geology dictates.
    if (prevArchetype === 'heavy' && archetype === 'light' && probe.instability > 0.15) {
      archetype = 'standard';
    }
    prevArchetype = archetype;

    const archCfg = config.archetypes[archetype] ?? config.archetypes.standard;
    const dimJitter = 1 + (frameRng() - 0.5) * 2 * dCfg.variation;
    const postWidth = dCfg.postWidth * archCfg.postScale * dimJitter;
    const postDepth = dCfg.postDepth * archCfg.postScale * (2 - dimJitter * 0.5) * 0.667;
    const capWidth = dCfg.capWidth * archCfg.capScale * dimJitter;
    const capHeight = dCfg.capHeight * archCfg.capScale * dimJitter;
    const braceWidth = dCfg.braceWidth * archCfg.braceScale;
    const braceDepth = dCfg.braceDepth * archCfg.braceScale;

    // Fit posts snug against probed rock walls while strictly protecting rail & walkway clearances.
    const wallLeft = probe.leftWall ?? nominalWidth * 0.5;
    const wallRight = probe.rightWall ?? nominalWidth * 0.5;

    const targetLeftCenter = wallLeft - cCfg.postWallTargetGap - postWidth * 0.5;
    const targetRightCenter = wallRight - cCfg.postWallTargetGap - postWidth * 0.5;

    const requiredLeftInner = -minClearLeft;
    const requiredRightInner = minClearRight;
    const leftInner = Math.max(requiredLeftInner, targetLeftCenter - postWidth * 0.5);
    const rightInner = Math.max(requiredRightInner, targetRightCenter - postWidth * 0.5);

    const leftPostOffset = -(leftInner + postWidth * 0.5);
    const rightPostOffset = rightInner + postWidth * 0.5;

    // Verify neither post penetrates rock excessively; if one side is pinched too tight, adapt or skip.
    const leftPen = (Math.abs(leftPostOffset) + postWidth * 0.5) - wallLeft;
    const rightPen = (rightPostOffset + postWidth * 0.5) - wallRight;
    if (leftPen > cCfg.maxRockPenetration + 0.08 && rightPen > cCfg.maxRockPenetration + 0.08) {
      s += pCfg.minSpacing;
      continue;
    }

    // Determine ceiling bearing height from probed rock roof profile.
    const minRoofY = Math.min(probe.roofLeftY, probe.roofCenterY, probe.roofRightY);
    const maxCapTopY = minRoofY - cCfg.ceilingContactMargin;
    const baseFloorY = Math.min(probe.floorLeftY, probe.floorRightY);
    const clearTopY = station.point.y + Math.max(cCfg.walkHeight + 0.14, cCfg.minFrameHeight);
    const capTopY = Math.max(clearTopY, maxCapTopY);
    const capSoffitY = capTopY - capHeight;
    if (capSoffitY - baseFloorY < cCfg.minFrameHeight) {
      s += pCfg.minSpacing;
      continue;
    }

    // Joint style & condition preset.
    const jointStyle = archetype === 'heavy'
      ? (frameRng() < 0.65 ? 'bolster' : 'collared')
      : archetype === 'light'
        ? (frameRng() < 0.6 ? 'notched' : 'housed')
        : weightedPick(frameRng, config.joints.styles);

    const conditionName = archetype === 'aged'
      ? (defaultCondition === 'neglected' ? 'neglected' : 'aged')
      : archetype === 'repaired'
        ? 'repaired'
        : defaultCondition;

    // Partial support: verify rock shoulder on anchored side before committing.
    let partialSide = null;
    if (archetype === 'partial') {
      const leftTight = probe.leftShoulder !== null && probe.leftShoulder <= Math.abs(leftPostOffset) + 0.26;
      const rightTight = probe.rightShoulder !== null && probe.rightShoulder <= rightPostOffset + 0.26;
      if (leftTight && !rightTight) partialSide = 'right'; // post on right, cap pockets into left rock shoulder
      else if (rightTight && !leftTight) partialSide = 'left';
      else archetype = 'standard';
    }

    // Brace configuration (allow realistic asymmetry).
    const frameClearH = capSoffitY - station.point.y;
    let hasLeftBrace = false;
    let hasRightBrace = false;
    if (frameClearH >= config.braces.minClearHeight) {
      hasLeftBrace = frameRng() < archCfg.braceChance;
      hasRightBrace = frameRng() < archCfg.braceChance;
      if (hasLeftBrace && hasRightBrace && frameRng() < archCfg.asymmetryChance) {
        if (frameRng() < 0.5) hasLeftBrace = false;
        else hasRightBrace = false;
      }
      if (partialSide === 'left') hasRightBrace = false;
      if (partialSide === 'right') hasLeftBrace = false;
    }

    // Protect rail side if brace drop intrudes into tall cargo/cart envelope on tight spans.
    if (rail && Math.abs(leftPostOffset) - postWidth * 0.5 < Math.abs(rail.offset) + cCfg.railHalfWidth + 0.12) {
      // Keep brace shorter/higher so it clears the ore cart comfortably.
    }

    const dropL = config.braces.kneeDropMin + frameRng() * (config.braces.kneeDropMax - config.braces.kneeDropMin);
    const reachL = config.braces.kneeReachMin + frameRng() * (config.braces.kneeReachMax - config.braces.kneeReachMin);
    const dropR = config.braces.kneeDropMin + frameRng() * (config.braces.kneeDropMax - config.braces.kneeDropMin);
    const reachR = config.braces.kneeReachMin + frameRng() * (config.braces.kneeReachMax - config.braces.kneeReachMin);

    plans.push({
      index: frameIndex,
      s,
      seed: frameSeed,
      center: station.point,
      dir: station.dir,
      right: station.right,
      archetype,
      condition: conditionName,
      jointStyle,
      partialSide,
      postWidth,
      postDepth,
      capWidth,
      capHeight,
      braceWidth,
      braceDepth,
      leftPostOffset,
      rightPostOffset,
      floorLeftY: probe.floorLeftY,
      floorRightY: probe.floorRightY,
      capSoffitY,
      capTopY,
      roofLeftY: probe.roofLeftY,
      roofCenterY: probe.roofCenterY,
      roofRightY: probe.roofRightY,
      wallLeft,
      wallRight,
      leftShoulder: probe.leftShoulder,
      rightShoulder: probe.rightShoulder,
      hasLeftBrace,
      hasRightBrace,
      dropL,
      reachL,
      dropR,
      reachR,
      hasHardware: frameRng() < archCfg.hardwareChance,
      instability: probe.instability,
      isPortal: false,
    });

    frameIndex += 1;
    // Stability-modulated variable spacing (tighter in unstable/heavy zones, wider in sound rock).
    const stabilityScale = inHeavyCluster || archetype === 'heavy'
      ? 0.78
      : archetype === 'light'
        ? 1.18
        : (1.06 - probe.instability * 0.28);
    const jitter = 1 + (rng() - 0.5) * 2 * pCfg.spacingJitter;
    const step = clamp(pCfg.nominalSpacing * stabilityScale * jitter, pCfg.minSpacing, pCfg.maxSpacing);
    s += step;
  }

  return { config, spine, plans };
}
