import * as THREE from 'three/webgpu';

function ensureUv(geometry) {
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        new Float32Array(geometry.getAttribute('position').count * 2),
        2,
      ),
    );
  }
  return geometry;
}

export function normalizeGeometry(input) {
  const geometry = input.index ? input.toNonIndexed() : input;
  if (geometry !== input) input.dispose();
  return ensureUv(geometry);
}

/**
 * Give every geometry in a merge group the same `color` attribute presence.
 *
 * `mergeGeometries` refuses a group whose members disagree on attributes. Since
 * 2026-07-25 the stone and roof families carry baked per-unit vertex colours
 * (see `applyUnitShading`), but plain structural geometry — roof decks, eaves
 * caps, ridge cylinders — is pushed into those same families unshaded.
 *
 * Pass `required` when the target material declares `vertexColors`, so the
 * attribute is present even if no member of the group happened to be shaded —
 * a material that reads vertex colours from a geometry that has none renders
 * black. Otherwise only mixed groups are touched, so families that use no
 * vertex colours at all do not pay for an unused attribute.
 *
 * Fills with white, the identity for a multiplied vertex colour.
 */
export function harmonizeVertexColors(geometries, { required = false } = {}) {
  let withColor = 0;
  for (const geometry of geometries) {
    if (geometry.getAttribute('color')) withColor += 1;
  }
  if (withColor === geometries.length) return geometries;
  if (withColor === 0 && !required) return geometries;
  for (const geometry of geometries) {
    if (geometry.getAttribute('color')) continue;
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3).fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return geometries;
}

export function transformGeometry(geometry, {
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
} = {}) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

export function applyWorkshopProjectedUv(geometry, density = 0.58) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const normalX = Math.abs(normal.getX(index));
    const normalY = Math.abs(normal.getY(index));
    const normalZ = Math.abs(normal.getZ(index));
    if (normalX >= normalY && normalX >= normalZ) {
      uv[index * 2] = position.getZ(index) * density;
      uv[index * 2 + 1] = position.getY(index) * density;
    } else if (normalY >= normalX && normalY >= normalZ) {
      uv[index * 2] = position.getX(index) * density;
      uv[index * 2 + 1] = position.getZ(index) * density;
    } else {
      uv[index * 2] = position.getX(index) * density;
      uv[index * 2 + 1] = position.getY(index) * density;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

export function beveledBox({
  width,
  height,
  depth,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  detail = 2,
  bevelRatio = 0.055,
  skew = [0, 0],
}) {
  const radius = Math.min(width, height, depth) * bevelRatio;
  const shape = new THREE.Shape();
  const halfWidth = Math.max(0.02, width / 2 - radius);
  const halfHeight = Math.max(0.02, height / 2 - radius);
  shape.moveTo(-halfWidth + skew[1], -halfHeight);
  shape.lineTo(halfWidth + skew[1], -halfHeight);
  shape.lineTo(halfWidth + skew[0], halfHeight);
  shape.lineTo(-halfWidth + skew[0], halfHeight);
  shape.closePath();
  const extrusionDepth = Math.max(0.02, depth - radius * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: extrusionDepth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: radius,
    bevelSize: radius,
    bevelSegments: detail >= 3 ? 2 : 1,
  });
  geometry.translate(0, 0, -extrusionDepth / 2);
  return applyWorkshopProjectedUv(
    transformGeometry(normalizeGeometry(geometry), { position, rotation }),
  );
}

function polygonArea(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
}

function shortestEdgeLength(ring) {
  let shortest = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    shortest = Math.min(shortest, Math.hypot(x1 - x0, y1 - y0));
  }
  return shortest;
}

/**
 * Offset every edge inward by `radius` and re-intersect the neighbours.
 *
 * This is the general form of the per-axis inset `beveledBox` does: the bevel
 * ring is grown back out by the same radius afterwards, so the finished prism
 * still measures its nominal size. Returns null on a degenerate ring so the
 * caller can fall back.
 */
export function insetRing(ring, radius) {
  return insetRingVariable(ring, ring.map(() => radius));
}

