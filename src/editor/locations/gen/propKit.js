import * as THREE from 'three/webgpu';
import { createRng } from './noise.js';

/**
 * World-space primitives for built things. Faces are subdivided to about
 * `GRAIN` metres because lighting is baked per vertex: a ten-metre wall with
 * four corners could only ever hold one gradient.
 */

const GRAIN = 1.1;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const scratch = new THREE.Matrix4();
const segments = (length) => Math.max(1, Math.min(24, Math.round(length / GRAIN)));

function hashCoords(x, y, z, salt = 0) {
  let h = (Math.round(x * 100) * 73856093) ^ (Math.round(y * 100) * 19349663) ^ (Math.round(z * 100) * 83492791) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A chamfered, optionally tapered and subtly irregular 8-corner prism centred at
 * local origin. Produces clean flat/chamfered facets that catch vertex-baked
 * light along edges without inflating vertex count.
 */
function buildChamferedPrism(width, height, depth, {
  bevel = 0.04,
  batter = 0,
  irregular = 0,
  seed = 1,
} = {}) {
  const rng = createRng(seed);
  const b = Math.min(bevel, width * 0.28, height * 0.28, depth * 0.28);
  const hw = Math.max(0.01, width * 0.5);
  const hh = Math.max(0.01, height * 0.5);
  const hd = Math.max(0.01, depth * 0.5);
  const topScale = Math.max(0.5, 1 - batter);
  const botScale = 1 + batter * 0.35;

  const jit = (amt) => (irregular > 0 ? (rng() - 0.5) * 2 * amt * irregular : 0);

  // Inner core corners (before bevel expansion) for 8 corners: bottom 4, top 4.
  const pts = [
    [-hw * botScale + jit(hw * 0.14), -hh + jit(hh * 0.08), -hd * botScale + jit(hd * 0.14)],
    [hw * botScale + jit(hw * 0.14), -hh + jit(hh * 0.08), -hd * botScale + jit(hd * 0.14)],
    [hw * botScale + jit(hw * 0.14), -hh + jit(hh * 0.08), hd * botScale + jit(hd * 0.14)],
    [-hw * botScale + jit(hw * 0.14), -hh + jit(hh * 0.08), hd * botScale + jit(hd * 0.14)],
    [-hw * topScale + jit(hw * 0.14), hh + jit(hh * 0.08), -hd * topScale + jit(hd * 0.14)],
    [hw * topScale + jit(hw * 0.14), hh + jit(hh * 0.08), -hd * topScale + jit(hd * 0.14)],
    [hw * topScale + jit(hw * 0.14), hh + jit(hh * 0.08), hd * topScale + jit(hd * 0.14)],
    [-hw * topScale + jit(hw * 0.14), hh + jit(hh * 0.08), hd * topScale + jit(hd * 0.14)],
  ];

  // If bevel is negligible, emit a subdivided box with perturbed corners.
  if (b < 0.005) {
    const geo = new THREE.BoxGeometry(width, height, depth, segments(width), segments(height), segments(depth));
    if (batter > 0 || irregular > 0) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const t = (py + hh) / Math.max(0.01, height);
        const s = botScale * (1 - t) + topScale * t;
        pos.setXYZ(i, px * s, py, pz * s);
      }
      geo.computeVertexNormals();
    }
    return geo;
  }

  // Build an 8-corner chamfered hexahedron by shrinking each face inward by `b`
  // into 3 vertices per corner (24 vertices total), then emitting 6 faces + 12 edge bevels + 8 corner bevels.
  // For each corner c in 0..7, its 3 split vertices sit along its 3 incident axes.
  const inset = (p, sx, sy, sz) => [
    p[0] - sx * b, p[1], p[2], // X-inset
    p[0], p[1] - sy * b, p[2], // Y-inset
    p[0], p[1], p[2] - sz * b, // Z-inset
  ];
  // Actually simpler & cleaner: each corner has 3 vertices:
  // vX (shifted toward center in Y & Z by b), vY (shifted in X & Z by b), vZ (shifted in X & Y by b)
  const signs = [
    [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
    [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
  ];
  const vX = [], vY = [], vZ = [];
  for (let i = 0; i < 8; i += 1) {
    const [sx, sy, sz] = signs[i];
    const [px, py, pz] = pts[i];
    const bi = Math.max(0.002, b * (1 + (irregular > 0 ? (rng() - 0.5) * 0.8 * irregular : 0)));
    vX.push([px, py - sy * bi, pz - sz * bi]);
    vY.push([px - sx * bi, py, pz - sz * bi]);
    vZ.push([px - sx * bi, py - sy * bi, pz]);
  }
  const positions = [];
  const pushTri = (a, bPt, c) => {
    positions.push(a[0], a[1], a[2], bPt[0], bPt[1], bPt[2], c[0], c[1], c[2]);
  };
  const pushQuad = (a, bPt, c, d) => {
    pushTri(a, bPt, c);
    pushTri(a, c, d);
  };
  // 6 main faces (outward CCW):
  pushQuad(vY[0], vY[1], vY[2], vY[3]); // -Y bottom
  pushQuad(vY[7], vY[6], vY[5], vY[4]); // +Y top
  pushQuad(vZ[3], vZ[2], vZ[6], vZ[7]); // +Z front
  pushQuad(vZ[1], vZ[0], vZ[4], vZ[5]); // -Z back
  pushQuad(vX[2], vX[1], vX[5], vX[6]); // +X right
  pushQuad(vX[0], vX[3], vX[7], vX[4]); // -X left

  // 12 edge chamfers:
  // Bottom 4 edges (Y=-1):
  pushQuad(vY[3], vY[2], vZ[2], vZ[3]); // -Y/+Z
  pushQuad(vY[1], vY[0], vZ[0], vZ[1]); // -Y/-Z
  pushQuad(vY[2], vY[1], vX[1], vX[2]); // -Y/+X
  pushQuad(vY[0], vY[3], vX[3], vX[0]); // -Y/-X
  // Top 4 edges (Y=+1):
  pushQuad(vZ[7], vZ[6], vY[6], vY[7]); // +Y/+Z
  pushQuad(vZ[5], vZ[4], vY[4], vY[5]); // +Y/-Z
  pushQuad(vX[6], vX[5], vY[5], vY[6]); // +Y/+X
  pushQuad(vX[4], vX[7], vY[7], vY[4]); // +Y/-X
  // Vertical 4 edges:
  pushQuad(vZ[2], vX[2], vX[6], vZ[6]); // +X/+Z
  pushQuad(vX[3], vZ[3], vZ[7], vX[7]); // -X/+Z
  pushQuad(vX[1], vZ[1], vZ[5], vX[5]); // +X/-Z
  pushQuad(vZ[0], vX[0], vX[4], vZ[4]); // -X/-Z

  // 8 corner triangles (outward CCW):
  pushTri(vY[0], vX[0], vZ[0]);
  pushTri(vY[1], vZ[1], vX[1]);
  pushTri(vY[2], vX[2], vZ[2]);
  pushTri(vY[3], vZ[3], vX[3]);
  pushTri(vY[4], vZ[4], vX[4]);
  pushTri(vY[5], vX[5], vZ[5]);
  pushTri(vY[6], vZ[6], vX[6]);
  pushTri(vY[7], vX[7], vZ[7]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A box centred at `at`, turned `yaw` about Y. */
export function box(width, height, depth, at, yaw = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth, segments(width), segments(height), segments(depth));
  if (yaw) geometry.rotateY(yaw);
  return geometry.translate(at.x, at.y, at.z);
}

/** A box standing on the floor point `at`. */
export function block(width, height, depth, at, yaw = 0) {
  return box(width, height, depth, { x: at.x, y: at.y + height / 2, z: at.z }, yaw);
}

/** A chamfered, optionally battered & irregular stone block centred at `at`. */
export function stoneBox(width, height, depth, at, {
  yaw = 0,
  bevel = Math.min(0.055, Math.min(width, height, depth) * 0.16),
  batter = 0,
  irregular = 0.35,
  seed = hashCoords(at.x, at.y, at.z, 17),
} = {}) {
  const geometry = buildChamferedPrism(width, height, depth, { bevel, batter, irregular, seed });
  if (yaw) geometry.rotateY(yaw);
  return geometry.translate(at.x, at.y, at.z);
}

/** A chamfered stone block standing on the floor point `at`. */
export function stoneBlock(width, height, depth, at, options = {}) {
  return stoneBox(width, height, depth, { x: at.x, y: at.y + height / 2, z: at.z }, options);
}

/** A squared member from `a` to `b`: beams, braces, rails, planks. */
export function beam(a, b, width, height = width) {
  const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z);
  const axis = to.clone().sub(from);
  const length = axis.length();
  const geometry = new THREE.BoxGeometry(length, height, width, segments(length), 1, 1);
  scratch.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(X, axis.normalize()));
  scratch.setPosition(from.add(to).multiplyScalar(0.5));
  return geometry.applyMatrix4(scratch);
}

