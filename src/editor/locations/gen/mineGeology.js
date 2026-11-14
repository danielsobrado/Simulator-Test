import { fbm3, ridged3 } from './noise.js';
import { resolveMineGeologyConfig } from './mineGeologyConfig.js';

const clamp01 = (v) => (v <= 0 ? 0 : (v >= 1 ? 1 : v));
const smoothstep = (edge0, edge1, x) => {
  const span = edge1 - edge0;
  if (Math.abs(span) < 1e-6) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / span);
  return t * t * (3 - 2 * t);
};

/** Horizontal distance from `(x, z)` to a 3D segment `[a, b]` (plus vertical check). */
function segmentDistance(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay, pz - az);
  const t = clamp01(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  const cz = az + dz * t;
  const hDist = Math.hypot(px - cx, pz - cz);
  const vDist = Math.abs(py - cy);
  return Math.hypot(hDist, vDist * 1.4);
}

/** Minimum horizontal distance from a floor point to solid rock wall via `DensityGrid`. */
function probeWallProximity(grid, x, y, z, maxReach) {
  const probeY = y + 0.48;
  const half = maxReach * 0.5;
  let minSolid = maxReach + 0.5;
  // Four cardinal horizontal checks at two distances: fast and free of allocations.
  for (let dir = 0; dir < 4; dir += 1) {
    const dx = dir === 0 ? 1 : (dir === 1 ? -1 : 0);
    const dz = dir === 2 ? 1 : (dir === 3 ? -1 : 0);
    const sNear = grid.sample(x + dx * half, probeY, z + dz * half);
    if (sNear <= 0) {
      const d = half * clamp01(1 + sNear / Math.max(0.25, half));
      if (d < minSolid) minSolid = d;
      continue;
    }
    const sFar = grid.sample(x + dx * maxReach, probeY, z + dz * maxReach);
    if (sFar <= 0) {
      const t = sNear / Math.max(1e-4, sNear - sFar);
      const d = half + t * (maxReach - half);
      if (d < minSolid) minSolid = d;
    }
  }
  return clamp01(1 - minSolid / maxReach);
}

/** Downward `DensityGrid` fallback probe when no passage/room bounds cover `(x, y, z)`. */
function estimateAboveFloorFromGrid(grid, x, y, z) {
  if (!grid) return 0;
  const maxProbe = 0.65;
  const step = 0.13;
  let prevD = 0;
  let prevS = grid.sample(x, y, z);
  for (let d = step; d <= maxProbe + 1e-4; d += step) {
    const s = grid.sample(x, y - d, z);
    if (s <= 0) {
      if (prevS <= 0 && d === step) return 0;
      const t = prevS / Math.max(1e-4, prevS - s);
      return prevD + t * step;
    }
    prevD = d;
    prevS = s;
  }
  return maxProbe;
}

/**
 * Computes elevation above the local walkable floor (`aboveFloor`) and raised
 * mound weights using covering passage spines, chamber rooms, and a downward
 * `DensityGrid` fallback when no passage/room covers `(x, y, z)`.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {object} grid
 * @param {Array<{ spine: object, halfWidth: number }>} [passages]
 * @param {Array<{ x: number, z: number, rx: number, rz: number, floorY: number }>} [rooms]
 * @param {Array<{ x: number, y: number, z: number, radius: number }>} [mounds]
 * @returns {{ aboveFloor: number, moundWeight: number, moundCrownWeight: number }}
 */
