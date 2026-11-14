import * as THREE from 'three/webgpu';
import { createRng } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export function hashPosition(x, y, z, salt = 0) {
  let h = (Math.round(x * 100) * 73856093)
    ^ (Math.round(y * 100) * 19349663)
    ^ (Math.round(z * 100) * 83492791)
    ^ (salt | 0);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Computes orthonormal right-handed frame `(sideAxis, depthAxis, axis)` along `a -> b`. */
export function buildMemberBasis(a, b, sideHint = null) {
  const axis = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const length = axis.length();
  if (length < 1e-5) {
    return {
      length: 0,
      axis: new THREE.Vector3(0, 1, 0),
      sideAxis: new THREE.Vector3(1, 0, 0),
      depthAxis: new THREE.Vector3(0, 0, -1),
    };
  }
  axis.multiplyScalar(1 / length);

  let sideAxis = sideHint
    ? new THREE.Vector3(sideHint.x, sideHint.y, sideHint.z).addScaledVector(axis, -(sideHint.x * axis.x + sideHint.y * axis.y + sideHint.z * axis.z))
    : new THREE.Vector3().crossVectors(UP, axis);
  if (sideAxis.lengthSq() < 1e-6) {
    sideAxis = new THREE.Vector3().crossVectors(X_AXIS, axis);
  }
  if (sideAxis.lengthSq() < 1e-6) {
    sideAxis = new THREE.Vector3().crossVectors(Z_AXIS, axis);
  }
  sideAxis.normalize();
  // Right-handed (sideAxis, depthAxis, axis): sideAxis x depthAxis = axis.
  const depthAxis = new THREE.Vector3().crossVectors(axis, sideAxis).normalize();
  return { length, axis, sideAxis, depthAxis };
}

function pushTriangle(positions, normals, uvs, masks, p0, p1, p2, uv0, uv1, uv2, m0, m1, m2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-10) return;
  nx /= nLen; ny /= nLen; nz /= nLen;

  positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  uvs.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]);
  masks.push(
    m0[0], m0[1], m0[2], m0[3],
    m1[0], m1[1], m1[2], m1[3],
    m2[0], m2[1], m2[2], m2[3],
  );
}

function pushQuad(positions, normals, uvs, masks, p0, p1, p2, p3, uv0, uv1, uv2, uv3, m0, m1, m2, m3) {
  pushTriangle(positions, normals, uvs, masks, p0, p1, p2, uv0, uv1, uv2, m0, m1, m2);
  pushTriangle(positions, normals, uvs, masks, p0, p2, p3, uv0, uv2, uv3, m0, m2, m3);
}

/**
 * Reusable cache for unit/template geometries (pegs, bolts, straps, plates, wedges)
 * so repeated connection hardware avoids redundant vertex buffer construction.
 */
export class TimberGeometryCache {
  constructor() {
    this.templates = new Map();
  }

  getOrCreate(key, factory) {
    if (!this.templates.has(key)) {
      this.templates.set(key, factory());
    }
    return this.templates.get(key).clone();
  }
}

/**
 * Generates a hand-hewn chamfered rectangular timber beam from `a` to `b`
 * with planar faces, crisp corner bevels, subtle bow/taper, localized edge
 * chips, optional longitudinal seasoning splits, mitered/saw-cut ends, and
 * grain-aligned UVs + `woodMask` (`endGrain`, `damp`, `edgeWear`, `hasWoodUv`).
 */
