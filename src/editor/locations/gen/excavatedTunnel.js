import { resolveMineTunnelConfig } from './mineTunnelConfig.js';
import { evaluateGeologicalDisplacement, evaluateTunnelProfile } from './tunnelGeology.js';
import { buildTunnelSpine } from './tunnelSpine.js';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Builds a procedural excavated mine tunnel SDF shape compatible with `DensityGrid.carve`.
 *
 * Pipeline:
 *   spine (2+ points, smooth corners, roll-free frame)
 *   -> longitudinal profile channels (independent walls, shoulders, ceiling ridge/flatness)
 *   -> world-space multi-scale geological displacement (planar cleavage, tilted strata, meso ribs)
 *   -> reserved walkable/railway clearance envelope
 *
 * @param {Array<{x: number, y: number, z: number}>} points
 * @param {object} options
 * @param {number} options.width nominal passage width in metres
 * @param {number} options.height nominal ceiling height in metres
 * @param {number} [options.seed=1]
 * @param {object} [options.tunnelGeometry] config overrides matching `mineTunnelConfig`
 * @param {{ left?: number, right?: number, height?: number }} [options.clearance] explicit lateral/head clearance in metres
 * @param {{ start?: boolean, end?: boolean }} [options.blendEnds] whether to taper macro variation near endpoints
 */
export function excavatedTunnel(points, {
  width,
  height,
  seed = 1,
  tunnelGeometry,
  clearance,
  blendEnds = { start: true, end: true },
}) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`excavatedTunnel: invalid dimensions width=${width}, height=${height}.`);
  }
  const config = resolveMineTunnelConfig(tunnelGeometry);
  const spine = buildTunnelSpine(points, {
    samplingStep: config.samplingQuality,
    cornerRadius: config.cornerRadius,
  });

  const halfWidth = width * 0.5;
  const minNavHalf = Math.min(halfWidth - 0.12, config.minNavigationClearance);
  const clearLeft = Math.max(minNavHalf, clearance?.left ?? minNavHalf);
  const clearRight = Math.max(minNavHalf, clearance?.right ?? minNavHalf);
  const clearHead = Math.min(height - 0.15, clearance?.height ?? config.minHeadClearance);

  const blendStart = blendEnds?.start !== false;
  const blendEnd = blendEnds?.end !== false;

  const padSide = halfWidth + config.macroWidthVariation + config.geologicalDisplacement + config.fractureStrength + 2.6;
  const padUp = height + config.macroHeightVariation + config.geologicalDisplacement + config.fractureStrength + 2.2;
  const padDown = 1.6;

  const maxGeoReach = config.geologicalDisplacement * 2.3 + config.fractureStrength * 1.7 + 0.7;

  function evaluateAt(x, y, z) {
    const proj = spine.project(x, y, z);
    const { s, across, above, endOverflow, curvature } = proj;

    const profile = evaluateTunnelProfile(s, spine.totalLength, curvature, seed, config, {
      blendStart,
      blendEnd,
    });

    const ceilingHeight = Math.max(clearHead + 0.15, height + profile.ceilingDelta);
    const shL = ceilingHeight * profile.leftShoulder;
    const shR = ceilingHeight * profile.rightShoulder;

    const yL = clamp(above, 0, shL);
    const yR = clamp(above, 0, shR);

    const baseL = Math.max(clearLeft * 0.88, halfWidth + profile.leftMacro);
    const baseR = Math.max(clearRight * 0.88, halfWidth + profile.rightMacro);

    const wallXL = Math.min(-clearLeft * 0.85, -baseL - profile.leftBatter * yL);
    const wallXR = Math.max(clearRight * 0.85, baseR + profile.rightBatter * yR);
    const topXL = Math.min(-clearLeft * 0.85, -baseL - profile.leftBatter * shL);
    const topXR = Math.max(clearRight * 0.85, baseR + profile.rightBatter * shR);

    const span = Math.max(0.8, topXR - topXL);
    const midX = (topXL + topXR) * 0.5;
    const u = clamp((across - midX) / (span * 0.5), -1, 1);

    const uPeak = clamp(profile.peakShift, -0.56, 0.56);
    const r = u < uPeak
      ? (uPeak - u) / (1 + uPeak)
      : (u - uPeak) / (1 - uPeak);
    const shEdge = u < uPeak ? shL : shR;

    const archDrop = (1 - profile.ceilingFlat) * Math.pow(r, 1.12) + profile.ceilingFlat * Math.pow(r, 3.8);
    const roofY = ceilingHeight - (ceilingHeight - shEdge) * archDrop + profile.roofTilt * (u - uPeak) * (1 - r);

    const dLeft = (across - wallXL) / Math.hypot(1, profile.leftBatter);
    const dRight = (wallXR - across) / Math.hypot(1, profile.rightBatter);
    const dFloor = above;
    const dRoof = (roofY - above) * 0.88;

    const capPull = endOverflow > 0 ? Math.hypot(across, endOverflow) - Math.abs(across) : 0;
    const nominalAir = Math.min(dLeft, dRight, dFloor, dRoof) - capPull;

    if (nominalAir < -maxGeoReach || nominalAir > maxGeoReach) {
      return nominalAir;
    }

    // Evaluate 3D multi-scale geological displacement in the surface band.
    let geo = evaluateGeologicalDisplacement(x, y, z, seed, config, profile.activity, above, ceilingHeight);

    // Protect walkable & rail floor: flat in the reserved lane, gently irregular at wall-floor edges.
    const floorProx = smoothstep(0.65, 0.0, Math.max(0, above));
    if (floorProx > 0) {
      const edgeOut = across < -clearLeft
        ? (-clearLeft - across)
        : (across > clearRight ? (across - clearRight) : 0);
      const skirtWeight = smoothstep(0.05, 0.45, edgeOut) * 0.4;
      geo *= 1 - floorProx * (1 - skirtWeight);
    }

    // Taper displacement softly on capped ends so portals fit cleanly.
    if (endOverflow > 0) {
      geo *= smoothstep(halfWidth, 0, endOverflow);
    }

    const rawAir = nominalAir + geo;

    // Reserved walkable & railway clearance envelope: rock can never protrude inside.
    const upperBevel = Math.min(0.22, Math.max(0, above - 1.75) * 0.25);
    const cLeft = across - (-clearLeft + upperBevel);
    const cRight = (clearRight - upperBevel) - across;
    const cFloor = above;
    const cRoof = clearHead - above;
    const clearanceAir = Math.min(cLeft, cRight, cFloor, cRoof) - capPull;

    return Math.max(rawAir, clearanceAir);
  }

  return {
    spine,
    config,
    box: {
      min: {
        x: spine.boundsMin.x - padSide,
        y: spine.boundsMin.y - padDown,
        z: spine.boundsMin.z - padSide,
      },
      max: {
        x: spine.boundsMax.x + padSide,
        y: spine.boundsMax.y + padUp,
        z: spine.boundsMax.z + padSide,
      },
    },
    air: evaluateAt,
    /** Evaluates the nominal profile summary at longitudinal distance `s` (for inspection/tests). */
    profileAt(s) {
      return evaluateTunnelProfile(s, spine.totalLength, 0, seed, config, { blendStart, blendEnd });
    },
  };
}
