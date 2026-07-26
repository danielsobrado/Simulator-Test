import * as THREE from 'three/webgpu';
import {
  cameraViewMatrix,
  clamp,
  float,
  mix,
  positionLocal,
  texture,
  uv,
  vec3,
  vec4,
} from 'three/tsl';

export const BUSH_CAST_SHADOW = false;
export const BUSH_PROXY_TRIANGLES = 24;

const DEFAULT_PROXY_COLOR = '#6d9a5d';
const MIN_PROXY_EXTENT = 0.05;
const WHITE_THRESHOLD = 0.92;
const WHITE_SPREAD = 0.05;
const PROXY_CARD_ANGLES = Object.freeze([0, Math.PI / 2, Math.PI / 4]);
const PROXY_OUTLINE = Object.freeze([
  Object.freeze([-0.50, 0.18]),
  Object.freeze([-0.43, 0.60]),
  Object.freeze([-0.18, 0.82]),
  Object.freeze([0.02, 1.00]),
  Object.freeze([0.22, 0.78]),
  Object.freeze([0.50, 0.56]),
  Object.freeze([0.42, 0.16]),
  Object.freeze([0.02, 0.00]),
]);
const PROXY_CENTER = Object.freeze([0, 0.48]);

function usesCutout(material) {
  return Boolean(
    material.map
    || material.alphaMap
    || material.transparent
    || (Number.isFinite(material.opacity) && material.opacity < 1),
  );
}

function createNodeMaterial(source) {
  if (source.isNodeMaterial) return source.clone();
  let material;
  if (source.isMeshPhysicalMaterial) material = new THREE.MeshPhysicalNodeMaterial();
  else if (source.isMeshStandardMaterial) material = new THREE.MeshStandardNodeMaterial();
  else if (source.isMeshPhongMaterial) material = new THREE.MeshPhongNodeMaterial();
  else if (source.isMeshLambertMaterial) material = new THREE.MeshLambertNodeMaterial();
  else if (source.isMeshBasicMaterial) material = new THREE.MeshBasicNodeMaterial();
  else material = new THREE.MeshStandardNodeMaterial();
  return material.copy(source);
}

function authoredColorNode(material) {
  const value = new THREE.Color(material.color ?? '#ffffff');
  const baseColor = vec3(value.r, value.g, value.b);
  const rgb = material.map
    ? texture(material.map, uv()).rgb.mul(baseColor)
    : baseColor;
  return vec4(rgb, 1);
}

export function cloneBushMaterial(source) {
  if (!source?.isMaterial) throw new Error('Bush prototypes require an authored material.');
  const material = createNodeMaterial(source);
  if (material.map?.colorSpace !== undefined) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }
  material.colorNode = authoredColorNode(material);
  material.side = THREE.DoubleSide;
  if (usesCutout(material)) {
    material.alphaTest = Math.max(0.35, material.alphaTest ?? 0);
    material.transparent = false;
  }
  material.depthWrite = true;
  material.needsUpdate = true;
  return material;
}

function proxyColor(sourceMaterial, fallbackColor) {
  const fallback = new THREE.Color(fallbackColor ?? DEFAULT_PROXY_COLOR);
  const source = sourceMaterial?.color;
  if (!source?.isColor) return fallback;
  const minimum = Math.min(source.r, source.g, source.b);
  const maximum = Math.max(source.r, source.g, source.b);
  const looksLikeDefaultWhite = minimum >= WHITE_THRESHOLD && maximum - minimum <= WHITE_SPREAD;
  return looksLikeDefaultWhite ? fallback : source.clone();
}

function appendProxyCard({ positions, indices, bounds, angle }) {
  const sourceSize = bounds.getSize(new THREE.Vector3());
  const sourceCenter = bounds.getCenter(new THREE.Vector3());
  const baseVertex = positions.length / 3;
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  const writeVertex = ([horizontal, vertical]) => {
    positions.push(
      sourceCenter.x + horizontal * sourceSize.x * cosAngle,
      bounds.min.y + vertical * sourceSize.y,
      sourceCenter.z + horizontal * sourceSize.z * sinAngle,
    );
  };

  writeVertex(PROXY_CENTER);
  for (const point of PROXY_OUTLINE) writeVertex(point);
  for (let index = 0; index < PROXY_OUTLINE.length; index += 1) {
    indices.push(
      baseVertex,
      baseVertex + 1 + index,
      baseVertex + 1 + ((index + 1) % PROXY_OUTLINE.length),
    );
  }
}

export function createBushProxyGeometry(sourceGeometry) {
  if (!sourceGeometry?.isBufferGeometry) {
    throw new Error('Bush proxy generation requires buffer geometry.');
  }
  sourceGeometry.computeBoundingBox();
  const sourceBounds = sourceGeometry.boundingBox;
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  if (
    sourceSize.x < MIN_PROXY_EXTENT
    || sourceSize.y < MIN_PROXY_EXTENT
    || sourceSize.z < MIN_PROXY_EXTENT
  ) {
    throw new Error('Bush proxy generation requires non-degenerate authored bounds.');
  }

  const positions = [];
  const indices = [];
  for (const angle of PROXY_CARD_ANGLES) {
    appendProxyCard({ positions, indices, bounds: sourceBounds, angle });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.proxyKind = 'crossed-foliage-cards';
  return geometry;
}

export function createBushProxyMaterial(sourceMaterial, {
  color = DEFAULT_PROXY_COLOR,
  minimumHeight = 0,
  maximumHeight = 1,
} = {}) {
  const value = proxyColor(sourceMaterial, color);
  const bottom = value.clone().multiplyScalar(0.72);
  const top = value.clone().lerp(new THREE.Color('#d7ef9a'), 0.22);
  const height = Math.max(MIN_PROXY_EXTENT, maximumHeight - minimumHeight);
  const heightMix = clamp(positionLocal.y.sub(float(minimumHeight)).div(float(height)), 0, 1);
  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.colorNode = mix(
    vec3(bottom.r, bottom.g, bottom.b),
    vec3(top.r, top.g, top.b),
    heightMix,
  );
  material.normalNode = vec3(0, 1, 0).transformDirection(cameraViewMatrix);
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

export function createBushProxyPrototype(prototype, options = {}) {
  if (!prototype?.geometry || !prototype?.material) {
    throw new Error('Bush proxy generation requires a complete prototype.');
  }
  prototype.geometry.computeBoundingBox();
  const bounds = prototype.geometry.boundingBox;
  return {
    geometry: createBushProxyGeometry(prototype.geometry),
    material: createBushProxyMaterial(prototype.material, {
      ...options,
      minimumHeight: bounds.min.y,
      maximumHeight: bounds.max.y,
    }),
    kind: 'bush-proxy',
    height: prototype.height,
    prototypeId: `${prototype.prototypeId}-proxy`,
  };
}
