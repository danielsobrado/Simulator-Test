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

export function leaf({
  radius,
  position,
  rotation = [0, 0, 0],
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