/**
 * A flat slab running `a` to `b`, `width` wide along `across` (any vector not parallel
 * to the run) and `thickness` thick: roof pitches, doors, shutters, decking.
 */
export function panel(a, b, across, width, thickness) {
  const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z);
  const run = to.clone().sub(from);
  const length = run.length();
  run.normalize();
  const side = new THREE.Vector3(across.x, across.y, across.z);
  side.addScaledVector(run, -side.dot(run)).normalize();
  const geometry = new THREE.BoxGeometry(length, thickness, width, segments(length), 1, segments(width));
  scratch.makeBasis(run, new THREE.Vector3().crossVectors(side, run), side);
  scratch.setPosition(from.add(to).multiplyScalar(0.5));
  return geometry.applyMatrix4(scratch);
}

/** A hand-hewn, chamfered timber or cut-stone beam from `a` to `b` with subtle taper/irregularity. */
export function hewnBeam(a, b, width, height = width, {
  bevel = Math.min(0.035, Math.min(width, height) * 0.16),
  irregular = 0.25,
  taper = 0,
  seed = hashCoords(a.x + b.x, a.y + b.y, a.z + b.z, 53),
} = {}) {
  const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z);
  const axis = to.clone().sub(from);
  const length = axis.length();
  if (length < 1e-4) return box(0.01, 0.01, 0.01, a);
  const geometry = buildChamferedPrism(length, height, width, {
    bevel: Math.min(bevel, length * 0.2),
    batter: taper,
    irregular,
    seed,
  });
  scratch.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(X, axis.normalize()));
  scratch.setPosition(from.add(to).multiplyScalar(0.5));
  return geometry.applyMatrix4(scratch);
}

