import * as THREE from 'three/webgpu';
import { sampleCubicBezierPath } from '../../construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../../construction/masonry/CurveArcTable.js';
import { STONEHOLD_ASHLAR_STYLE } from '../../construction/masonry/ConstructionStyleCatalog.js';
import { packCurvedWall } from '../../construction/masonry/CurvedCoursePacker.js';
import { openingHalfWidthAt, openingVerticalSpan } from '../../construction/masonry/OpeningLayout.js';
import { mortarCoreDepth } from '../../construction/compile/ConstructionMortarCoreBuilder.js';
import { mixSeed } from '../../workshop/ProceduralRandom.js';
import { extrudedProfile, stoneBox } from './propKit.js';

function hashFloat(seed, index, salt = 0) {
  return (mixSeed(seed ^ salt, index) & 0xffff) / 0xffff;
}

function buildStraightArcTable(a, c) {
  const path = {
    version: 2,
    type: 'cubicBezier',
    anchors: [
      { id: 'a0', position: [a.x, a.z] },
      { id: 'a1', position: [c.x, c.z] },
    ],
    segments: [{
      id: 's0',
      startAnchorId: 'a0',
      endAnchorId: 'a1',
      startHandle: [(c.x - a.x) / 3, (c.z - a.z) / 3],
      endHandle: [-(c.x - a.x) / 3, -(c.z - a.z) / 3],
    }],
  };
  return createCurveArcTable(sampleCubicBezierPath(path, { maxSpacing: 1.0 }));
}

function extrudePolygons(polygons, depth, { bevel = 0.025, at, yaw = 0, roll = 0 } = {}) {
  const results = [];
  const coreDepth = Math.max(0.015, depth - bevel * 2);
  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;
    const shape = new THREE.Shape();
    shape.moveTo(outer[0][0], outer[0][1]);
    for (let i = 1; i < outer.length; i += 1) shape.lineTo(outer[i][0], outer[i][1]);
    shape.closePath();
    for (let h = 1; h < rings.length; h += 1) {
      const hole = rings[h];
      if (!hole || hole.length < 3) continue;
      const holePath = new THREE.Path();
      holePath.moveTo(hole[0][0], hole[0][1]);
      for (let i = 1; i < hole.length; i += 1) holePath.lineTo(hole[i][0], hole[i][1]);
      holePath.closePath();
      shape.holes.push(holePath);
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: coreDepth,
      steps: 1,
      bevelEnabled: bevel > 0.004,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 1,
    });
    geometry.translate(0, 0, -coreDepth * 0.5);
    if (roll) geometry.rotateZ(roll);
    if (yaw) geometry.rotateY(yaw);
    geometry.translate(at.x, at.y, at.z);
    results.push(geometry);
  }
  return results;
}

function stoneTintColor(baseTint, seed, stableIndex, category) {
  const base = new THREE.Color(baseTint);
  const h = hashFloat(seed, stableIndex, 0x3b71a9);
  const w = hashFloat(seed, stableIndex, 0x91e10d);
  // Dressed trim stays closer to uniform; field ashlar gets controlled quarry variation.
  const gain = category === 'voussoir' || category === 'ashlar'
    ? 0.96 + h * 0.07
    : 0.92 + h * 0.12;
  const warmth = (w - 0.5) * 0.035;
  base.multiplyScalar(gain);
  base.r = Math.min(1, Math.max(0, base.r + warmth));
  base.b = Math.min(1, Math.max(0, base.b - warmth * 0.6));
  return base.getHex();
}

/**
 * Context-aware Tiny Glade-inspired precision-cut Dwarven ashlar wall between
 * floor points `a` and `c`. Reuses `CurvedCoursePacker`, `OpeningLayout`, and
 * `ConstructionStyleCatalog` (`STONEHOLD_ASHLAR_STYLE`) so horizontal courses
 * terminate flush against jambs, carve cleanly around arches, and emit
 * genuine radial voussoirs + proud keystones + recessed mortar backing.
 */