/**
 * Offset each edge by its own inset distance and re-intersect neighbours.
 *
 * `edgeInset[i]` applies to the edge from ring[i] → ring[(i+1)%n]. Interior lies
 * to the left of travel on a counter-clockwise ring. Returns null on collapse.
 */
export function insetRingVariable(ring, edgeInset) {
  const count = ring.length;
  if (edgeInset.length !== count) return null;
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % count];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    const inset = edgeInset[index];
    if (!(length > 1e-9) || !(inset >= 0) || !Number.isFinite(inset)) return null;
    lines.push({
      x: x0 + (-dy / length) * inset,
      y: y0 + (dx / length) * inset,
      dx: dx / length,
      dy: dy / length,
    });
  }
  const inset = [];
  for (let index = 0; index < count; index += 1) {
    const a = lines[(index + count - 1) % count];
    const b = lines[index];
    const cross = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(cross) < 1e-6) return null;
    const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / cross;
    const point = [a.x + a.dx * t, a.y + a.dy * t];
    if (!point.every(Number.isFinite)) return null;
    inset.push(point);
  }
  return inset;
}

/** An inset that swallowed the ring flips an edge or collapses the area. */
export function insetSurvived(ring, inset) {
  if (!(polygonArea(inset) > 1e-8)) return false;
  for (let index = 0; index < inset.length; index += 1) {
    const next = (index + 1) % inset.length;
    const originalX = ring[next][0] - ring[index][0];
    const originalY = ring[next][1] - ring[index][1];
    const insetX = inset[next][0] - inset[index][0];
    const insetY = inset[next][1] - inset[index][1];
    if (originalX * insetX + originalY * insetY <= 0) return false;
  }
  return true;
}