/** A round member from `a` to `b`, `ra` at the start and `rb` at the end: logs, posts, drums, icicles. */
export function rod(a, b, ra, rb = ra, sides = 10) {
  const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z);
  const axis = to.clone().sub(from);
  const length = axis.length();
  const geometry = new THREE.CylinderGeometry(rb, ra, length, sides, segments(length));
  scratch.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, axis.normalize()));
  scratch.setPosition(from.add(to).multiplyScalar(0.5));
  return geometry.applyMatrix4(scratch);
}

/**
 * An organic adze-hewn mine timber or peeled log from `a` to `b`: subdivided along
 * its span with subtle structural bow, taper, and irregular octagonal cross-sections
 * so heavy timberwork avoids ruler-straight extruded chamfer edges.
 */
export function roughTimber(a, b, width, height = width, {
  sides = 8,
  taper = 0.06,
  bow = 0.025,
  irregular = 0.35,
  seed = hashCoords(a.x + b.x, a.y + b.y, a.z + b.z, 71),
} = {}) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-4) return box(0.01, 0.01, 0.01, a);

  const rng = createRng(seed);
  const dir = new THREE.Vector3(dx / length, dy / length, dz / length);
  const upRef = Math.abs(dir.y) > 0.9 ? Z : Y;
  const right = new THREE.Vector3().crossVectors(upRef, dir).normalize();
  const upVec = new THREE.Vector3().crossVectors(dir, right).normalize();

  const steps = Math.max(4, Math.min(18, Math.ceil(length / 0.38)));
  const sagMag = -Math.abs(bow) * length * 0.32;
  const sideMag = (rng() - 0.5) * 2 * bow * length * 0.42;
  const wPhaseA = rng() * Math.PI * 2;
  const wPhaseB = rng() * Math.PI * 2;
  const rx = width * 0.54;
  const ry = height * 0.54;

  const rings = [];
  const centers = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const env = Math.sin(t * Math.PI);
    const wiggleR = Math.sin(t * Math.PI * 2.5 + wPhaseA) * 0.018 * irregular * env;
    const wiggleU = Math.sin(t * Math.PI * 3.1 + wPhaseB) * 0.014 * irregular * env;
    const cx = a.x + dx * t + right.x * (env * sideMag + wiggleR) + upVec.x * (env * sagMag + wiggleU);
    const cy = a.y + dy * t + right.y * (env * sideMag + wiggleR) + upVec.y * (env * sagMag + wiggleU);
    const cz = a.z + dz * t + right.z * (env * sideMag + wiggleR) + upVec.z * (env * sagMag + wiggleU);
    centers.push([cx, cy, cz]);

    const scale = (1 + taper * 0.25) * (1 - t) + Math.max(0.58, 1 - taper * 0.72) * t;
    const ring = [];
    for (let k = 0; k < sides; k += 1) {
      const ang = ((k + 0.5) / sides) * Math.PI * 2;
      const knot = 1 + (rng() - 0.5) * 0.28 * irregular;
      const ox = Math.cos(ang) * rx * scale * knot;
      const oy = Math.sin(ang) * ry * scale * knot;
      ring.push([
        cx + right.x * ox + upVec.x * oy,
        cy + right.y * ox + upVec.y * oy,
        cz + right.z * ox + upVec.z * oy,
      ]);
    }
    rings.push(ring);
  }

  const positions = [];
  const pushTri = (p0, p1, p2) => {
    positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
  };
  for (let i = 0; i < steps; i += 1) {
    const r0 = rings[i], r1 = rings[i + 1];
    for (let k = 0; k < sides; k += 1) {
      const kn = (k + 1) % sides;
      pushTri(r0[k], r0[kn], r1[kn]);
      pushTri(r0[k], r1[kn], r1[k]);
    }
  }
  const c0 = centers[0], cN = centers[steps];
  for (let k = 0; k < sides; k += 1) {
    const kn = (k + 1) % sides;
    pushTri(c0, rings[0][kn], rings[0][k]);
    pushTri(cN, rings[steps][k], rings[steps][kn]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A round arch in the vertical plane through `a` and `b` (its springing points),
 * built of `count` tapered, beveled voussoir blocks with a proud keystone.
 * `rise` is the crown height above the springing.
 */
export function arch(a, b, rise, thickness, depth, count = 9, {
  keystone = true,
  pointed = 0,
  extrados = 1.08,
  irregular = 0.22,
  seed = hashCoords(a.x + b.x, a.y + b.y, a.z + b.z, 97),
} = {}) {
  const parts = [];
  const rng = createRng(seed);
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const point = (t) => {
    const angle = Math.PI * t;
    const along = 0.5 - Math.cos(angle) * 0.5;
    const crownBoost = pointed > 0 ? Math.pow(Math.sin(angle), 2.4) * pointed * rise : 0;
    return {
      x: a.x + (b.x - a.x) * along, z: a.z + (b.z - a.z) * along,
      y: a.y + (b.y - a.y) * along + Math.sin(angle) * rise + crownBoost,
    };
  };
  const midIdx = Math.floor(count / 2);
  const pad = Math.max(0, (extrados - 1) * 0.5);
  for (let index = 0; index < count; index += 1) {
    const isKey = keystone && count >= 5 && index === midIdx;
    const isSpringer = index === 0 || index === count - 1;
    const p0 = point(Math.max(0, index / count - pad / count));
    const p1 = point(Math.min(1, (index + 1) / count + pad / count));
    const tThick = thickness * (isKey ? 1.32 : isSpringer ? 1.12 : 0.96 + (rng() - 0.5) * 0.08);
    const tDepth = depth * (isKey ? 1.18 : isSpringer ? 1.06 : 0.98 + (rng() - 0.5) * 0.05);
    parts.push(hewnBeam(p0, p1, tDepth, tThick, {
      bevel: Math.min(0.055, tThick * 0.15),
      irregular,
      seed: seed + index * 31,
    }));
  }
  parts.span = span;
  return parts;
}

/**
 * Lay a coursed, irregular stone wall face between floor points `a` and `b`
 * of `height` and `thickness`, with varied course heights, varied stone widths,
 * pillowed bevels, and subtle depth relief.
 */
export function coursedWall(a, b, height, thickness, {
  courseHeight = 0.42,
  stoneWidth = 0.72,
  irregular = 0.42,
  bevel = 0.045,
  quoins = false,
  seed = hashCoords(a.x + b.x, a.y, a.z + b.z, 131),
} = {}) {
  const parts = [];
  const rng = createRng(seed);
  const dx = b.x - a.x, dz = b.z - a.z;
  const span = Math.hypot(dx, dz);
  if (span < 0.1 || height < 0.1) return parts;
  const ux = dx / span, uz = dz / span;
  const yaw = Math.atan2(-uz, ux);

  const count = Math.max(1, Math.round(height / courseHeight));
  const weights = Array.from({ length: count }, (_, row) => (
    (row === 0 ? 1.25 : 0.8 + rng() * 0.42)
  ));
  const totalW = weights.reduce((s, w) => s + w, 0);
  let yCursor = a.y;

  for (let row = 0; row < count; row += 1) {
    const ch = (weights[row] / totalW) * height;
    const cy = yCursor + ch * 0.5;
    yCursor += ch;
    let uCursor = 0;
    const rowEnd = span;
    let col = 0;
    while (uCursor < rowEnd - 0.08) {
      const atLeftQuoin = quoins && col === 0;
      const isRightEnd = rowEnd - uCursor <= stoneWidth * 1.35;
      const targetW = atLeftQuoin
        ? ((row % 2 === 0 ? 1.25 : 0.78) * stoneWidth)
        : stoneWidth * (0.62 + rng() * 0.75);
      const sw = isRightEnd ? rowEnd - uCursor : Math.min(rowEnd - uCursor, targetW);
      const cu = uCursor + sw * 0.5;
      uCursor += sw;

      const isQuoin = quoins && (atLeftQuoin || isRightEnd);
      const depthBump = (isQuoin ? 0.08 : (rng() - 0.5) * 0.06);
      const sd = thickness + depthBump;
      const pos = { x: a.x + ux * cu, y: cy, z: a.z + uz * cu };
      parts.push(stoneBox(sw * 0.96, ch * 0.93, sd, pos, {
        yaw,
        bevel: Math.min(bevel, sw * 0.15, ch * 0.15),
        batter: row === 0 ? 0.12 : 0,
        irregular: isQuoin ? irregular * 0.65 : irregular,
        seed: seed + row * 197 + col * 37,
      }));
      col += 1;
    }
  }
  return parts;
}

/**
 * An extruded beveled 2D polygon profile centred along its extrusion axis.
 * Useful for carved reliefs, Dwarf-chevron gables, anvil silhouettes, and corbels.
 */
export function extrudedProfile(points, depth, {
  bevel = 0.04,
  bevelSize = bevel,
  yaw = 0,
  rx = 0,
  rz = 0,
  at = { x: 0, y: 0, z: 0 },
} = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();

  const bThick = Math.max(0, Math.min(bevel, depth * 0.42));
  const coreDepth = Math.max(0.01, depth - bThick * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: coreDepth,
    bevelEnabled: bThick > 0.004,
    bevelThickness: bThick,
    bevelSize: Math.max(0.004, bevelSize),
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -coreDepth * 0.5);
  if (rx) geometry.rotateX(rx);
  if (rz) geometry.rotateZ(rz);
  if (yaw) geometry.rotateY(yaw);
  return geometry.translate(at.x, at.y, at.z);
}
