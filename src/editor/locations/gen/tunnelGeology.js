import { fbm3, ridged3, valueNoise3 } from './noise.js';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function latticeHash(ix, iy, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Domain-warped 1D fractal noise contrast-stretched to [0, 1] for non-periodic
 * longitudinal evolution across the full parameter range.
 */
function warpedFbm1(s, freq, seed) {
  const warp = (valueNoise3(s * freq * 0.55, 0.37, 0.83, seed + 5) - 0.5) * 2.2;
  const raw = fbm3(s * freq + warp, 0.5, 0.5, seed, 3);
  return smoothstep(0.28, 0.72, raw);
}

/** Biases [0, 1] noise toward outward overbreak [-0.26, +1.06] so passages rarely choke. */
const biasOverbreak = (v) => -0.26 + v * 1.32;

/**
 * Evaluates independent, spatially correlated cross-section profile parameters
 * at longitudinal arc distance `s` along a tunnel spine.
 *
 * @param {number} s arc distance in metres
 * @param {number} totalLength total spine length in metres
 * @param {number} curvature local turn rate in rad/m
 * @param {number} seed deterministic tunnel seed
 * @param {ReturnType<import('./mineTunnelConfig.js').resolveMineTunnelConfig>} config
 * @param {{ blendStart?: boolean, blendEnd?: boolean }} [ends]
 */
export function evaluateTunnelProfile(s, totalLength, curvature, seed, config, { blendStart = true, blendEnd = true } = {}) {
  const dStart = blendStart ? smoothstep(0, config.junctionBlendDistance, s) : 1;
  const dEnd = blendEnd ? smoothstep(0, config.junctionBlendDistance, totalLength - s) : 1;
  const endWeight = Math.min(dStart, dEnd);

  // Visual-rest contrast: rock competence alternates gradually between cleaner cut zones and heavy overbreak.
  const activity = 0.34 + 0.66 * smoothstep(0.28, 0.72, warpedFbm1(s, 0.068, seed + 13));
  const sharedStress = warpedFbm1(s, 0.082, seed + 47) - 0.48;
  const bendExpand = Math.min(0.55, curvature * 1.8) * endWeight;

  const leftMacro = (biasOverbreak(warpedFbm1(s, 0.095, seed + 101)) * 0.82 + sharedStress * 0.28)
    * config.macroWidthVariation * endWeight + bendExpand;
  const rightMacro = (biasOverbreak(warpedFbm1(s, 0.095, seed + 211)) * 0.82 + sharedStress * 0.28)
    * config.macroWidthVariation * endWeight + bendExpand;

  const asym = config.wallAsymmetry;
  // Wall batter: positive flares outward with height, negative tapers inward toward the shoulder.
  const leftBatter = (warpedFbm1(s, 0.118, seed + 313) - 0.48) * 0.36 * asym * endWeight;
  const rightBatter = (warpedFbm1(s, 0.118, seed + 419) - 0.48) * 0.36 * asym * endWeight;

  // Independent shoulder heights (fraction of ceiling height where vertical wall transitions to roof).
  const leftShoulder = clamp(0.62 + (warpedFbm1(s, 0.128, seed + 521) - 0.5) * 0.56 * asym, 0.36, 0.86);
  const rightShoulder = clamp(0.62 + (warpedFbm1(s, 0.128, seed + 631) - 0.5) * 0.56 * asym, 0.36, 0.86);

  const ceilingDelta = biasOverbreak(warpedFbm1(s, 0.084, seed + 733)) * config.macroHeightVariation * endWeight;
  const peakShift = (warpedFbm1(s, 0.104, seed + 853) - 0.5) * 1.25 * config.ceilingOffset * endWeight;
  const ceilingFlat = clamp(0.12 + warpedFbm1(s, 0.092, seed + 967) * 0.9 * config.ceilingFlattening, 0.04, 0.98);
  const roofTilt = (warpedFbm1(s, 0.112, seed + 1069) - 0.5) * 0.72 * asym * endWeight;

  return {
    activity,
    endWeight,
    leftMacro,
    rightMacro,
    leftBatter,
    rightBatter,
    leftShoulder,
    rightShoulder,
    ceilingDelta,
    peakShift,
    ceilingFlat,
    roofTilt,
  };
}

/**
 * 3D faceted cellular rock-block cleavage (zero heap allocations).
 * Inside each rock block the boundary follows a tilted planar facet; along cell
 * borders `d2 - d1` forms crisp angular joints and recessed wedge pockets.
 */
function rockCleavage3D(qx, qy, qz, seed) {
  const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
  let bestD2 = 1e9, secondD2 = 1e9;
  let bestSx = 0, bestSy = 0, bestSz = 0;
  let bestCx = ix, bestCy = iy, bestCz = iz;

  for (let dz = -1; dz <= 1; dz += 1) {
    const cz = iz + dz;
    for (let dy = -1; dy <= 1; dy += 1) {
      const cy = iy + dy;
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = ix + dx;
        const jx = latticeHash(cx, cy, cz, seed);
        const jy = latticeHash(cx, cy, cz, seed + 17);
        const jz = latticeHash(cx, cy, cz, seed + 37);
        const sx = cx + 0.14 + jx * 0.72;
        const sy = cy + 0.14 + jy * 0.72;
        const sz = cz + 0.14 + jz * 0.72;
        const vx = qx - sx, vy = qy - sy, vz = qz - sz;
        const d2 = vx * vx + vy * vy + vz * vz;
        if (d2 < bestD2) {
          secondD2 = bestD2;
          bestD2 = d2;
          bestSx = sx; bestSy = sy; bestSz = sz;
          bestCx = cx; bestCy = cy; bestCz = cz;
        } else if (d2 < secondD2) {
          secondD2 = d2;
        }
      }
    }
  }

  const d1 = Math.sqrt(bestD2);
  const d2 = Math.sqrt(secondD2);
  const edge = d2 - d1;

  // Deterministic block-face normal & offset per cell.
  const blockRand = latticeHash(bestCx, bestCy, bestCz, seed + 71);
  const nx = latticeHash(bestCx, bestCy, bestCz, seed + 103) - 0.5;
  const ny = latticeHash(bestCx, bestCy, bestCz, seed + 139) - 0.5;
  const nz = latticeHash(bestCx, bestCy, bestCz, seed + 173) - 0.5;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const planeDot = ((qx - bestSx) * nx + (qy - bestSy) * ny + (qz - bestSz) * nz) / nLen;

  // Biased positive so overbreak wedge pockets are stronger and more natural than inward pinch.
  const blockRelief = (blockRand - 0.38) * 1.7;
  const edgeBlend = smoothstep(0.02, 0.22, edge);
  const jointCrease = -(1 - smoothstep(0.0, 0.24, edge)) * 0.38;
  return blockRelief * edgeBlend + planeDot * 0.58 + jointCrease;
}