export function computeFloorContext(x, y, z, grid, passages = [], rooms = [], mounds = []) {
  let hasCoverage = false;
  let bestNearAbove = Infinity;
  let bestNearAbs = Infinity;
  let bestBelowAbove = -Infinity;

  const considerAbove = (above) => {
    hasCoverage = true;
    if (above >= -0.45) {
      const absAbove = Math.abs(above);
      if (absAbove < bestNearAbs - 1e-6 || (Math.abs(absAbove - bestNearAbs) <= 1e-6 && above > bestNearAbove)) {
        bestNearAbs = absAbove;
        bestNearAbove = above;
      }
    } else if (above > bestBelowAbove) {
      bestBelowAbove = above;
    }
  };

  for (let i = 0; i < passages.length; i += 1) {
    const { spine, halfWidth } = passages[i];
    const proj = spine.project(x, y, z);
    if (Math.hypot(proj.across, proj.endOverflow) <= halfWidth + 2.2) {
      considerAbove(proj.above);
    }
  }

  for (let i = 0; i < rooms.length; i += 1) {
    const room = rooms[i];
    const normR = Math.hypot((x - room.x) / room.rx, (z - room.z) / room.rz);
    if (normR <= 1.25) {
      considerAbove(y - room.floorY);
    }
  }

  let aboveFloor;
  if (passages.length === 0 && rooms.length === 0) {
    aboveFloor = estimateAboveFloorFromGrid(grid, x, y, z);
  } else if (hasCoverage) {
    aboveFloor = bestNearAbs < Infinity ? bestNearAbove : bestBelowAbove;
  } else {
    aboveFloor = estimateAboveFloorFromGrid(grid, x, y, z);
  }

  let moundWeight = 0;
  for (let i = 0; i < mounds.length; i += 1) {
    const m = mounds[i];
    const d = Math.hypot(x - m.x, z - m.z);
    if (d >= m.radius || Math.abs(y - m.y) > m.radius * 1.5) continue;
    const w = smoothstep(m.radius, m.radius * 0.25, d);
    if (w > moundWeight) moundWeight = w;
  }
  const moundCrownWeight = moundWeight * smoothstep(0.14, 0.28, aboveFloor);

  return { aboveFloor, moundWeight, moundCrownWeight };
}

/**
 * Creates a deterministic geological & ground-surface classifier compatible
 * with `LocationBuilder.classify(p, n, mask, mask2)`.
 *
 * Writes:
 *   mask[0]  localized mineral / ore seam hint
 *   mask[1]  localized wetness / drainage moisture
 *   mask[2]  fracture / crevice darkening & mineral stain
 *   mask[3]  excavation freshness (0 weathered/abandoned .. 1 freshly worked)
 *   mask2[0] geological rock zone (0 dark stable .. 0.5 fractured .. 1 lighter stone)
 *   mask2[1] compacted earth / sediment cover on floors (0 exposed bedrock .. 1 earth)
 *   mask2[2] crushed stone / gravel / railway ballast weight
 *   mask2[3] wall-to-floor contact & dust/talus skirt accumulation + true-floor domain
 */