export function coursedMasonryWall(b, a, c, height, thickness, {
  material = 'masonry',
  trimMaterial = 'carved',
  baseTint = 0xffffff,
  trimTint = 0xe8e5e0,
  mortarTint = 0x5c606a,
  openings = [],
  topStyle = 'flat',
  courseHeight = null,
  seed = b.seed ^ Math.round((a.x + c.x) * 31 + (a.z + c.z) * 17),
  mortarBacking = true,
} = {}) {
  const span = Math.hypot(c.x - a.x, c.z - a.z);
  if (span < 0.25 || height < 0.25) return;

  const arcTable = buildStraightArcTable(a, c);
  const baseY = (a.y + c.y) * 0.5;
  const { stones } = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: STONEHOLD_ASHLAR_STYLE,
    thickness,
    seed,
    topHeightAt: () => height,
    topStyle,
    openings,
    wallRange: [0, arcTable.totalLength],
    courseHeight,
    budget: 600,
  });

  // Recessed dark mortar backing split around openings so arches stay cleanly open.
  if (mortarBacking) {
    const coreD = mortarCoreDepth(thickness, { minimumDepth: thickness * 0.55, faceRecess: 0.035 });
    const bands = openings.length
      ? Array.from(new Set([
        0, height,
        ...openings.flatMap((op) => {
          const v = openingVerticalSpan(op);
          const spring = v.sill + (v.crown - v.sill) * 0.52;
          const haunch = v.sill + (v.crown - v.sill) * 0.78;
          return [
            Math.max(0, v.sill),
            Math.min(height, spring),
            Math.min(height, haunch),
            Math.min(height, v.crown),
          ];
        }),
      ])).sort((u, v) => u - v)
      : [0, height];

    for (let i = 0; i < bands.length - 1; i += 1) {
      const y0 = bands[i];
      const y1 = bands[i + 1];
      const bh = y1 - y0;
      if (bh < 0.05) continue;
      // Sample surviving horizontal intervals near band top/middle so arch spandrels stay solid while the void stays open.
      const ySample = y0 + bh * 0.55;
      let intervals = [[0, arcTable.totalLength]];
      for (const op of openings) {
        const hw = openingHalfWidthAt(op, ySample);
        if (hw <= 0) continue;
        const cut0 = op.s - hw - 0.02;
        const cut1 = op.s + hw + 0.02;
        intervals = intervals.flatMap(([a0, a1]) => {
          if (cut1 <= a0 || cut0 >= a1) return [[a0, a1]];
          const out = [];
          if (cut0 > a0) out.push([a0, cut0]);
          if (cut1 < a1) out.push([cut1, a1]);
          return out;
        });
      }
      if (!intervals.length) continue;
      for (const [sStart, sEnd] of intervals) {
        const segW = sEnd - sStart;
        if (segW < 0.08) continue;
        const sMid = (sStart + sEnd) * 0.5;
        const f = arcTable.frameAt(sMid);
        b.prop(trimMaterial, stoneBox(segW, bh, coreD, {
          x: f.x, y: baseY + (y0 + y1) * 0.5, z: f.z,
        }, { yaw: f.yaw, bevel: 0.015, irregular: 0 }), mortarTint);
      }
    }
  }

  for (const stone of stones) {
    const f = arcTable.frameAt(stone.s);
    const px = f.x + f.normalX * stone.offsetNormal;
    const pz = f.z + f.normalZ * stone.offsetNormal;
    const py = baseY + stone.y;
    const isDressing = stone.category === 'voussoir' || stone.category === 'ashlar' || stone.category === 'coping';
    const targetMat = isDressing ? trimMaterial : material;
    const bevelBase = isDressing ? 0.032 : 0.026;
    const depthNoise = (hashFloat(seed, stone.stableIndex, 0x7a12) - 0.5) * 0.035;
    const stoneDepth = Math.max(0.08, stone.depth + depthNoise);
    const tint = stoneTintColor(isDressing ? trimTint : baseTint, seed, stone.stableIndex, stone.category);

    if (stone.contourPolygons) {
      const geoms = extrudePolygons(stone.contourPolygons, stoneDepth, {
        bevel: bevelBase,
        at: { x: px, y: py, z: pz },
        yaw: f.yaw,
        roll: stone.roll ?? 0,
      });
      for (const g of geoms) b.prop(targetMat, g, tint);
    } else if (stone.corners) {
      const geoms = extrudePolygons([[stone.corners]], stoneDepth, {
        bevel: bevelBase,
        at: { x: px, y: py, z: pz },
        yaw: f.yaw,
        roll: stone.roll ?? 0,
      });
      for (const g of geoms) b.prop(targetMat, g, tint);
    } else {
      b.prop(targetMat, stoneBox(stone.width, stone.height, stoneDepth, {
        x: px, y: py, z: pz,
      }, { yaw: f.yaw, bevel: bevelBase, irregular: 0.05 }), tint);
    }
  }
}

/**
 * True radial-voussoir beveled stone arch spanning `a -> b` (`rise`, `thickness`, `depth`),
 * with converging radial mortar joints, promoted proud central keystone, and no
 * overlapping rectangular beam corners.
 */
