import * as THREE from 'three/webgpu';
import {
  texture,
  uv,
  vec3,
  vec4,
} from 'three/tsl';

export const BUSH_CAST_SHADOW = false;
export const BUSH_PROXY_TRIANGLES = 20;

const DEFAULT_PROXY_COLOR = '#6d9a5d';
const MIN_PROXY_EXTENT = 0.05;
const WHITE_THRESHOLD = 0.92;
const WHITE_SPREAD = 0.05;

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

export function createBushProxyGeometry(sourceGeometry) {
  if (!sourceGeometry?.isBufferGeometry) {
    throw new Error('Bush proxy generation requires buffer geometry.');
  }
  sourceGeometry.computeBoundingBox();
  const sourceBounds = sourceGeometry.boundingBox;
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const geometry = new THREE.IcosahedronGeometry(0.5, 0);
  geometry.computeBoundingBox();
  const proxyBounds = geometry.boundingBox;
  const proxySize = proxyBounds.getSize(new THREE.Vector3());
  const proxyCenter = proxyBounds.getCenter(new THREE.Vector3());
  geometry.translate(-proxyCenter.x, -proxyCenter.y, -proxyCenter.z);
  geometry.scale(
    Math.max(sourceSize.x, MIN_PROXY_EXTENT) / proxySize.x,
    Math.max(sourceSize.y, MIN_PROXY_EXTENT) / proxySize.y,
    Math.max(sourceSize.z, MIN_PROXY_EXTENT) / proxySize.z,
  );
  geometry.translate(sourceCenter.x, sourceCenter.y, sourceCenter.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createBushProxyMaterial(sourceMaterial, { color = DEFAULT_PROXY_COLOR } = {}) {
  const value = proxyColor(sourceMaterial, color);
  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.colorNode = vec3(value.r, value.g, value.b);
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

export function createBushProxyPrototype(prototype, options = {}) {
  if (!prototype?.geometry || !prototype?.material) {
    throw new Error('Bush proxy generation requires a complete prototype.');
  }
  return {
    geometry: createBushProxyGeometry(prototype.geometry),
    material: createBushProxyMaterial(prototype.material, options),
    kind: 'bush-proxy',
    height: prototype.height,
    prototypeId: `${prototype.prototypeId}-proxy`,
  };
}
