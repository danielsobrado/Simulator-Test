import { createRng } from './noise.js';
import { resolveMineTimberConfig } from './mineTimberConfig.js';
import {
  TimberGeometryCache,
  createTimberBeam,
  createTimberBoard,
  hashPosition,
} from './timberGeometry.js';
import {
  buildKneeBrace,
  buildPostHeaderJoint,
  buildRepairDetails,
  buildRockBlocking,
  buildSillFooting,
} from './timberJoints.js';
import { planTunnelSupports, probeTunnelCrossSection } from './tunnelTimberPlanner.js';

const P = (x, y, z) => ({ x, y, z });
const add = (a, b, s = 1) => P(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const UP = P(0, 1, 0);

function varyTint(hex, rng, spread = 0.08) {
  const delta = 1 + (rng() - 0.5) * 2 * spread;
  const r = clamp(Math.round(((hex >> 16) & 0xff) * delta), 20, 235);
  const g = clamp(Math.round(((hex >> 8) & 0xff) * delta * (0.97 + rng() * 0.06)), 16, 220);
  const bl = clamp(Math.round((hex & 0xff) * delta * (0.95 + rng() * 0.08)), 12, 200);
  return (r << 16) | (g << 8) | bl;
}

function resolveSplitChance(baseChance, splitRate) {
  return clamp(baseChance * (0.5 + splitRate * 1.1), 0, 0.85);
}

function buildPostAssembly(b, cache, plan, side, ctx) {
  const { config, cond, gCfg, dCfg, baseTint, rng } = ctx;
  const isLeft = side === 'left';
  const sideSign = isLeft ? -1 : 1;
  const postOffset = isLeft ? plan.leftPostOffset : plan.rightPostOffset;
  const floorY = isLeft ? plan.floorLeftY : plan.floorRightY;
  const wallDist = isLeft ? plan.wallLeft : plan.wallRight;
  const hasBrace = isLeft ? plan.hasLeftBrace : plan.hasRightBrace;
  const rawDrop = isLeft ? plan.dropL : plan.dropR;
  const rawReach = isLeft ? plan.reachL : plan.reachR;

  const inwardDir = P(-plan.right.x * sideSign, 0, -plan.right.z * sideSign);
  const outwardDir = P(plan.right.x * sideSign, 0, plan.right.z * sideSign);
  const footCenter = add(P(plan.center.x, floorY, plan.center.z), plan.right, postOffset);

  const hasSill = plan.archetype !== 'light' || rng() < 0.55;
  const sillH = hasSill
    ? dCfg.sillHeight * (plan.archetype === 'heavy' ? 1.15 : plan.archetype === 'light' ? 0.78 : 1.0)
    : 0;
  if (hasSill) {
    buildSillFooting(b, {
      foot: P(footCenter.x, floorY - 0.015, footCenter.z),
      spanDir: plan.right,
      tunnelDir: plan.dir,
      width: Math.max(plan.postWidth * 1.45, dCfg.sillWidth * (plan.archetype === 'heavy' ? 1.12 : 0.94)),
      height: sillH,
      depth: Math.max(plan.postDepth * 1.45, dCfg.sillDepth * (plan.archetype === 'heavy' ? 1.12 : 0.94)),
      damp: clamp(cond.damp + 0.35, 0, 1),
      wear: clamp(cond.wear + 0.1, 0, 1),
      tint: varyTint(baseTint, rng, 0.06),
      seed: plan.seed + (isLeft ? 31 : 53),
    });
  }

  const leanLat = (rng() - 0.5) * 2 * cond.leanMax;
  const leanAlong = (rng() - 0.5) * 2 * cond.leanMax;
  const postStart = P(footCenter.x, floorY + (hasSill ? sillH * 0.86 : -0.025), footCenter.z);

  const bolH = plan.jointStyle === 'bolster'
    ? dCfg.bolsterHeight * (plan.capHeight / dCfg.capHeight)
    : 0;
  const postTopCenterY = plan.capSoffitY - bolH + (bolH > 0 ? 0.01 : 0.018);
  const postEnd = P(
    footCenter.x + plan.right.x * leanLat + plan.dir.x * leanAlong,
    postTopCenterY,
    footCenter.z + plan.right.z * leanLat + plan.dir.z * leanAlong,
  );
  const postHeight = postEnd.y - postStart.y;
  const postTint = varyTint(baseTint, rng, 0.06);

  b.prop('timber', createTimberBeam(postStart, postEnd, plan.postWidth, plan.postDepth, {
    sideHint: plan.right,
    bevelRatio: gCfg.bevelRatio,
    irregular: gCfg.edgeIrregularity,
    bow: gCfg.bowFactor * (plan.archetype === 'aged' ? 1.45 : 1.0),
    taper: gCfg.taperFactor,
    sawSkew: gCfg.sawCutSkew,
    chipChance: gCfg.chipChance,
    chipDepth: gCfg.chipDepth,
    splitChance: resolveSplitChance(gCfg.splitChance, cond.splitRate),
    splitDepth: gCfg.splitDepth,
    longitudinalStep: gCfg.longitudinalStep,
    maxSteps: gCfg.maxSteps,
    uvScale: gCfg.uvScale,
    dampStart: clamp(cond.damp * 1.3 + 0.16, 0, 1),
    dampEnd: clamp(cond.damp * 0.65, 0, 1),
    wear: cond.wear,
    seed: plan.seed + (isLeft ? 101 : 203),
  }), postTint);

  const jointPostTop = P(postEnd.x, plan.capSoffitY, postEnd.z);
  buildPostHeaderJoint(b, cache, {
    style: plan.jointStyle,
    postTop: jointPostTop,
    postWidth: plan.postWidth,
    postDepth: plan.postDepth,
    capHeight: plan.capHeight,
    capWidth: plan.capWidth,
    inwardDir,
    tunnelDir: plan.dir,
    upDir: UP,
    hasHardware: plan.hasHardware,
    config,
    tint: postTint,
    damp: clamp(cond.damp * 0.85, 0, 1),
    wear: cond.wear,
    seed: plan.seed + (isLeft ? 307 : 409),
  });

  if (hasBrace && postHeight > 1.75) {
    const clearHalfSpan = (plan.rightPostOffset - plan.leftPostOffset) * 0.5 - plan.postWidth * 0.5;
    const drop = clamp(rawDrop, 0.45, Math.max(0.48, postHeight - 1.25));
    const reach = clamp(rawReach, 0.4, Math.max(0.42, clearHalfSpan * 0.48));
    const postInnerTop = add(
      P(postEnd.x, plan.capSoffitY, postEnd.z),
      inwardDir,
      plan.postWidth * 0.48,
    );
    buildKneeBrace(b, cache, {
      postInnerTop,
      capSoffitY: plan.capSoffitY,
      inwardDir,
      tunnelDir: plan.dir,
      upDir: UP,
      drop,
      reach,
      braceWidth: plan.braceWidth,
      braceDepth: plan.braceDepth,
      hasCleat: plan.archetype === 'heavy' || rng() < config.braces.heelCleatChance,
      hasHardware: plan.hasHardware,
      config,
      tint: varyTint(baseTint, rng, 0.05),
      damp: clamp(cond.damp * 0.75, 0, 1),
      wear: cond.wear,
      seed: plan.seed + (isLeft ? 503 : 607),
    });
  }

  // Lateral rock contact blocking/wedges behind post where overbreak creates a gap.
  if (wallDist !== null) {
    const postOuterDist = Math.abs(postOffset) + plan.postWidth * 0.5;
    const wallGap = wallDist - postOuterDist;
    if (wallGap >= 0.045 && wallGap <= config.joints.blockingMaxGap) {
      const midY = floorY + postHeight * (0.58 + (rng() - 0.5) * 0.14);
      const outerFace = add(P(footCenter.x, midY, footCenter.z), outwardDir, plan.postWidth * 0.48);
      buildRockBlocking(b, {
        surfaceCenter: outerFace,
        outNormal: outwardDir,
        acrossDir: UP,
        tangentDir: plan.dir,
        gap: wallGap + 0.02,
        width: Math.min(0.42, plan.postWidth * 1.9),
        depth: plan.postDepth,
        config,
        tint: postTint,
        damp: clamp(cond.damp + 0.15, 0, 1),
        wear: cond.wear,
        seed: plan.seed + (isLeft ? 701 : 809),
      });
    }
  }

  // Register tight post footprint for navigation.
  if (b.nav && typeof b.nav.block === 'function') {
    b.nav.block(footCenter, plan.postWidth * 0.72, Math.max(1.8, postHeight));
  }

  return {
    postStart,
    postEnd,
    inwardDir,
    outerOffset: Math.abs(postOffset) + plan.postWidth * 0.5,
  };
}

function resolveCapEndpointOffset(plan, side, rng, config) {
  const isLeft = side === 'left';
  if (plan.partialSide === side) {
    const wallRef = isLeft ? (plan.leftShoulder ?? plan.wallLeft) : (plan.rightShoulder ?? plan.wallRight);
    const embed = (wallRef ?? 1.75) + 0.16;
    return isLeft ? -embed : embed;
  }
  const jCfg = config.joints;
  const postOut = (isLeft ? Math.abs(plan.leftPostOffset) : plan.rightPostOffset) + plan.postWidth * 0.5;
  const wallDist = isLeft ? plan.wallLeft : plan.wallRight;
  const desiredEar = jCfg.capEarMin + rng() * (jCfg.capEarMax - jCfg.capEarMin);
  const availEar = wallDist !== null
    ? Math.max(0.08, (wallDist - postOut) + 0.06)
    : desiredEar;
  const ear = Math.min(desiredEar, availEar);
  return isLeft ? -(postOut + ear) : (postOut + ear);
}

/**
 * Generates one complete procedural mine support frame from a `tunnelTimberPlanner` plan.
 */
export function buildTimberSupportFrame(b, cache, plan, config) {
  const rng = createRng(plan.seed);
  const cond = config.conditions[plan.condition] ?? config.conditions.maintained;
  const gCfg = config.geometry;
  const dCfg = config.beamDimensions;
  const baseTint = varyTint(cond.tintHex, rng, 0.09);

  let leftInfo = null;
  let rightInfo = null;
  if (plan.partialSide !== 'left') {
    leftInfo = buildPostAssembly(b, cache, plan, 'left', { config, cond, gCfg, dCfg, baseTint, rng });
  }
  if (plan.partialSide !== 'right') {
    rightInfo = buildPostAssembly(b, cache, plan, 'right', { config, cond, gCfg, dCfg, baseTint, rng });
  }

  // Cap beam spanning from left ear (or left shoulder rock pocket) to right ear.
  const capOffsetL = resolveCapEndpointOffset(plan, 'left', rng, config);
  const capOffsetR = resolveCapEndpointOffset(plan, 'right', rng, config);
  const capCenterY = plan.capSoffitY + plan.capHeight * 0.5;
  const capStart = add(P(plan.center.x, capCenterY, plan.center.z), plan.right, capOffsetL);
  const capEnd = add(P(plan.center.x, capCenterY, plan.center.z), plan.right, capOffsetR);
  const capTint = varyTint(baseTint, rng, 0.06);

  b.prop('timber', createTimberBeam(capStart, capEnd, plan.capWidth, plan.capHeight, {
    sideHint: plan.dir,
    bevelRatio: gCfg.bevelRatio,
    irregular: gCfg.edgeIrregularity,
    bow: gCfg.bowFactor * (plan.archetype === 'aged' ? 1.5 : 1.0),
    taper: gCfg.taperFactor * 0.7,
    sawSkew: gCfg.sawCutSkew,
    chipChance: gCfg.chipChance,
    chipDepth: gCfg.chipDepth,
    splitChance: resolveSplitChance(gCfg.splitChance, cond.splitRate),
    splitDepth: gCfg.splitDepth,
    longitudinalStep: gCfg.longitudinalStep,
    maxSteps: gCfg.maxSteps,
    uvScale: gCfg.uvScale,
    dampStart: clamp(cond.damp * 0.8, 0, 1),
    dampEnd: clamp(cond.damp * 0.8, 0, 1),
    wear: cond.wear,
    seed: plan.seed + 911,
  }), capTint);

  // If partial support anchored into rock shoulder, wedge the rock pocket perimeter tight.
  const blockTint = varyTint(cond.tintHex, rng, 0.04) & 0xfefefe;
  if (plan.partialSide) {
    const isLeft = plan.partialSide === 'left';
    const rockWall = isLeft ? (plan.leftShoulder ?? plan.wallLeft) : (plan.rightShoulder ?? plan.wallRight);
    if (rockWall !== null) {
      const pocketAt = add(P(plan.center.x, plan.capTopY - 0.01, plan.center.z), plan.right, isLeft ? -(rockWall - 0.08) : (rockWall - 0.08));
      buildRockBlocking(b, {
        surfaceCenter: pocketAt,
        outNormal: UP,
        acrossDir: plan.right,
        tangentDir: plan.dir,
        gap: 0.11,
        width: plan.capWidth * 1.08,
        depth: 0.22,
        config,
        tint: varyTint(capTint, rng, 0.04),
        damp: clamp(cond.damp + 0.18, 0, 1),
        wear: cond.wear,
        seed: plan.seed + 947,
      });
    }
  }

  // Overhead roof blocking & spanwise driven wedges connecting cap top to irregular rock crown.
  const crownStations = [
    { offsetFrac: -0.58, roofY: plan.roofLeftY },
    { offsetFrac: 0.0, roofY: plan.roofCenterY },
    { offsetFrac: 0.58, roofY: plan.roofRightY },
  ];
  const maxRoofBlock = Math.min(config.joints.blockingMaxGap, 0.36);
  const blockSpanLeft = plan.partialSide === 'left' ? (capOffsetL * 0.72) : (plan.leftPostOffset + 0.24);
  const blockSpanRight = plan.partialSide === 'right' ? (capOffsetR * 0.72) : (plan.rightPostOffset - 0.24);
  const blockSpanHalf = Math.max(0.4, (blockSpanRight - blockSpanLeft) * 0.5);
  const blockSpanMid = (blockSpanLeft + blockSpanRight) * 0.5;
  const crownDepth = Math.min(plan.capWidth * 0.82, 0.16);
  for (let i = 0; i < crownStations.length; i += 1) {
    const st = crownStations[i];
    if (!Number.isFinite(st.roofY)) continue;
    // Skip central foreground blocking on entry frames when ceiling rises high above the cap.
    if ((plan.index === 0 || plan.isPortal) && st.offsetFrac === 0) continue;
    const roofGap = st.roofY - plan.capTopY;
    if (roofGap >= 0.04 && roofGap <= maxRoofBlock) {
      const lat = blockSpanMid + st.offsetFrac * blockSpanHalf;
      const topAt = add(P(plan.center.x, plan.capTopY - 0.012, plan.center.z), plan.right, lat);
      buildRockBlocking(b, {
        surfaceCenter: topAt,
        outNormal: UP,
        acrossDir: plan.right,
        tangentDir: plan.dir,
        gap: roofGap + 0.015,
        width: plan.capWidth * 0.94,
        depth: crownDepth,
        config,
        tint: varyTint(blockTint, rng, 0.05),
        damp: clamp(cond.damp + 0.12, 0, 1),
        wear: clamp(cond.wear + 0.1, 0, 1),
        seed: plan.seed + 1009 + i * 31,
      });
    }
  }

  // Repaired archetype details: sister post or cap splice splint in fresher timber + iron.
  if (plan.archetype === 'repaired') {
    const useSister = (leftInfo || rightInfo) && rng() < 0.62;
    const targetSide = leftInfo && (!rightInfo || rng() < 0.5) ? leftInfo : rightInfo;
    if (useSister && targetSide) {
      buildRepairDetails(b, cache, {
        postFoot: targetSide.postStart,
        postTop: P(targetSide.postEnd.x, plan.capSoffitY, targetSide.postEnd.z),
        capStart,
        capEnd,
        postWidth: plan.postWidth,
        postDepth: plan.postDepth,
        capWidth: plan.capWidth,
        capHeight: plan.capHeight,
        inwardDir: targetSide.inwardDir,
        tunnelDir: plan.dir,
        upDir: UP,
        repairKind: 'sister-post',
        config,
        repairTint: varyTint(cond.repairTintHex, rng, 0.06),
        seed: plan.seed + 1151,
      });
    } else {
      buildRepairDetails(b, cache, {
        postFoot: capStart,
        postTop: capStart,
        capStart,
        capEnd,
        postWidth: plan.postWidth,
        postDepth: plan.postDepth,
        capWidth: plan.capWidth,
        capHeight: plan.capHeight,
        inwardDir: plan.right,
        tunnelDir: plan.dir,
        upDir: UP,
        repairKind: 'cap-splint',
        config,
        repairTint: varyTint(cond.repairTintHex, rng, 0.06),
        seed: plan.seed + 1187,
      });
    }
  }

  const anchorSideSign = plan.index % 2 === 0 ? 1 : -1;
  const sidePostDist = anchorSideSign > 0 ? Math.abs(plan.rightPostOffset) : Math.abs(plan.leftPostOffset);
  const braceClearance = (anchorSideSign > 0 ? plan.hasRightBrace : plan.hasLeftBrace)
    ? ((anchorSideSign > 0 ? plan.reachR : plan.reachL) + 0.14)
    : 0.42;
  const anchorLat = anchorSideSign * clamp(sidePostDist - Math.max(0.42, braceClearance), 0.35, 0.98);

  return {
    plan,
    capStart,
    capEnd,
    lanternAnchor: add(
      P(plan.center.x, plan.capSoffitY, plan.center.z),
      plan.right,
      anchorLat,
    ),
  };
}

/**
 * Places rough-sawn overhead roof & occasional side-wall lagging planks spanning
 * between consecutive support frames where geology warrants localized retention.
 */
export function buildTunnelLagging(b, prevPlan, currPlan, config) {
  const lCfg = config.lagging;
  const dCfg = config.beamDimensions;
  const dx = currPlan.center.x - prevPlan.center.x;
  const dy = currPlan.center.y - prevPlan.center.y;
  const dz = currPlan.center.z - prevPlan.center.z;
  const baySpan = Math.hypot(dx, dy, dz);
  if (baySpan < 1.2 || baySpan > lCfg.maxSpan) return;

  const baySeed = hashPosition(prevPlan.center.x, prevPlan.center.y, prevPlan.center.z, prevPlan.seed ^ 0x41a2);
  const rng = createRng(baySeed);
  const bayInstability = Math.max(prevPlan.instability, currPlan.instability);
  const isHeavyBay = prevPlan.archetype === 'heavy' || currPlan.archetype === 'heavy'
    || prevPlan.archetype === 'repaired' || currPlan.archetype === 'repaired';

  const roofChance = clamp(
    lCfg.roofProbability + bayInstability * lCfg.unstableBoost + (isHeavyBay ? 0.35 : 0),
    0,
    0.92,
  );
  const capStep = Math.abs(currPlan.capTopY - prevPlan.capTopY);
  const maxStep = prevPlan.index === 0 ? 0.20 : 0.30;
  if (capStep <= maxStep && rng() < roofChance) {
    const cond = config.conditions[currPlan.condition] ?? config.conditions.maintained;
    const count = lCfg.boardsPerBayMin + Math.floor(rng() * (lCfg.boardsPerBayMax - lCfg.boardsPerBayMin + 1));
    const maxOffset = Math.min(
      Math.abs(prevPlan.leftPostOffset),
      prevPlan.rightPostOffset,
      Math.abs(currPlan.leftPostOffset),
      currPlan.rightPostOffset,
    ) * 0.72;

    const slots = [];
    for (let i = 0; i < count; i += 1) {
      const frac = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
      const lat = frac * maxOffset + (rng() - 0.5) * 0.18;
      if (slots.some((used) => Math.abs(used - lat) < dCfg.laggingWidth * 0.95)) continue;
      slots.push(lat);

      const overhang = 0.04 + rng() * 0.05;
      const midDir = P(dx / baySpan, dy / baySpan, dz / baySpan);
      const aBase = add(P(prevPlan.center.x, prevPlan.capTopY + dCfg.laggingThickness * 0.45, prevPlan.center.z), prevPlan.right, lat);
      const bBase = add(P(currPlan.center.x, currPlan.capTopY + dCfg.laggingThickness * 0.45, currPlan.center.z), currPlan.right, lat);
      const boardA = add(aBase, midDir, -overhang);
      const boardB = add(bBase, midDir, overhang);

      b.prop('timber', createTimberBoard(boardA, boardB, prevPlan.right, dCfg.laggingWidth, dCfg.laggingThickness, {
        irregular: 0.2,
        bow: 0.004,
        damp: clamp(cond.damp + 0.1, 0, 1),
        wear: cond.wear,
        seed: baySeed + i * 43,
      }), varyTint(cond.tintHex, rng, 0.1));
    }
  }

  // Localized lower-shoulder wall lagging on heavy/unstable bays (skip entrance bay & jagged jumps).
  const wallChance = clamp(lCfg.wallProbability + bayInstability * 0.35 + (isHeavyBay ? 0.18 : 0), 0, 0.65);
  for (const side of ['left', 'right']) {
    if (prevPlan.index === 0 || prevPlan.partialSide === side || currPlan.partialSide === side || rng() > wallChance) continue;
    const isLeft = side === 'left';
    const wallPrev = isLeft ? prevPlan.wallLeft : prevPlan.wallRight;
    const wallCurr = isLeft ? currPlan.wallLeft : currPlan.wallRight;
    if (wallPrev === null || wallCurr === null || Math.abs(wallPrev - wallCurr) > 0.35) continue;

    const cond = config.conditions[currPlan.condition] ?? config.conditions.maintained;
    const sign = isLeft ? -1 : 1;
    const offA = isLeft ? prevPlan.leftPostOffset : prevPlan.rightPostOffset;
    const offB = isLeft ? currPlan.leftPostOffset : currPlan.rightPostOffset;
    const boards = 1 + (rng() < 0.45 ? 1 : 0);
    for (let k = 0; k < boards; k += 1) {
      const h = 1.25 + k * (dCfg.laggingWidth + 0.09) + (rng() - 0.5) * 0.08;
      const pA = add(P(prevPlan.center.x, prevPlan.floorLeftY + h, prevPlan.center.z), prevPlan.right, offA + sign * (prevPlan.postWidth * 0.5 + dCfg.laggingThickness * 0.45));
      const pB = add(P(currPlan.center.x, currPlan.floorLeftY + h, currPlan.center.z), currPlan.right, offB + sign * (currPlan.postWidth * 0.5 + dCfg.laggingThickness * 0.45));
      b.prop('timber', createTimberBoard(pA, pB, UP, dCfg.laggingWidth * 0.92, dCfg.laggingThickness, {
        irregular: 0.22,
        damp: clamp(cond.damp + 0.15, 0, 1),
        wear: cond.wear,
        seed: baySeed + 300 + (isLeft ? 0 : 97) + k * 29,
      }), varyTint(cond.tintHex, rng, 0.1));
    }
  }
}

/**
 * Plans and builds the complete procedural timber support system along a mine
 * passage or spline, returning placed frame metadata and lantern anchor nodes.
 */
export function buildMineTunnelSupports(b, spec, userConfig = {}) {
  const { config, spine, plans } = planTunnelSupports(b, spec, userConfig);
  const cache = spec.cache ?? new TimberGeometryCache();
  const builtFrames = [];

  for (let i = 0; i < plans.length; i += 1) {
    builtFrames.push(buildTimberSupportFrame(b, cache, plans[i], config));
    if (i > 0) {
      buildTunnelLagging(b, plans[i - 1], plans[i], config);
    }
  }

  return {
    config,
    spine,
    plans,
    frames: builtFrames,
  };
}

/**
 * Builds a single freestanding timber support frame oriented by `yaw` (or a passage
 * portal frame adapted to surrounding `DensityGrid` rock when `fitToRock` is true).
 */
export function buildStandaloneTimberSet(b, at, yaw, width, height, {
  tint = null,
  condition = 'maintained',
  archetype = 'standard',
  jointStyle = 'notched',
  hasBraces = true,
  fitToRock = false,
  cache = new TimberGeometryCache(),
  timberConfig = {},
} = {}) {
  const config = resolveMineTimberConfig(timberConfig);
  const dCfg = config.beamDimensions;
  const archCfg = config.archetypes[archetype] ?? config.archetypes.standard;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Look direction matches +Z local -> (-sin(yaw), 0, -cos(yaw)) or yaw=0 -> right=(1,0,0), dir=(0,0,-1).
  const right = P(c, 0, -s);
  const dir = P(-s, 0, -c);
  const seed = hashPosition(at.x, at.y, at.z, 0x3b17);
  const rng = createRng(seed);

  let halfSpan = width * 0.5;
  let capSoffitY = at.y + height;
  let floorLeftY = at.y;
  let floorRightY = at.y;
  let roofLeftY = capSoffitY + dCfg.capHeight + 0.12;
  let roofCenterY = capSoffitY + dCfg.capHeight + 0.16;
  let roofRightY = capSoffitY + dCfg.capHeight + 0.12;
  let wallLeft = halfSpan + 0.08;
  let wallRight = halfSpan + 0.08;

  if (fitToRock && b.grid) {
    const probe = probeTunnelCrossSection(b, at, dir, right, width, height, config);
    if (probe.leftWall !== null && probe.rightWall !== null) {
      wallLeft = probe.leftWall;
      wallRight = probe.rightWall;
    }
    floorLeftY = probe.floorLeftY;
    floorRightY = probe.floorRightY;
    const minRoof = Math.min(probe.roofLeftY, probe.roofCenterY, probe.roofRightY);
    capSoffitY = Math.max(at.y + Math.max(2.0, height - 0.35), minRoof - dCfg.capHeight * archCfg.capScale - 0.04);
    roofLeftY = probe.roofLeftY;
    roofCenterY = probe.roofCenterY;
    roofRightY = probe.roofRightY;
  }

  const postWidth = dCfg.postWidth * archCfg.postScale;
  const postDepth = dCfg.postDepth * archCfg.postScale;
  const capWidth = dCfg.capWidth * archCfg.capScale;
  const capHeight = dCfg.capHeight * archCfg.capScale;

  const leftOff = fitToRock && wallLeft !== null ? -(wallLeft - postWidth * 0.5 - 0.05) : -(halfSpan - postWidth * 0.5);
  const rightOff = fitToRock && wallRight !== null ? (wallRight - postWidth * 0.5 - 0.05) : (halfSpan - postWidth * 0.5);

  const condCfg = config.conditions[condition] ?? config.conditions.maintained;
  const effectiveConfig = tint !== null
    ? resolveMineTimberConfig({
      conditions: { [condition]: { ...condCfg, tintHex: tint } },
    }, config)
    : config;

  const plan = {
    index: 0,
    s: 0,
    seed,
    center: at,
    dir,
    right,
    archetype,
    condition,
    jointStyle,
    partialSide: null,
    postWidth,
    postDepth,
    capWidth,
    capHeight,
    braceWidth: dCfg.braceWidth * archCfg.braceScale,
    braceDepth: dCfg.braceDepth * archCfg.braceScale,
    leftPostOffset: leftOff,
    rightPostOffset: rightOff,
    floorLeftY,
    floorRightY,
    capSoffitY,
    capTopY: capSoffitY + capHeight,
    roofLeftY,
    roofCenterY,
    roofRightY,
    wallLeft,
    wallRight,
    hasLeftBrace: hasBraces,
    hasRightBrace: hasBraces,
    dropL: config.braces.kneeDropMin + rng() * 0.14,
    reachL: config.braces.kneeReachMin + rng() * 0.12,
    dropR: config.braces.kneeDropMin + rng() * 0.14,
    reachR: config.braces.kneeReachMin + rng() * 0.12,
    hasHardware: rng() < archCfg.hardwareChance,
    instability: 0.25,
    isPortal: true,
  };

  return buildTimberSupportFrame(b, cache, plan, effectiveConfig);
}
