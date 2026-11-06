import { applyJungleMist } from './ambient/jungleMistOutput.js';
import * as THREE from 'three/webgpu';
import {
  clamp,
  float,
  mix,
  positionGeometry,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assignBushFoliageMaterialData } from '../../render/postprocessing/PostProcessingMaterialData.js';
import { applyUnderstoryPalette, authoredFoliageColor, biomeUnderstoryColor, cloneAuthoredNodeMaterial } from './AuthoredFoliageMaterial.js';
import { applyPlantMotion } from './PlantMotionNodes.js';
import { resolveFoliagePalette } from './forest/foliagePalette.js';
import { applySkywardNormal, understoryShadeEmission } from './forest/foliageLight.js';
import { applyCloudShadow } from './CloudShadow.js';

export const BUSH_CAST_SHADOW = false;
export const BUSH_PROXY_TRIANGLES = 60;

const DEFAULT_PROXY_COLOR = '#6d8a58';
const MIN_PROXY_EXTENT = 0.05;
const PROXY_FIT_MARGIN = 2e-7;
const WHITE_THRESHOLD = 0.92;
const WHITE_SPREAD = 0.05;
const PROXY_LOBES = Object.freeze([
  Object.freeze([-0.26, -0.14, 0.04, 0.68, 0.64, 0.76]),
  Object.freeze([0.26, -0.12, -0.05, 0.68, 0.68, 0.76]),
  Object.freeze([0, 0.08, 0.04, 0.74, 0.66, 0.68]),
]);

function usesCutout(material) {
  return Boolean(
    material.map
    || material.alphaMap
    || material.transparent
    || (Number.isFinite(material.opacity) && material.opacity < 1),
  );
}

export function cloneBushMaterial(source, { config = null, height = 0, tileId = null, motion = 'woody-shrub', biomeLook = false } = {}) {
  if (!source?.isMaterial) throw new Error('Bush prototypes require an authored material.');
  const material = cloneAuthoredNodeMaterial(source, { lit: true });
  if (material.map?.colorSpace !== undefined) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }
  material.colorNode = authoredFoliageColor(material);
  if (config) applyUnderstoryPalette(material, config, tileId, 'auto', { biomeLook });
  else material.emissiveNode = understoryShadeEmission(material.colorNode);
  applyPlantMotion(material, { wind: config?.wind, height, profile: motion });
  if (config) applySkywardNormal(material);
  material.side = THREE.DoubleSide;
  if (usesCutout(material)) {
    material.alphaTest = Math.max(0.35, material.alphaTest ?? 0);
    material.transparent = false;
  }
  material.depthWrite = true;
  material.needsUpdate = true;
  applyJungleMist(material, config?.ambientEffects);
  return assignBushFoliageMaterialData(material);
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

function expandedProxyBounds(sourceGeometry) {
  sourceGeometry.computeBoundingBox();
  const sourceBounds = sourceGeometry.boundingBox;
  const center = sourceBounds.getCenter(new THREE.Vector3());
  const size = sourceBounds.getSize(new THREE.Vector3());
  size.set(
    Math.max(size.x, MIN_PROXY_EXTENT),
    Math.max(size.y, MIN_PROXY_EXTENT),
    Math.max(size.z, MIN_PROXY_EXTENT),
  );
  const half = size.multiplyScalar(0.5);
  return new THREE.Box3(center.clone().sub(half), center.clone().add(half));
}

function fitGeometryToBounds(geometry, bounds) {
  geometry.computeBoundingBox();
  const current = geometry.boundingBox;
  const currentSize = current.getSize(new THREE.Vector3());
  const currentCenter = current.getCenter(new THREE.Vector3());
  const targetSize = bounds.getSize(new THREE.Vector3());
  const targetCenter = bounds.getCenter(new THREE.Vector3());
  geometry.translate(-currentCenter.x, -currentCenter.y, -currentCenter.z);
  geometry.scale(
    (targetSize.x + PROXY_FIT_MARGIN) / Math.max(MIN_PROXY_EXTENT, currentSize.x),
    (targetSize.y + PROXY_FIT_MARGIN) / Math.max(MIN_PROXY_EXTENT, currentSize.y),
    (targetSize.z + PROXY_FIT_MARGIN) / Math.max(MIN_PROXY_EXTENT, currentSize.z),
  );
  geometry.translate(targetCenter.x, targetCenter.y, targetCenter.z);
}

export function createBushProxyGeometry(sourceGeometry) {
  if (!sourceGeometry?.isBufferGeometry) {
    throw new Error('Bush proxy generation requires buffer geometry.');
  }
  const proxyBounds = expandedProxyBounds(sourceGeometry);
  const lobes = PROXY_LOBES.map(([x, y, z, width, height, depth]) => {
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    geometry.scale(width, height, depth);
    geometry.translate(x, y, z);
    return geometry;
  });
  const geometry = mergeGeometries(lobes, false);
  lobes.forEach((lobe) => lobe.dispose());
  fitGeometryToBounds(geometry, proxyBounds);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.proxyKind = 'clustered-low-poly-canopy';
  return geometry;
}

export function createBushProxyMaterial(sourceMaterial, {
  color = DEFAULT_PROXY_COLOR,
  minimumHeight = 0,
  maximumHeight = 1,
  config = null,
  tileId = null,
  motion = 'woody-shrub',
  biomeLook = false,
} = {}) {
  const value = proxyColor(sourceMaterial, color);
  const palette = config ? resolveFoliagePalette(config, tileId) : null;
  const bottom = (palette?.base ?? value.clone().multiplyScalar(0.72)).clone();
  const top = (palette?.tip ?? value.clone().lerp(new THREE.Color('#c8d48c'), 0.2)).clone();
  const height = Math.max(MIN_PROXY_EXTENT, maximumHeight - minimumHeight);
  const heightMix = clamp(positionGeometry.y.sub(float(minimumHeight)).div(float(height)), 0, 1);
  const material = new THREE.MeshLambertNodeMaterial({ flatShading: true });
  const ramp = mix(
    vec3(bottom.r, bottom.g, bottom.b),
    vec3(top.r, top.g, top.b),
    heightMix,
  );
  const shadedColor = biomeLook ? biomeUnderstoryColor(ramp) : ramp;
  material.colorNode = shadedColor;
  material.emissiveNode = understoryShadeEmission(shadedColor);
  material.transparent = false;
  material.depthWrite = true;
  applyPlantMotion(material, { wind: config?.wind, height, profile: motion });
  if (config) applySkywardNormal(material);
  applyCloudShadow(material, config?.sky);
  applyJungleMist(material, config?.ambientEffects);
  return assignBushFoliageMaterialData(material);
}

export function createBushProxyPrototype(prototype, options = {}) {
  if (!prototype?.geometry || !prototype?.material) {
    throw new Error('Bush proxy generation requires a complete prototype.');
  }
  const bounds = expandedProxyBounds(prototype.geometry);
  return {
    geometry: createBushProxyGeometry(prototype.geometry),
    material: createBushProxyMaterial(prototype.material, {
      ...options,
      motion: prototype.material.userData.plantMotionProfile,
      minimumHeight: bounds.min.y,
      maximumHeight: bounds.max.y,
    }),
    kind: 'bush-proxy',
    instanceBiomeLook: Boolean(options.biomeLook),
    height: prototype.height,
    prototypeId: `${prototype.prototypeId}-proxy`,
  };
}