function pointInPolygon(point, ring) {
  // Ray cast; treats boundary as inside.
  const [px, py] = point;
  let inside = false;
  for (let index = 0, j = ring.length - 1; index < ring.length; j = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[j];
    const denom = yj - yi || 1e-15;
    const intersect = ((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / denom + xi);
    if (intersect) inside = !inside;
  }
  // Also accept points extremely close to an edge.
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSq = dx * dx + dy * dy;
    if (!(lengthSq > 0)) continue;
    const t = clamp01(((px - x0) * dx + (py - y0) * dy) / lengthSq);
    const qx = x0 + dx * t;
    const qy = y0 + dy * t;
    if (Math.hypot(px - qx, py - qy) <= 1e-6) return true;
  }
  return inside;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function segmentsIntersectProperly(a0, a1, b0, b1) {
  const orient = (p, q, r) => {
    const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
    if (Math.abs(value) < 1e-12) return 0;
    return value > 0 ? 1 : 2;
  };
  const o1 = orient(a0, a1, b0);
  const o2 = orient(a0, a1, b1);
  const o3 = orient(b0, b1, a0);
  const o4 = orient(b0, b1, a1);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

function ringSelfIntersects(ring) {
  const count = ring.length;
  for (let i = 0; i < count; i += 1) {
    const a0 = ring[i];
    const a1 = ring[(i + 1) % count];
    for (let j = i + 1; j < count; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === count - 1)) continue;
      const b0 = ring[j];
      const b1 = ring[(j + 1) % count];
      // Skip adjacent edges that share a vertex.
      if (
        (i + 1) % count === j
        || (j + 1) % count === i
      ) continue;
      if (segmentsIntersectProperly(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

/**
 * Validate a variable inset against masonry safeguards.
 *
 * @returns {{valid:boolean, reason?:string, areaRatio?:number}}
 */
export function variableInsetSurvived(sourceRing, inset, safeguards = {}) {
  if (!inset || inset.length !== sourceRing.length) {
    return { valid: false, reason: 'source-ring-invalid' };
  }
  for (const point of inset) {
    if (!point.every(Number.isFinite)) {
      return { valid: false, reason: 'non-finite-vertex' };
    }
  }
  const sourceArea = polygonArea(sourceRing);
  const insetArea = polygonArea(inset);
  if (!(Math.abs(sourceArea) > 1e-8)) {
    return { valid: false, reason: 'source-ring-invalid' };
  }
  if (!(insetArea > 1e-8)) {
    return { valid: false, reason: 'minimum-face-area', areaRatio: 0 };
  }
  if (Math.sign(insetArea) !== Math.sign(sourceArea)) {
    return { valid: false, reason: 'variable-inset-self-intersection' };
  }
  if (!insetSurvived(sourceRing, inset)) {
    return { valid: false, reason: 'variable-inset-self-intersection' };
  }
  if (ringSelfIntersects(inset)) {
    return { valid: false, reason: 'variable-inset-self-intersection' };
  }
  const areaRatio = insetArea / sourceArea;
  const minimumAreaRatio = safeguards.minimumFaceAreaRatio ?? 0.58;
  if (areaRatio < minimumAreaRatio) {
    return { valid: false, reason: 'minimum-face-area', areaRatio };
  }
  const minimumEdgeLength = safeguards.minimumEdgeLength ?? 0.06;
  const maximumInsetEdgeRatio = safeguards.maximumInsetEdgeRatio ?? 0.28;
  for (let index = 0; index < inset.length; index += 1) {
    const next = (index + 1) % inset.length;
    const edgeLength = Math.hypot(
      inset[next][0] - inset[index][0],
      inset[next][1] - inset[index][1],
    );
    if (edgeLength < minimumEdgeLength) {
      return { valid: false, reason: 'minimum-edge-length' };
    }
    const sourceLength = Math.hypot(
      sourceRing[next][0] - sourceRing[index][0],
      sourceRing[next][1] - sourceRing[index][1],
    );
    // Approximate per-edge inset from corner displacement.
    const midSource = [
      (sourceRing[index][0] + sourceRing[next][0]) / 2,
      (sourceRing[index][1] + sourceRing[next][1]) / 2,
    ];
    const midInset = [
      (inset[index][0] + inset[next][0]) / 2,
      (inset[index][1] + inset[next][1]) / 2,
    ];
    const insetDistance = Math.hypot(midInset[0] - midSource[0], midInset[1] - midSource[1]);
    if (insetDistance > sourceLength * maximumInsetEdgeRatio + 1e-6) {
      return { valid: false, reason: 'maximum-inset-edge-ratio' };
    }
    if (!pointInPolygon(inset[index], sourceRing)) {
      return { valid: false, reason: 'outside-source-ring' };
    }
  }
  return { valid: true, areaRatio };
}

function scaleAboutCentroid(ring, factor) {
  let centroidX = 0;
  let centroidY = 0;
  for (const [x, y] of ring) {
    centroidX += x;
    centroidY += y;
  }
  centroidX /= ring.length;
  centroidY /= ring.length;
  return ring.map(([x, y]) => [
    centroidX + (x - centroidX) * factor,
    centroidY + (y - centroidY) * factor,
  ]);
}

/**
 * Shared bevel-profile solve for an arbitrary planar quad.
 *
 * Normalises winding, picks a safe bevel radius from the shortest edge, insets
 * the ring, and falls back to centroid scaling when the inset collapses. Used by
 * both the flat `beveledQuadPrism` extrusion and the pillowed relief builder so
 * the two stay in lockstep on footprint and depth.
 *
 * @param options.corners four `[x, y]` pairs in the unit's own face plane,
 *   already centred on the unit origin. Winding is fixed up here.
 */
export function createBeveledQuadProfile({
  corners,
  depth,
  bevelRatio = 0.055,
}) {
  const ring = corners.map(([x, y]) => [x, y]);
  if (polygonArea(ring) < 0) ring.reverse();

  const edge = shortestEdgeLength(ring);
  const radius = Math.max(1e-4, Math.min(edge, depth) * bevelRatio);
  const offset = insetRing(ring, radius);
  // A sliver whose inset swallowed itself would hand `ExtrudeGeometry` a
  // self-intersecting shape, which triangulates into inverted faces. Shrinking
  // about the centroid instead is always simple and keeps the winding.
  const profile = offset && insetSurvived(ring, offset)
    ? offset
    : scaleAboutCentroid(ring, Math.max(0.3, 1 - (2 * radius) / Math.max(edge, 1e-4)));
  const extrusionDepth = Math.max(0.02, depth - radius * 2);

  return {
    ring,
    profile,
    radius,
    extrusionDepth,
    insetSucceeded: Boolean(offset && insetSurvived(ring, offset)),
  };
}

/**
 * A bevelled prism over an arbitrary planar quad.
 *
 * `beveledBox`'s profile is a rectangle whose top and bottom edges may shear in
 * local X. That cannot express a bed joint rising across the stone, nor two head
 * joints leaning by different amounts — the two things that make laid masonry
 * read as laid rather than tiled. Four free corners can, which is the
 * `cornerOffsets` descriptor `04-masonry-and-stone-generation.md` §8 asks for and
 * `05-…md` §5 sanctions ("8-corner prism; controlled corner offsets; one bevel
 * ring").
 *
 * Callers are expected to hand *the same* corner positions to the two units that
 * share a joint, so neighbours meet exactly instead of relying on a mortar gap to
 * hide the mismatch.
 *
 * `beveledBox` is deliberately left alone rather than reimplemented on top of
 * this. Its per-axis inset is not the offset polygon of a sheared rectangle, so
 * routing it through here would shift every workshop building very slightly for
 * no gain.
 *
 * @param options.corners four `[x, y]` pairs in the unit's own face plane,
 *   already centred on the unit origin. Winding is fixed up here.
 */
export function beveledQuadPrism({
  corners,
  depth,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  detail = 2,
  bevelRatio = 0.055,
}) {
  const { profile, radius, extrusionDepth } = createBeveledQuadProfile({
    corners,
    depth,
    bevelRatio,
  });

  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let index = 1; index < profile.length; index += 1) {
    shape.lineTo(profile[index][0], profile[index][1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: extrusionDepth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: radius,
    bevelSize: radius,
    bevelSegments: detail >= 3 ? 2 : 1,
  });
  geometry.translate(0, 0, -extrusionDepth / 2);
  return applyWorkshopProjectedUv(
    transformGeometry(normalizeGeometry(geometry), { position, rotation }),
  );
}

export function archedPanel({
  width,
  springHeight,
  radius,
  depth,
  position = [0, 0, 0],
  detail = 2,
}) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, springHeight);
  shape.absarc(0, springHeight, radius, 0, Math.PI, false);
  shape.lineTo(-width / 2, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: Math.min(0.035, depth * 0.18),
    bevelSize: Math.min(0.025, width * 0.015),
    bevelSegments: detail >= 3 ? 2 : 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return applyWorkshopProjectedUv(
    transformGeometry(normalizeGeometry(geometry), { position }),
  );
}

export function coneRoof({
  radius,
  height,
  y,
  centerX = 0,
  centerZ = 0,
  sides = 20,
  rotationY = 0,
}) {
  const cone = normalizeGeometry(new THREE.ConeGeometry(radius, height, sides, 1, false));
  return transformGeometry(cone, {
    position: [centerX, y + height / 2, centerZ],
    rotation: [0, rotationY, 0],
  });
}

export function wallRoofPlanes({
  width,
  depth,
  y,
  height,
  detail = 2,
  overhang = 0.17,
  centerX = 0,
  centerZ = 0,
}) {
  const roofDepth = depth + overhang * 2;
  const slant = Math.hypot(roofDepth / 2, height);
  const angle = Math.atan2(height, roofDepth / 2);
  return [
    beveledBox({
      width: width + overhang * 2,
      height: 0.11,
      depth: slant + 0.12,
      position: [centerX, y + height / 2, centerZ - roofDepth / 4],
      rotation: [-angle, 0, 0],
      detail,
      bevelRatio: 0.12,
    }),
    beveledBox({
      width: width + overhang * 2,
      height: 0.11,
      depth: slant + 0.12,
      position: [centerX, y + height / 2, centerZ + roofDepth / 4],
      rotation: [angle, 0, 0],
      detail,
      bevelRatio: 0.12,
    }),
  ];
}

export function cylinder({
  radius,
  radiusTop = radius,
  radiusBottom = radius,
  height,
  position = [0, 0, 0],
  sides = 10,
  rotation = [0, 0, 0],
}) {
  return transformGeometry(
    normalizeGeometry(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, sides)),
    { position, rotation },
  );
}

export function gablePanel({
  width,
  height,
  depth,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -depth / 2);
  return applyWorkshopProjectedUv(
    transformGeometry(normalizeGeometry(geometry), { position, rotation }),
  );
}

export function flagGeometry({
  width = 0.9,
  height = 0.42,
  position = [0, 0, 0],
}) {
  const positions = new Float32Array([
    0, height / 2, 0,
    width * 0.55, height * 0.38, 0.04,
    width, height * 0.17, 0,
    0, -height / 2, 0,
    width, height * 0.17, 0,
    width * 0.55, -height * 0.38, -0.04,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 1, 0.55, 0.88, 1, 0.67,
    0, 0, 1, 0.67, 0.55, 0.12,
  ], 2));
  geometry.computeVertexNormals();
  return transformGeometry(geometry, { position });
}

/**
 * Vertex-colour gradient along a leaf, from base to tip.
 *
 * Real foliage is darkest where it is shaded by the mass behind it and lightest
 * at the free tip. Baking this per leaf is what stops a clump of ivy reading as
 * one flat green silhouette.
 */
const LEAF_BASE_SHADE = 0.72;
const LEAF_TIP_SHADE = 1.08;

export function leaf({
  radius,
  position,
  rotation = [0, 0, 0],
  color = null,
}) {
  const positions = new Float32Array([
    0, -radius * 0.82, 0,
    -radius * 0.72, -radius * 0.04, 0,
    0, radius, 0,
    0, -radius * 0.82, 0,
    0, radius, 0,
    radius * 0.72, -radius * 0.04, 0,
    -radius * 0.72, -radius * 0.04, 0,
    0, radius, 0,
    0, radius * 0.08, radius * 0.18,
    radius * 0.72, -radius * 0.04, 0,
    0, radius * 0.08, radius * 0.18,
    0, radius, 0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0.5, 0, 0, 0.42, 0.5, 1,
    0.5, 0, 0.5, 1, 1, 0.42,
    0, 0.42, 0.5, 1, 0.5, 0.48,
    1, 0.42, 0.5, 0.48, 0.5, 1,
  ], 2));
  geometry.computeVertexNormals();
  if (color) {
    // Sampled before the transform, while the leaf still runs along its own
    // local Y from base (-radius * 0.82) to tip (+radius).
    const colors = new Float32Array(positions.length);
    for (let vertex = 0; vertex < positions.length; vertex += 3) {
      const along = (positions[vertex + 1] + radius * 0.82) / (radius * 1.82);
      const shade = LEAF_BASE_SHADE + (LEAF_TIP_SHADE - LEAF_BASE_SHADE) * along;
      colors[vertex] = color[0] * shade;
      colors[vertex + 1] = color[1] * shade;
      colors[vertex + 2] = color[2] * shade;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return transformGeometry(geometry, { position, rotation });
}

export function vineSegment({
  start,
  end,
  radius = 0.026,
  sides = 5,
}) {
  const startPoint = new THREE.Vector3(...start);
  const endPoint = new THREE.Vector3(...end);
  const direction = endPoint.clone().sub(startPoint);
  const length = Math.max(0.01, direction.length());
  const geometry = normalizeGeometry(new THREE.CylinderGeometry(
    radius,
    radius * 1.08,
    length,
    sides,
    1,
    false,
  ));
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  geometry.applyQuaternion(quaternion);
  geometry.translate(
    (startPoint.x + endPoint.x) / 2,
    (startPoint.y + endPoint.y) / 2,
    (startPoint.z + endPoint.z) / 2,
  );
  return geometry;
}