export function radialArch(a, b, rise, thickness, depth, count = 13, {
  pointed = 0.2,
  keystone = true,
  irregular = 0.05,
  seed = Math.round((a.x + b.x) * 37 + (a.z + b.z) * 19),
} = {}) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const span = Math.hypot(dx, dz) || 1;
  const ux = dx / span;
  const uz = dz / span;
  const yaw = Math.atan2(-uz, ux);
  const cx = (a.x + b.x) * 0.5;
  const cz = (a.z + b.z) * 0.5;
  const cy = (a.y + b.y) * 0.5;

  const curvePoint = (t) => {
    const angle = Math.PI * t;
    const along = -Math.cos(angle) * 0.5 * span;
    const crownBoost = pointed > 0 ? Math.pow(Math.sin(angle), 2.4) * pointed * rise : 0;
    const y = (b.y - a.y) * (0.5 - Math.cos(angle) * 0.5) + Math.sin(angle) * rise + crownBoost;
    return [along, y];
  };

  const radialNormal = (t) => {
    const eps = 0.002;
    const p0 = curvePoint(Math.max(0, t - eps));
    const p1 = curvePoint(Math.min(1, t + eps));
    const tx = p1[0] - p0[0];
    const ty = p1[1] - p0[1];
    const len = Math.hypot(tx, ty) || 1;
    // Left-hand normal in arch plane points radially outward from void (+Y at crown, ±X at springers).
    return [-ty / len, tx / len];
  };

  const parts = [];
  const midIdx = Math.floor(count / 2);
  const jointInset = 0.012 / span;

  for (let i = 0; i < count; i += 1) {
    const isKey = keystone && count >= 5 && i === midIdx;
    const isSpringer = i === 0 || i === count - 1;
    const t0 = i === 0 ? 0 : i / count + jointInset;
    const t1 = i === count - 1 ? 1 : (i + 1) / count - jointInset;

    const jitterT = irregular > 0 ? (hashFloat(seed, i, 0x4f21) - 0.5) * 0.06 * thickness : 0;
    const wedgeThick = thickness * (isKey ? 1.28 : isSpringer ? 1.12 : 1.0) + jitterT;
    const wedgeDepth = depth * (isKey ? 1.16 : isSpringer ? 1.05 : 1.0);

    const i0 = curvePoint(t0);
    const i1 = curvePoint(t1);
    const n0 = radialNormal(t0);
    const n1 = radialNormal(t1);

    const innerDrop = isKey ? -thickness * 0.06 : 0;
    const pIn0 = [i0[0] + n0[0] * innerDrop, i0[1] + n0[1] * innerDrop];
    const pIn1 = [i1[0] + n1[0] * innerDrop, i1[1] + n1[1] * innerDrop];
    const pOut1 = [i1[0] + n1[0] * wedgeThick, i1[1] + n1[1] * wedgeThick];
    const pOut0 = [i0[0] + n0[0] * wedgeThick, i0[1] + n0[1] * wedgeThick];

    // Flatten horizontal bed bottom on springer blocks so they sit solidly on pier imposts.
    if (i === 0) { pIn0[1] = 0; pOut0[1] = 0; }
    if (i === count - 1) { pIn1[1] = 0; pOut1[1] = 0; }

    parts.push(extrudedProfile([pIn0, pIn1, pOut1, pOut0], wedgeDepth, {
      bevel: Math.min(0.045, wedgeThick * 0.14),
      yaw,
      at: { x: cx, y: cy, z: cz },
    }));
  }
  return parts;
}

/**
 * Emits a radial voussoir arch directly into `LocationBuilder` with subtle
 * deterministic per-voussoir quarry tint variation and a promoted central keystone.
 */
export function emitRadialArch(builder, material, a, b, rise, thickness, depth, count = 13, {
  tint = 0xffffff,
  keystoneTint = 0xedeae4,
  pointed = 0.2,
  keystone = true,
  irregular = 0.05,
  seed = builder.seed ^ Math.round((a.x + b.x) * 37 + (a.z + b.z) * 19),
} = {}) {
  const parts = radialArch(a, b, rise, thickness, depth, count, { pointed, keystone, irregular, seed });
  const midIdx = Math.floor(parts.length / 2);
  for (let i = 0; i < parts.length; i += 1) {
    const isKey = keystone && parts.length >= 5 && i === midIdx;
    const base = isKey ? keystoneTint : tint;
    const col = stoneTintColor(base, seed, i + 101, 'voussoir');
    builder.prop(material, parts[i], col);
  }
}
