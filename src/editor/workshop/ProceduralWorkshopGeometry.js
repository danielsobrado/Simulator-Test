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
}) {
  const radius = Math.min(width, height, depth) * bevelRatio;
  const shape = new THREE.Shape();
  const halfWidth = Math.max(0.02, width / 2 - radius);
  const halfHeight = Math.max(0.02, height / 2 - radius);
  shape.moveTo(-halfWidth, -halfHeight);
  shape.lineTo(halfWidth, -halfHeight);
  shape.lineTo(halfWidth, halfHeight);
  shape.lineTo(-halfWidth, halfHeight);
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
  return transformGeometry(
    normalizeGeometry(new THREE.IcosahedronGeometry(radius, 0)),
    { position, rotation, scale: [1, 1.35, 0.45] },
  );
}