export function createTimberBeam(a, b, width, depth, {
  sideHint = null,
  bevelRatio = 0.145,
  irregular = 0.24,
  bow = 0.006,
  taper = 0.05,
  sawSkew = 0.018,
  chipChance = 0.55,
  chipDepth = 0.015,
  splitChance = 0.25,
  splitDepth = 0.01,
  longitudinalStep = 0.58,
  maxSteps = 10,
  uvScale = 0.55,
  dampStart = 0.15,
  dampEnd = 0.15,
  wear = 0.45,
  startCutNormal = null,
  endCutNormal = null,
  seed = hashPosition(a.x + b.x, a.y + b.y, a.z + b.z, 71),
} = {}) {
  const { length, axis, sideAxis, depthAxis } = buildMemberBasis(a, b, sideHint);
  if (length < 0.01) {
    return new THREE.BoxGeometry(0.02, 0.02, 0.02).translate(a.x, a.y, a.z);
  }

  const rng = createRng(seed);
  const w = Math.max(0.025, width);
  const d = Math.max(0.025, depth);
  const hw = w * 0.5;
  const hd = d * 0.5;
  const bv = Math.min(Math.min(w, d) * bevelRatio, hw * 0.34, hd * 0.34);
  const steps = Math.max(3, Math.min(maxSteps, Math.ceil(length / longitudinalStep)));

  // Restrained camber and lateral drift along the span.
  const camberSign = rng() < 0.5 ? -1 : 1;
  const bowD = -Math.abs(bow) * length * (0.4 + rng() * 0.6);
  const bowS = camberSign * Math.abs(bow) * length * 0.45 * rng();
  const twistRate = (rng() - 0.5) * 0.045 * irregular;

  // Deterministic saw-cut cant when no explicit miter plane is provided.
  const startSkewS = startCutNormal ? 0 : (rng() - 0.5) * sawSkew * w;
  const startSkewD = startCutNormal ? 0 : (rng() - 0.5) * sawSkew * d;
  const endSkewS = endCutNormal ? 0 : (rng() - 0.5) * sawSkew * w;
  const endSkewD = endCutNormal ? 0 : (rng() - 0.5) * sawSkew * d;

  const sNormDot = startCutNormal
    ? -(startCutNormal.x * axis.x + startCutNormal.y * axis.y + startCutNormal.z * axis.z)
    : 1;
  const eNormDot = endCutNormal
    ? (endCutNormal.x * axis.x + endCutNormal.y * axis.y + endCutNormal.z * axis.z)
    : 1;
  const maxCutOffset = Math.min(length * 0.36, Math.max(w, d) * 1.5);

  // Up to 2 localized edge chips on corner bevels (bevel indices 1, 3, 5, 7 in 8-pt ring).
  const chips = [];
  if (length > 0.35 && rng() < chipChance) {
    const chipCount = length > 1.4 && rng() < 0.42 ? 2 : 1;
    for (let c = 0; c < chipCount; c += 1) {
      chips.push({
        t: 0.14 + rng() * 0.72,
        span: Math.min(0.22, Math.max(0.08, 0.18 / Math.max(0.35, length))),
        corner: Math.floor(rng() * 4), // 0..3 -> bevel edges (1,2), (3,4), (5,6), (7,0)
        depth: Math.min(Math.min(hw, hd) * 0.28, chipDepth * (0.7 + rng() * 0.6)),
      });
    }
  }

  // Optional longitudinal seasoning split along one main planar face (0, 2, 4, or 6).
  const hasSplit = length > 0.55 && rng() < splitChance;
  const splitFace = hasSplit ? Math.floor(rng() * 4) * 2 : -1;
  const splitT0 = 0.08 + rng() * 0.25;
  const splitT1 = Math.min(0.95, splitT0 + 0.35 + rng() * 0.45);
  const splitD = Math.min(Math.min(hw, hd) * 0.22, splitDepth * (0.75 + rng() * 0.5));

  // Base 8-point chamfered rectangle in (S, D) CCW order:
  // 0:(+hw,-(hd-bv)), 1:(+hw,+(hd-bv)), 2:(+(hw-bv),+hd), 3:(-(hw-bv),+hd),
  // 4:(-hw,+(hd-bv)), 5:(-hw,-(hd-bv)), 6:(-(hw-bv),-hd), 7:(+(hw-bv),-hd)
  const basePts = [
    [hw, -(hd - bv)],
    [hw, hd - bv],
    [hw - bv, hd],
    [-(hw - bv), hd],
    [-hw, hd - bv],
    [-hw, -(hd - bv)],
    [-(hw - bv), -hd],
    [hw - bv, -hd],
  ];

  // Slight per-vertex hand-hewn irregularity (consistent per vertex index along a given face).
  const faceJitter = basePts.map(() => (rng() - 0.5) * 0.06 * irregular);
  const uvOffsetU = rng() * 0.85;
  const uvOffsetV = rng() * 0.85;

  // Perimeter arc lengths for clean side-face UVs.
  const perimU = [0];
  for (let k = 0; k < 8; k += 1) {
    const kn = (k + 1) % 8;
    const segLen = Math.hypot(basePts[kn][0] - basePts[k][0], basePts[kn][1] - basePts[k][1]);
    perimU.push(perimU[k] + segLen * uvScale);
  }

  const rings = [];
  const centers = [];
  const ringDamp = [];
  const ringCornerWear = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const env = Math.sin(t * Math.PI);
    const scale = 1 + taper * (0.5 - t);
    const twist = (t - 0.5) * twistRate;
    const ct = Math.cos(twist), st = Math.sin(twist);

    // Subtle organic hew wave along the span.
    const waveS = env * bowS + Math.sin(t * Math.PI * 2.3 + uvOffsetU * 6) * 0.005 * irregular * env;
    const waveD = env * bowD + Math.sin(t * Math.PI * 1.9 + uvOffsetV * 6) * 0.005 * irregular * env;

    const ring = [];
    const cornerWear = new Array(8).fill(wear * 0.25);

    let sumX = 0, sumY = 0, sumZ = 0;
    for (let k = 0; k < 8; k += 1) {
      let ls = basePts[k][0] * scale * (1 + faceJitter[k] * (0.5 + 0.5 * Math.sin(t * Math.PI * 3 + k)));
      let ld = basePts[k][1] * scale * (1 + faceJitter[(k + 3) % 8] * (0.5 + 0.5 * Math.cos(t * Math.PI * 2.5 + k)));

      // Apply localized corner chips on the two vertices framing a bevel edge.
      const cornerIdx = Math.floor(((k + 7) % 8) / 2); // maps (1,2)->0, (3,4)->1, (5,6)->2, (7,0)->3
      for (const chip of chips) {
        if (chip.corner !== cornerIdx) continue;
        const distT = Math.abs(t - chip.t);
        if (distT < chip.span) {
          const wChip = 0.5 * (1 + Math.cos((distT / chip.span) * Math.PI));
          const lenSD = Math.hypot(ls, ld) || 1;
          ls -= (ls / lenSD) * chip.depth * wChip;
          ld -= (ld / lenSD) * chip.depth * wChip;
          cornerWear[k] = Math.min(1, cornerWear[k] + 0.65 * wChip);
        }
      }

      const rs = ls * ct - ld * st + waveS;
      const rd = ls * st + ld * ct + waveD;

      let along = t * length;
      let kStart = 0;
      let kEnd = 0;
      if (startCutNormal && sNormDot > 0.22) {
        const dotSD = (sideAxis.x * rs + sideAxis.y * rs + sideAxis.z * rs); // computed properly below
        void dotSD;
        const vx = sideAxis.x * rs + depthAxis.x * rd;
        const vy = sideAxis.y * rs + depthAxis.y * rd;
        const vz = sideAxis.z * rs + depthAxis.z * rd;
        const num = vx * startCutNormal.x + vy * startCutNormal.y + vz * startCutNormal.z;
        kStart = Math.max(-maxCutOffset, Math.min(maxCutOffset, num / sNormDot));
      } else {
        kStart = (rs / hw) * startSkewS + (rd / hd) * startSkewD;
      }
      if (endCutNormal && eNormDot > 0.22) {
        const vx = sideAxis.x * rs + depthAxis.x * rd;
        const vy = sideAxis.y * rs + depthAxis.y * rd;
        const vz = sideAxis.z * rs + depthAxis.z * rd;
        const num = vx * endCutNormal.x + vy * endCutNormal.y + vz * endCutNormal.z;
        kEnd = Math.max(-maxCutOffset, Math.min(maxCutOffset, -num / eNormDot));
      } else {
        kEnd = (rs / hw) * endSkewS + (rd / hd) * endSkewD;
      }
      along += kStart * (1 - t) + kEnd * t;

      const wx = a.x + axis.x * along + sideAxis.x * rs + depthAxis.x * rd;
      const wy = a.y + axis.y * along + sideAxis.y * rs + depthAxis.y * rd;
      const wz = a.z + axis.z * along + sideAxis.z * rs + depthAxis.z * rd;
      ring.push([wx, wy, wz]);
      sumX += wx; sumY += wy; sumZ += wz;
    }

    rings.push(ring);
    centers.push([sumX / 8, sumY / 8, sumZ / 8]);
    ringDamp.push(dampStart * (1 - t) + dampEnd * t);
    ringCornerWear.push(cornerWear);
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const masks = [];

  for (let i = 0; i < steps; i += 1) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const v0 = uvOffsetV + t0 * length * uvScale;
    const v1 = uvOffsetV + t1 * length * uvScale;
    const r0 = rings[i];
    const r1 = rings[i + 1];
    const d0 = ringDamp[i];
    const d1 = ringDamp[i + 1];
    const w0 = ringCornerWear[i];
    const w1 = ringCornerWear[i + 1];

    for (let k = 0; k < 8; k += 1) {
      const kn = (k + 1) % 8;
      const isBevel = k % 2 === 1;
      const u0 = uvOffsetU + perimU[k];
      const u1 = uvOffsetU + perimU[k + 1];

      const wearA0 = isBevel ? Math.min(1, wear * 0.8 + w0[k]) : w0[k] * 0.45;
      const wearB0 = isBevel ? Math.min(1, wear * 0.8 + w0[kn]) : w0[kn] * 0.45;
      const wearA1 = isBevel ? Math.min(1, wear * 0.8 + w1[k]) : w1[k] * 0.45;
      const wearB1 = isBevel ? Math.min(1, wear * 0.8 + w1[kn]) : w1[kn] * 0.45;

      const mA0 = [0, d0, wearA0, 1];
      const mB0 = [0, d0, wearB0, 1];
      const mB1 = [0, d1, wearB1, 1];
      const mA1 = [0, d1, wearA1, 1];

      if (k === splitFace) {
        // Split main face into 2 sub-quads along a central seasoning check seam (no T-junctions).
        const midPt = (pA, pB, cPt, tVal) => {
          const mx = (pA[0] + pB[0]) * 0.5;
          const my = (pA[1] + pB[1]) * 0.5;
          const mz = (pA[2] + pB[2]) * 0.5;
          let depthFrac = 0;
          if (tVal > splitT0 && tVal < splitT1) {
            const lt = (tVal - splitT0) / (splitT1 - splitT0);
            depthFrac = Math.pow(Math.sin(lt * Math.PI), 0.55);
          }
          const inX = cPt[0] - mx, inY = cPt[1] - my, inZ = cPt[2] - mz;
          const inLen = Math.hypot(inX, inY, inZ) || 1;
          const push = splitD * depthFrac;
          return {
            pt: [mx + (inX / inLen) * push, my + (inY / inLen) * push, mz + (inZ / inLen) * push],
            depthFrac,
          };
        };
        const sm0 = midPt(r0[k], r0[kn], centers[i], t0);
        const sm1 = midPt(r1[k], r1[kn], centers[i + 1], t1);
        const uMid = (u0 + u1) * 0.5;
        const mMid0 = [0, Math.min(1, d0 + sm0.depthFrac * 0.65), 0, 1];
        const mMid1 = [0, Math.min(1, d1 + sm1.depthFrac * 0.65), 0, 1];
        pushQuad(positions, normals, uvs, masks, r0[k], sm0.pt, sm1.pt, r1[k], [u0, v0], [uMid, v0], [uMid, v1], [u0, v1], mA0, mMid0, mMid1, mA1);
        pushQuad(positions, normals, uvs, masks, sm0.pt, r0[kn], r1[kn], sm1.pt, [uMid, v0], [u1, v0], [u1, v1], [uMid, v1], mMid0, mB0, mB1, mMid1);
      } else {
        pushQuad(positions, normals, uvs, masks, r0[k], r0[kn], r1[kn], r1[k], [u0, v0], [u1, v0], [u1, v1], [u0, v1], mA0, mB0, mB1, mA1);
      }
    }
  }

  // Saw-cut end caps with centered [0..1] end-grain UVs (rings centered at 0.5, 0.5).
  const capUvs = [
    [0.95, 0.15], [0.95, 0.85], [0.85, 0.95], [0.15, 0.95],
    [0.05, 0.85], [0.05, 0.15], [0.15, 0.05], [0.85, 0.05],
  ];
  const mCap0 = [1, ringDamp[0], wear * 0.15, 1];
  const mCap1 = [1, ringDamp[steps], wear * 0.15, 1];
  for (let k = 0; k < 8; k += 1) {
    const kn = (k + 1) % 8;
    pushTriangle(
      positions, normals, uvs, masks,
      centers[0], rings[0][kn], rings[0][k],
      [0.5, 0.5], capUvs[kn], capUvs[k],
      mCap0, mCap0, mCap0,
    );
    pushTriangle(
      positions, normals, uvs, masks,
      centers[steps], rings[steps][k], rings[steps][kn],
      [0.5, 0.5], capUvs[k], capUvs[kn],
      mCap1, mCap1, mCap1,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('woodMask', new THREE.Float32BufferAttribute(masks, 4));
  return geometry;
}

/**
 * Generates a tapered wooden wedge driven from `a` (thick butt) to `b` (thin toe).
 * Grain runs along `a -> b`.
 */
export function createTimberWedge(a, b, width, thickEnd, thinEnd = 0.014, {
  upHint = UP,
  uvScale = 0.55,
  damp = 0.2,
  wear = 0.35,
} = {}) {
  // Align `depthAxis` (thickness/taper direction) with `upHint` by passing `cross(upHint, axis)` as `sideHint`.
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  if (dir.lengthSq() < 1e-10) return new THREE.BoxGeometry(0.02, 0.02, 0.02).translate(a.x, a.y, a.z);
  dir.normalize();
  const upVec = new THREE.Vector3(upHint.x, upHint.y, upHint.z);
  let widthHint = new THREE.Vector3().crossVectors(upVec, dir);
  if (widthHint.lengthSq() < 1e-6) widthHint = null;
  const { length, axis, sideAxis, depthAxis } = buildMemberBasis(a, b, widthHint);
  if (length < 0.01) return new THREE.BoxGeometry(0.02, 0.02, 0.02).translate(a.x, a.y, a.z);

  const hw = width * 0.5;
  const h0 = thickEnd * 0.5;
  const h1 = thinEnd * 0.5;

  const pt = (along, s, d) => [
    a.x + axis.x * along + sideAxis.x * s + depthAxis.x * d,
    a.y + axis.y * along + sideAxis.y * s + depthAxis.y * d,
    a.z + axis.z * along + sideAxis.z * s + depthAxis.z * d,
  ];
  const r0 = [pt(0, -hw, -h0), pt(0, hw, -h0), pt(0, hw, h0), pt(0, -hw, h0)];
  const r1 = [pt(length, -hw, -h1), pt(length, hw, -h1), pt(length, hw, h1), pt(length, -hw, h1)];

  const positions = [];
  const normals = [];
  const uvs = [];
  const masks = [];
  const mSide = [0, damp, wear, 1];
  const mEnd = [1, damp, wear * 0.2, 1];
  const vL = length * uvScale;
  const uW = width * uvScale;

  // Side faces
  pushQuad(positions, normals, uvs, masks, r0[0], r0[1], r1[1], r1[0], [0, 0], [uW, 0], [uW, vL], [0, vL], mSide, mSide, mSide, mSide);
  pushQuad(positions, normals, uvs, masks, r0[1], r0[2], r1[2], r1[1], [0, 0], [uW, 0], [uW, vL], [0, vL], mSide, mSide, mSide, mSide);
  pushQuad(positions, normals, uvs, masks, r0[2], r0[3], r1[3], r1[2], [0, 0], [uW, 0], [uW, vL], [0, vL], mSide, mSide, mSide, mSide);
  pushQuad(positions, normals, uvs, masks, r0[3], r0[0], r1[0], r1[3], [0, 0], [uW, 0], [uW, vL], [0, vL], mSide, mSide, mSide, mSide);
  // Butt & toe end caps
  pushQuad(positions, normals, uvs, masks, r0[0], r0[3], r0[2], r0[1], [0.1, 0.1], [0.1, 0.9], [0.9, 0.9], [0.9, 0.1], mEnd, mEnd, mEnd, mEnd);
  pushQuad(positions, normals, uvs, masks, r1[0], r1[1], r1[2], r1[3], [0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], mEnd, mEnd, mEnd, mEnd);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('woodMask', new THREE.Float32BufferAttribute(masks, 4));
  return geometry;
}

/**
 * Generates a rough-sawn plank / lagging board from `a` to `b`, oriented with its
 * wide face along `acrossDir` and thickness perpendicular.
 */
export function createTimberBoard(a, b, acrossDir, width, thickness, {
  irregular = 0.18,
  bow = 0.004,
  damp = 0.25,
  wear = 0.4,
  seed = hashPosition(a.x + b.x, a.y + b.y, a.z + b.z, 193),
} = {}) {
  return createTimberBeam(a, b, width, thickness, {
    sideHint: acrossDir,
    bevelRatio: 0.11,
    irregular,
    bow,
    taper: 0.025,
    sawSkew: 0.035,
    chipChance: 0.3,
    splitChance: 0.16,
    longitudinalStep: 0.72,
    maxSteps: 6,
    dampStart: damp,
    dampEnd: damp,
    wear,
    seed,
  });
}

/** Places a cached unit geometry transformed by basis `(right, up, forward)` at `origin` with scale `(sx, sy, sz)`. */
export function placeCachedPart(cache, key, factory, origin, right, up, forward, sx = 1, sy = 1, sz = 1) {
  const geom = cache.getOrCreate(key, factory);
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(right.x * sx, right.y * sx, right.z * sx),
    new THREE.Vector3(up.x * sy, up.y * sy, up.z * sy),
    new THREE.Vector3(forward.x * sz, forward.y * sz, forward.z * sz),
  );
  m.setPosition(origin.x, origin.y, origin.z);
  return geom.applyMatrix4(m);
}