/**
 * Evaluates world-space 3D geological displacement (metres: > 0 expands outward
 * into overbreak/recesses, < 0 protrudes inward as rock bulges/fractures).
 *
 * Uses world coordinates so adjacent segments and streaming chunks never drift
 * or duplicate features.
 */
export function evaluateGeologicalDisplacement(x, y, z, seed, config, activity, above, ceilingHeight) {
  const dipX = config.beddingDipX;
  const dipZ = config.beddingDipZ;

  // Rotate/shear into tilted geological bedding coordinates so fractures align with rock strata.
  const gx = x;
  const gy = y + x * dipX + z * dipZ;
  const gz = z;

  // 1. Meso coherent rock masses (directionally stretched along strike).
  const fScale = config.featureScale;
  const warp = (fbm3(gx * 0.14, gy * 0.14, gz * 0.14, seed + 23, 2) - 0.5) * 1.6;
  const mesoMass = (fbm3(gx * fScale * 0.78 + warp * 0.35, gy * fScale * 1.25, gz * fScale * 0.78 - warp * 0.35, seed + 61, 2) - 0.45) * 1.7;

  // 2. Angular rock-block cleavage facets at primary (multi-metre) and secondary fracture scales.
  const cScale = config.fractureFrequency;
  const primaryCleavage = rockCleavage3D(gx * fScale * 0.85, gy * fScale * 1.15, gz * fScale * 0.85, seed + 193);
  const secondaryCleavage = rockCleavage3D(gx * cScale * 1.45 + 3.1, gy * cScale * 1.75, gz * cScale * 1.45 - 1.7, seed + 317);
  const fractures = primaryCleavage * 0.68 + secondaryCleavage * 0.32;

  // 3. Tilted bedding shelves & flat roof-parting ledges (patchy so not uniform stripes).
  const strataPatch = smoothstep(0.36, 0.68, fbm3(x * 0.09, y * 0.12, z * 0.09, seed + 401, 2));
  const strataPhase = gy * 0.92 + warp * 0.75;
  const frac = strataPhase - Math.floor(strataPhase);
  // Asymmetric sawtooth ledge: sharp underside overhang, sloped upper face.
  const ledge = (frac < 0.28 ? (frac / 0.28) * 2 - 1 : 1 - ((frac - 0.28) / 0.72) * 2) * 0.55;
  // Stronger near shoulder/upper walls and ceiling partings.
  const roofProx = smoothstep(ceilingHeight * 0.45, ceilingHeight * 0.9, above);
  const strataRelief = ledge * strataPatch * (0.45 + 0.55 * roofProx);

  // 4. Micro-silhouette chipped angular ridges (no excessive high-frequency noise).
  const microChip = (ridged3(gx * 1.15, gy * 1.4, gz * 1.15, seed + 509) - 0.5) * 0.22;

  const raw = (
    mesoMass * config.geologicalDisplacement
    + (fractures + strataRelief * 0.65) * config.fractureStrength
    + microChip * Math.min(0.6, config.fractureStrength + 0.15)
  ) * activity;

  // Clamp inward protrusions (`raw < 0`) to `maxProtrusion`, while permitting deeper outward overbreak.
  return clamp(raw, -config.maxProtrusion, config.geologicalDisplacement * 2.2 + config.fractureStrength * 1.6);
}
