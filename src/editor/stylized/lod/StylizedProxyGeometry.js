import * as THREE from 'three/webgpu';
import {
  attribute,
  clamp,
  dot,
  positionLocal,
  sin,
  vec2,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { treeWindTimeFor } from '../forest/TreeWindTime.js';

const TWO_PI = Math.PI * 2;

function unionBounds(parts, kind = null) {
  const box = new THREE.Box3();
  box.makeEmpty();
  for (const part of parts) {
    if (kind && part.kind !== kind) continue;
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox);
  }
  return box.isEmpty() ? null : box;
}

function makeMaterial(color, side = THREE.FrontSide) {
  const value = new THREE.Color(color);
  const material = new THREE.MeshLambertNodeMaterial({ side });
  material.colorNode = vec3(value.r, value.g, value.b);
  return material;
}

function makeTreeLeafMaterial(color, config, bounds, side = THREE.FrontSide) {
  const material = makeMaterial(color, side);
  const wind = config.wind;
  const time = treeWindTimeFor(config);
  // `treeWindTimeFor` always yields a node, so a config without a wind block has
  // to be rejected here or prototype construction throws on it.
  if (!time || !bounds || !Array.isArray(wind?.direction)) return material;
  const minimumY = bounds.min.y;
  const height = Math.max(0.001, bounds.max.y - minimumY);
  const normalizedHeight = clamp(positionLocal.y.sub(minimumY).div(height), 0, 1);
  const heightMask = normalizedHeight.mul(normalizedHeight);
  const windDirection = vec2(wind.direction[0], wind.direction[1]);
  const phase = attribute('instanceDither', 'vec3').y.mul(TWO_PI);
  const wave = sin(dot(positionLocal.xz, windDirection).mul(wind.frequency)
    .add(time.mul(wind.speed))
    .add(phase));
  const sway = windDirection.mul(wave.mul(config.trees.windStrength).mul(heightMask));
  const dip = wave.abs().mul(config.trees.windStrength).mul(config.trees.dip).mul(heightMask);
  material.positionNode = positionLocal.add(vec3(sway.x, dip.negate(), sway.y));
  return material;
}

export function createTreeProxyPrototype(parts, config) {
  const combinedBounds = unionBounds(parts);
  const leafBounds = unionBounds(parts, 'leaf') ?? combinedBounds;
  const trunkBounds = unionBounds(parts, 'trunk') ?? combinedBounds;
  const leafSize = leafBounds.getSize(new THREE.Vector3());
  const leafCenter = leafBounds.getCenter(new THREE.Vector3());
  const trunkSize = trunkBounds.getSize(new THREE.Vector3());
  const trunkCenter = trunkBounds.getCenter(new THREE.Vector3());

  const crownWidth = Math.max(0.2, Math.max(leafSize.x, leafSize.z));
  const crownHeight = Math.max(0.2, leafSize.y);
  const crownLobeGeometries = [
    [-0.22, -0.08, 0.04, 0.68],
    [0.2, -0.02, -0.08, 0.72],
    [0, 0.24, 0.08, 0.62],
  ].map(([offsetX, offsetY, offsetZ, scale], index) => {
    const geometry = new THREE.DodecahedronGeometry(0.5, 0);
    geometry.scale(
      crownWidth * scale,
      crownHeight * scale,
      crownWidth * scale * (index === 2 ? 0.84 : 0.96),
    );
    geometry.translate(
      leafCenter.x + offsetX * crownWidth,
      leafCenter.y + offsetY * crownHeight,
      leafCenter.z + offsetZ * crownWidth,
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  });
  const canopyGeometry = mergeGeometries(crownLobeGeometries, false);
  crownLobeGeometries.forEach((geometry) => geometry.dispose());
  canopyGeometry.computeBoundingBox();
  canopyGeometry.computeBoundingSphere();
  const branchInclusiveDiameter = Math.max(trunkSize.x, trunkSize.z);
  const proxyTrunkDiameter = Math.min(branchInclusiveDiameter, crownWidth * 0.14);
  const trunkGeometry = new THREE.CylinderGeometry(
    Math.max(0.04, proxyTrunkDiameter * 0.34),
    Math.max(0.05, proxyTrunkDiameter * 0.5),
    Math.max(0.1, trunkSize.y),
    5,
    1,
  );
  trunkGeometry.translate(trunkCenter.x, trunkCenter.y, trunkCenter.z);
  trunkGeometry.computeBoundingBox();
  trunkGeometry.computeBoundingSphere();

  return {
    height: Math.max(0.1, combinedBounds.max.y - combinedBounds.min.y),
    width: Math.max(0.1, combinedBounds.max.x - combinedBounds.min.x),
    depth: Math.max(0.1, combinedBounds.max.z - combinedBounds.min.z),
    proxyParts: [
      {
        geometry: canopyGeometry,
        material: makeTreeLeafMaterial(
          config.trees.leafTop,
          config,
          canopyGeometry.boundingBox,
        ),
        kind: 'leaf',
      },
      {
        geometry: trunkGeometry,
        material: makeMaterial(config.trees.barkTint),
        kind: 'trunk',
      },
    ],
  };
}

export function createCanopyClusterPart(config) {
  const geometry = new THREE.DodecahedronGeometry(0.5, 1);
  geometry.scale(1, 0.62, 1);
  geometry.translate(0, 0.5, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {
    geometry,
    material: makeTreeLeafMaterial(
      config.trees.leafBottom,
      config,
      geometry.boundingBox,
    ),
    kind: 'leaf',
  };
}

export function createForestUnderstoryPrototypes(config) {
  const logGeometry = new THREE.CylinderGeometry(0.12, 0.17, 1.8, 6, 1);
  logGeometry.rotateZ(Math.PI * 0.5);
  logGeometry.translate(0, 0.14, 0);
  logGeometry.computeBoundingBox();
  logGeometry.computeBoundingSphere();
  return [
    [{
      geometry: logGeometry,
      material: makeMaterial(config.trees.barkTint),
      kind: 'trunk',
    }],
  ];
}

export function createRockProxyPrototype(prototype, proxyColor = '#b8ad98') {
  prototype.geometry.computeBoundingBox();
  const bounds = prototype.geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const geometry = new THREE.DodecahedronGeometry(0.5, 0);
  geometry.scale(
    Math.max(0.1, size.x),
    Math.max(0.1, size.y),
    Math.max(0.1, size.z),
  );
  geometry.translate(center.x, center.y, center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = prototype.material.clone();
  if ('map' in material) material.map = null;
  if ('color' in material) material.color = new THREE.Color(proxyColor);
  material.flatShading = true;
  material.needsUpdate = true;
  return {
    height: Math.max(0.1, size.y),
    parts: [{ geometry, material, kind: 'rock' }],
  };
}
