/**
 * Resolve worn soft-stone topology from face relief + edge wear.
 *
 * Pure data: no Three.js. The mesh writer only consumes the rings and depths
 * returned here. The source ring is never modified.
 */

import {
  insetRingVariable,
  variableInsetSurvived,
} from '../../workshop/ProceduralWorkshopGeometry.js';

function polygonArea(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

function cloneRing(ring) {
  return ring.map(([x, y]) => [x, y]);
}

function normalizeRing(corners) {
  const ring = cloneRing(corners);
  if (polygonArea(ring) < 0) ring.reverse();
  return ring;
}

function edgeInsetsFromCorners(cornerWidth, variationScale, insetScale = 1) {
  const count = cornerWidth.length;
  const insets = [];
  const base = (cornerWidth.reduce((sum, value) => sum + value, 0) / count) * insetScale;
  for (let index = 0; index < count; index += 1) {
    const a = cornerWidth[index];
    const b = cornerWidth[(index + 1) % count];
    const mean = ((a + b) / 2) * insetScale;
    // variationScale 0 → uniform base; 1 → full per-corner mean.
    insets.push(lerp(base, mean, variationScale));
  }
  return insets;
}

function depthsFromCorners(cornerDepth, variationScale, insetScale = 1) {
  const mean = cornerDepth.reduce((sum, value) => sum + value, 0) / cornerDepth.length;
  return cornerDepth.map((value) => lerp(mean, value, variationScale) * insetScale);
}

function tryInset(sourceRing, edgeInset, safeguards) {
  const inset = insetRingVariable(sourceRing, edgeInset);
  if (!inset) {
    return { valid: false, reason: 'variable-inset-self-intersection', inset: null };
  }
  const check = variableInsetSurvived(sourceRing, inset, safeguards);
  return { ...check, inset: check.valid ? inset : null };
}

function softenFlattenedCorners(faceCorners, sourceRing, flattening) {
  const result = cloneRing(faceCorners);
  let flattened = 0;
  for (let index = 0; index < 4; index += 1) {
    const strength = flattening[index];
    if (!(strength > 0)) continue;
    const prev = (index + 3) % 4;
    const next = (index + 1) % 4;
    const edgeLenA = Math.hypot(
      sourceRing[index][0] - sourceRing[prev][0],
      sourceRing[index][1] - sourceRing[prev][1],
    );
    const edgeLenB = Math.hypot(
      sourceRing[next][0] - sourceRing[index][0],
      sourceRing[next][1] - sourceRing[index][1],
    );
    const flattenLength = Math.min(
      0.035,
      Math.max(0.004, Math.min(edgeLenA, edgeLenB) * strength),
    );
    // Pull the face corner slightly toward the chord of its neighbours so the
    // arris reads as a short worn plane without changing ring vertex count.
    const chord = lerpPoint(result[prev], result[next], 0.5);
    const pull = Math.min(0.35, flattenLength / Math.max(Math.min(edgeLenA, edgeLenB), 1e-6));
    result[index] = lerpPoint(result[index], chord, pull);
    flattened += 1;
  }
  return { corners: result, flattened };
}

function buildLoops({
  sourceRing,
  faceCorners,
  shoulderCorners,
  edgeWear,
  cornerDepths,
}) {
  void edgeWear;
  // Near LOD uses the four solved corners for both bevel bands. Midpoint bowing
  // stays available via edgeMidpointScale in the sampler for a later denser pass
  // once the triangle budget allows; variable corner insets already break the
  // uniform machine-cut ring.
  const sourceLoop = cloneRing(sourceRing);
  const shoulderLoop = cloneRing(shoulderCorners);
  const faceLoop = cloneRing(faceCorners);
  const outerDepths = cornerDepths.map((value) => value);
  const shoulderDepths = cornerDepths.map((value) => value * 0.55);

  return {
    sourceLoop,
    shoulderLoop,
    faceLoop,
    outerDepths,
    shoulderDepths,
  };
}

function resolveSideTopology({
  sourceRing,
  edgeWear,
  faceRelief,
  depth,
  variationScale,
  insetScale = 1,
  bevelRings = 2,
  allowCornerFlattening = true,
}) {
  void depth;
  const edgeInset = edgeInsetsFromCorners(edgeWear.cornerWidth, variationScale, insetScale);
  const cornerDepths = depthsFromCorners(edgeWear.cornerDepth, variationScale, insetScale);
  const faceAttempt = tryInset(sourceRing, edgeInset, edgeWear.safeguards);
  if (!faceAttempt.valid) {
    return { valid: false, reason: faceAttempt.reason, areaRatio: faceAttempt.areaRatio };
  }

  const rings = bevelRings <= 1 ? 1 : 2;
  const shoulderInset = edgeInset.map((value) => value * (rings === 1 ? 1 : 0.55));
  const shoulderAttempt = tryInset(sourceRing, shoulderInset, {
    ...edgeWear.safeguards,
    minimumFaceAreaRatio: Math.max(0.35, edgeWear.safeguards.minimumFaceAreaRatio * 0.85),
    minimumEdgeLength: edgeWear.safeguards.minimumEdgeLength * 0.75,
  });
  if (!shoulderAttempt.valid) {
    return { valid: false, reason: shoulderAttempt.reason };
  }

  const faceCornersRaw = faceAttempt.inset;
  const flattening = allowCornerFlattening
    ? edgeWear.cornerFlattening
    : [0, 0, 0, 0];
  const softened = softenFlattenedCorners(
    faceCornersRaw,
    sourceRing,
    flattening,
  );
  const faceCorners = softened.corners;
  // One-ring coarse: shoulder coincides with the face so the writer emits a
  // single bevel band from source → face.
  const shoulderCorners = rings === 1 ? faceCorners : shoulderAttempt.inset;
  const loops = buildLoops({
    sourceRing,
    faceCorners,
    shoulderCorners,
    edgeWear,
    cornerDepths,
  });
  if (rings === 1) {
    loops.shoulderDepths = loops.outerDepths.map((value) => value);
    loops.shoulderLoop = cloneRing(faceCorners);
  }

  const maxShoulderDepth = Math.max(...loops.shoulderDepths);
  const maxOuterDepth = Math.max(...loops.outerDepths);
  if (rings === 2) {
    if (!(maxOuterDepth > maxShoulderDepth) || !(maxShoulderDepth > 0)) {
      return { valid: false, reason: 'depth-order-invalid' };
    }
  } else if (!(maxOuterDepth > 0)) {
    return { valid: false, reason: 'depth-order-invalid' };
  }

  const requestedFaceRecession = faceRelief?.enabled ? faceRelief.edgeRecession : 0;
  const depthBudget = rings === 1 ? maxOuterDepth * 0.72 : maxShoulderDepth * 0.72;
  const faceEdgeRecession = Math.min(requestedFaceRecession, depthBudget);
  if (faceRelief?.enabled && !(faceEdgeRecession < (rings === 1 ? maxOuterDepth : maxShoulderDepth))) {
    return { valid: false, reason: 'depth-order-invalid' };
  }

  const relief = faceRelief?.enabled
    ? Object.freeze({
      ...faceRelief,
      edgeRecession: faceEdgeRecession,
    })
    : null;

  return {
    valid: true,
    faceCorners,
    shoulderCorners,
    ...loops,
    cornerDepths,
    faceEdgeRecession,
    relief,
    areaRatio: faceAttempt.areaRatio,
    flattenedCorners: softened.flattened,
    bevelRings: rings,
  };
}

/**
 * @returns {object} immutable topology descriptor or fallback diagnostics
 */
export function resolveStoneTopology({
  stoneShape,
  faceRelief,
  edgeWear,
  mortarConfig,
  bevelRings = 2,
  allowCornerFlattening = true,
}) {
  void mortarConfig;
  const sourceRing = normalizeRing(stoneShape.corners);
  const rings = bevelRings <= 1 ? 1 : 2;
  const diagnostics = {
    edgeWearRequested: Boolean(edgeWear?.front?.enabled || edgeWear?.back?.enabled),
    edgeWearApplied: false,
    variableInsetClamped: false,
    flatteningDropped: false,
    fallbackReason: null,
    areaRatio: null,
    bevelRings: rings,
  };

  if (sourceRing.length < 4 || !(polygonArea(sourceRing) > 1e-8)) {
    return Object.freeze({
      valid: false,
      sourceRing,
      diagnostics: Object.freeze({
        ...diagnostics,
        fallbackReason: 'source-ring-invalid',
      }),
    });
  }

  const frontWear = edgeWear?.front;
  const backWear = edgeWear?.back;
  if (!frontWear?.enabled || !backWear?.enabled) {
    return Object.freeze({
      valid: false,
      sourceRing,
      diagnostics: Object.freeze({
        ...diagnostics,
        fallbackReason: 'edge-wear-required',
      }),
    });
  }

  let chosen = null;
  const attempts = [
    { variationScale: 1, insetScale: 1 },
    { variationScale: 0.75, insetScale: 1 },
    { variationScale: 0.5, insetScale: 1 },
    { variationScale: 0, insetScale: 1 },
    { variationScale: 0, insetScale: 0.7 },
    { variationScale: 0, insetScale: 0.45 },
  ];
  for (const attempt of attempts) {
    const front = resolveSideTopology({
      sourceRing,
      edgeWear: frontWear,
      faceRelief: faceRelief?.front ?? null,
      depth: stoneShape.depth,
      variationScale: attempt.variationScale,
      insetScale: attempt.insetScale,
      bevelRings: rings,
      allowCornerFlattening,
    });
    if (!front.valid) {
      diagnostics.fallbackReason = front.reason;
      continue;
    }
    const back = resolveSideTopology({
      sourceRing,
      edgeWear: backWear,
      faceRelief: faceRelief?.back ?? null,
      depth: stoneShape.depth,
      variationScale: attempt.variationScale,
      insetScale: attempt.insetScale,
      bevelRings: rings,
      allowCornerFlattening,
    });
    if (!back.valid) {
      diagnostics.fallbackReason = back.reason;
      continue;
    }
    chosen = {
      front,
      back,
      scale: attempt.variationScale,
      insetScale: attempt.insetScale,
    };
    break;
  }

  if (!chosen) {
    return Object.freeze({
      valid: false,
      sourceRing,
      diagnostics: Object.freeze(diagnostics),
    });
  }

  diagnostics.edgeWearApplied = true;
  diagnostics.variableInsetClamped = chosen.scale < 1 || chosen.insetScale < 1;
  diagnostics.fallbackReason = null;
  diagnostics.areaRatio = Math.min(chosen.front.areaRatio, chosen.back.areaRatio);

  return Object.freeze({
    valid: true,
    sourceRing: Object.freeze(cloneRing(sourceRing)),
    depth: stoneShape.depth,
    width: stoneShape.width,
    height: stoneShape.height,
    bevelRings: rings,
    front: Object.freeze({
      faceCorners: Object.freeze(cloneRing(chosen.front.faceCorners)),
      shoulderCorners: Object.freeze(cloneRing(chosen.front.shoulderCorners)),
      sourceLoop: Object.freeze(cloneRing(chosen.front.sourceLoop)),
      shoulderLoop: Object.freeze(cloneRing(chosen.front.shoulderLoop)),
      faceLoop: Object.freeze(cloneRing(chosen.front.faceLoop)),
      outerDepths: Object.freeze([...chosen.front.outerDepths]),
      shoulderDepths: Object.freeze([...chosen.front.shoulderDepths]),
      faceEdgeRecession: chosen.front.faceEdgeRecession,
      relief: chosen.front.relief,
      flattenedCorners: chosen.front.flattenedCorners,
      bevelRings: rings,
    }),
    back: Object.freeze({
      faceCorners: Object.freeze(cloneRing(chosen.back.faceCorners)),
      shoulderCorners: Object.freeze(cloneRing(chosen.back.shoulderCorners)),
      sourceLoop: Object.freeze(cloneRing(chosen.back.sourceLoop)),
      shoulderLoop: Object.freeze(cloneRing(chosen.back.shoulderLoop)),
      faceLoop: Object.freeze(cloneRing(chosen.back.faceLoop)),
      outerDepths: Object.freeze([...chosen.back.outerDepths]),
      shoulderDepths: Object.freeze([...chosen.back.shoulderDepths]),
      faceEdgeRecession: chosen.back.faceEdgeRecession,
      relief: chosen.back.relief,
      flattenedCorners: chosen.back.flattenedCorners,
      bevelRings: rings,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}