export function createMineGeologyClassifier({
  seed,
  grid,
  config: rawConfig,
  deposits = [],
  rails = [],
  zones = [],
  rubblePoints = [],
  footings = [],
  passages = [],
  rooms = [],
  mounds = [],
  waterY = -8.55,
}) {
  const config = resolveMineGeologyConfig(rawConfig);
  const {
    zoneScale,
    zoneContrast,
    beddingDipX,
    beddingDipZ,
    wallBlendWidth,
    sedimentAccumulation,
    gravelDensity,
    bedrockExposure,
    wetnessGain,
    drainageLevel,
    mineralIntensity,
    excavationContrast,
  } = config;

  return (p, n, mask, mask2) => {
    const x = p.x;
    const y = p.y;
    const z = p.z;
    const ny = n.y;

    // 1. Coherent tilted geological coordinates (world-space, chunk-independent).
    const gx = x;
    const gy = y + x * beddingDipX + z * beddingDipZ;
    const gz = z;

    // Domain-warped macro geological zone field (~20-30m transitions).
    const warp = (fbm3(gx * zoneScale * 0.72, gy * zoneScale * 0.72, gz * zoneScale * 0.72, seed + 19, 2) - 0.5) * 2.2;
    const rawZone = fbm3(
      gx * zoneScale + warp * 0.4,
      gy * zoneScale * 1.15 - warp * 0.25,
      gz * zoneScale + warp * 0.35,
      seed + 53,
      3,
    );
    const zone = clamp01(0.5 + (rawZone - 0.5) * (1.55 * zoneContrast));
    mask2[0] = zone;

    // 2. Geometry-aware concavity / crevice detection from the signed field.
    const probeDist = 0.7;
    const ahead = grid.sample(x + n.x * probeDist, y + n.y * probeDist, z + n.z * probeDist);
    const concavity = smoothstep(probeDist * 0.92, probeDist * 0.28, ahead);
    const protrusion = smoothstep(probeDist * 0.98, probeDist * 1.32, ahead);

    // Fracture & crevice stain field aligned to geological bedding.
    const fracCrease = ridged3(gx * 0.52, gy * 0.78, gz * 0.52, seed + 107);
    const fracMask = smoothstep(0.54, 0.88, fracCrease * 0.65 + concavity * 0.55);
    mask[2] = clamp01(fracMask * 0.75 + concavity * 0.35);

    // 3. Semantic mine zones: excavation freshness, traffic wear, gravel bias, moisture bias.
    let freshness = 0.45;
    let floorEarthBias = 0.68;
    let zoneGravelBias = 0.0;
    let zoneWetBias = 0.0;
    let zoneMineralBias = 0.0;

    if (zones.length > 0) {
      let wSum = 0;
      let fSum = 0;
      let eSum = 0;
      let gSum = 0;
      let wBias = 0;
      let mBias = 0;
      for (let i = 0; i < zones.length; i += 1) {
        const zn = zones[i];
        const dist = Math.hypot(x - zn.x, (y - zn.y) * 0.85, z - zn.z);
        const w = smoothstep(zn.radius, zn.radius * 0.25, dist);
        if (w <= 0) continue;
        wSum += w;
        fSum += w * (zn.freshness ?? 0.45);
        eSum += w * (zn.earthBias ?? 0.68);
        gSum += w * (zn.gravelBias ?? 0);
        wBias += w * (zn.wetBias ?? 0);
        mBias += w * (zn.mineralBias ?? 0);
      }
      if (wSum > 1e-4) {
        freshness = fSum / wSum;
        floorEarthBias = eSum / wSum;
        zoneGravelBias = gSum / wSum;
        zoneWetBias = wBias / wSum;
        zoneMineralBias = mBias / wSum;
      }
    }
    mask[3] = clamp01(0.5 + (freshness - 0.5) * excavationContrast);

    // 4. Restrained localized mineral / ore seam hints (no huge glowing orange blobs).
    let ore = 0;
    for (let i = 0; i < deposits.length; i += 1) {
      const [dx, dy, dz, radius] = deposits[i];
      const d = Math.hypot(x - dx, (y - dy) * 1.15, z - dz);
      const falloff = smoothstep(radius, radius * 0.25, d);
      if (falloff > ore) ore = falloff;
    }
    const seamNoise = smoothstep(0.42, 0.82, fbm3(gx * 0.35, gy * 0.65, gz * 0.35, seed + 149, 2));
    const ambientTrace = smoothstep(0.68, 0.92, fracCrease) * (0.15 + zoneMineralBias * 0.45);
    mask[0] = clamp01((ore * seamNoise * 0.9 + ambientTrace) * mineralIntensity * (1.2 + zone * 0.35));

    // 5. Localized wetness: drainage elevation, water proximity, seepage joints, low recesses.
    const seepNoise = fbm3(x * 0.16, y * 0.32, z * 0.16, seed + 31, 2);
    const drain = smoothstep(drainageLevel + 1.8, drainageLevel - 4.2, y);
    const poolProx = smoothstep(waterY + 2.4, waterY - 0.3, y);
    const wallSeep = smoothstep(0.63, 0.84, seepNoise) * (0.45 + concavity * 0.55) * (1 - Math.max(0, -ny) * 0.7);
    const lowPocket = smoothstep(0.52, 0.85, seepNoise) * concavity * smoothstep(0.1, 0.7, ny + 0.35);

    // 6. Floor classification & wall-to-floor transitions.
    // Gate floor & skirt masks strictly by true elevation above local walkable floor
    // so curved lower chamber walls and ore mound crowns stay bare rock.
    const { aboveFloor, moundWeight, moundCrownWeight } = computeFloorContext(
      x, y, z, grid, passages, rooms, mounds,
    );
    const aboveWater = smoothstep(waterY - 0.15, waterY + 0.75, y);
    const floorHeightMask = smoothstep(0.22, 0.04, Math.max(0, aboveFloor))
      * smoothstep(-0.35, -0.04, aboveFloor);
    const skirtHeightMask = smoothstep(0.32, 0.06, Math.max(0, aboveFloor))
      * smoothstep(-0.35, -0.04, aboveFloor);
    const baseFloorNormal = smoothstep(0.68, 0.88, ny) * floorHeightMask;
    const floorNormalMask = baseFloorNormal * (1 - moundCrownWeight * 0.85);
    const filletNormalMask = smoothstep(0.38, 0.76, ny) * smoothstep(0.95, 0.58, ny) * skirtHeightMask;
    let wallProx = 0;
    if (baseFloorNormal > 0.02 || filletNormalMask > 0.02) {
      wallProx = probeWallProximity(grid, x, y, z, wallBlendWidth * 1.45);
    }

    const wallBaseDamp = wallProx * concavity * smoothstep(0.42, 0.82, seepNoise) * 0.32 * aboveWater;
    const rawWet = (drain * 0.72 + poolProx * 0.85 + wallSeep * 0.55 + lowPocket * 0.25 + wallBaseDamp + zoneWetBias * 0.35) * wetnessGain;
    mask[1] = clamp01(rawWet);

    // Distance to rails (railway ballast bed) & rubble/footings.
    let railProx = 0;
    for (let i = 0; i < rails.length; i += 1) {
      const seg = rails[i];
      const d = segmentDistance(x, y, z, seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
      const pWeight = smoothstep(1.25, 0.38, d);
      if (pWeight > railProx) railProx = pWeight;
    }

    let rubbleProx = 0;
    for (let i = 0; i < rubblePoints.length; i += 1) {
      const rp = rubblePoints[i];
      const d = Math.hypot(x - rp.x, (y - rp.y) * 1.4, z - rp.z);
      const w = smoothstep(rp.radius, rp.radius * 0.22, d);
      if (w > rubbleProx) rubbleProx = w;
    }

    let footingProx = 0;
    for (let i = 0; i < footings.length; i += 1) {
      const ft = footings[i];
      const d = Math.hypot(x - ft.x, (y - ft.y) * 1.5, z - ft.z);
      const w = smoothstep(0.95, 0.25, d);
      if (w > footingProx) footingProx = w;
    }

    // Spatial variation along floors so straight tunnels never look uniform.
    const floorPatch = fbm3(x * 0.22, y * 0.22, z * 0.22, seed + 211, 2);
    const gravelPatch = fbm3(x * 0.38, y * 0.38, z * 0.38, seed + 263, 2);
    const skirtVar = fbm3(x * 0.42, y * 0.35, z * 0.42, seed + 307, 2);

    // Wall-to-floor skirt: hugs the actual floor edge, concave floor-wall pockets, and timber footings.
    // Also encodes true-floor domain (`floorNormalMask * 0.65`) so exposed bedrock floor patches stay active.
    const floorEdgeSkirt = smoothstep(0.18, 0.84, wallProx) * floorNormalMask;
    const concaveJointSkirt = filletNormalMask * (0.24 + 0.76 * smoothstep(0.18, 0.70, concavity))
      * smoothstep(0.22, 0.78, wallProx);
    const rawSkirt = clamp01(
      (floorEdgeSkirt * 0.82 + concaveJointSkirt * 0.76 + footingProx * 0.65 * floorNormalMask)
        * (0.22 + 0.92 * skirtVar) * sedimentAccumulation * aboveWater,
    );
    mask2[3] = clamp01(Math.max(floorNormalMask * 0.65, rawSkirt));

    // Crushed stone & gravel: railway ballast + excavation spillage + collapse aprons + wall-base talus.
    const wallTalus = wallProx * smoothstep(0.30, 0.76, gravelPatch) * 0.84;
    const rawGravel = (
      railProx * 0.94
      + rubbleProx * 0.9
      + zoneGravelBias * smoothstep(0.26, 0.72, gravelPatch) * 0.88
      + wallTalus
      + footingProx * 0.48
    ) * gravelDensity;
    const moundBaseGravelMask = moundWeight * smoothstep(0.28, 0.12, aboveFloor) * smoothstep(0.45, 0.80, ny);
    mask2[2] = clamp01(rawGravel * Math.max(floorNormalMask, concaveJointSkirt * 0.88, moundBaseGravelMask));

    // Compacted earth vs exposed bedrock:
    // Bedrock peeks through on protruding/freshly cut floor ribs and where floorPatch drops below bedrockExposure.
    const bedrockPocket = smoothstep(bedrockExposure + 0.22, bedrockExposure - 0.14, floorPatch - protrusion * 0.34);
    const earthCover = (floorEarthBias - bedrockPocket * 0.72 + wallProx * 0.12 * floorNormalMask + mask[1] * 0.14)
      * floorNormalMask * aboveWater;
    mask2[1] = clamp01(earthCover);

    return 0;
  };
}
