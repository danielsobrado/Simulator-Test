import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

function createCrossCanopyGeometry(bounds) {
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  const halfX = Math.max(0.1, (bounds.max.x - bounds.min.x) * 0.5);
  const halfZ = Math.max(0.1, (bounds.max.z - bounds.min.z) * 0.5);
  const lowY = bounds.min.y;
  const shoulderY = lowY + (bounds.max.y - lowY) * 0.42;
  const highY = bounds.max.y;
  const positions = new Float32Array([
    centerX - halfX, lowY, centerZ,
    centerX + halfX, lowY, centerZ,
    centerX + halfX * 0.82, shoulderY, centerZ,
    centerX, highY, centerZ,
    centerX - halfX * 0.82, shoulderY, centerZ,
    centerX, lowY, centerZ - halfZ,
    centerX, lowY, centerZ + halfZ,
    centerX, shoulderY, centerZ + halfZ * 0.82,
    centerX, highY, centerZ,
    centerX, shoulderY, centerZ - halfZ * 0.82,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 4, 4, 2, 3,
    5, 6, 7, 5, 7, 9, 9, 7, 8,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createBoxForBounds(bounds, minimumWidth = 0.08) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const geometry = new THREE.BoxGeometry(
    Math.max(minimumWidth, size.x),
    Math.max(minimumWidth, size.y),
    Math.max(minimumWidth, size.z),
  );
  geometry.translate(center.x, center.y, center.z);
  return geometry;
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
  const trunkGeometry = new THREE.CylinderGeometry(
    Math.max(0.04, Math.max(trunkSize.x, trunkSize.z) * 0.42),
    Math.max(0.05, Math.max(trunkSize.x, trunkSize.z) * 0.55),
    Math.max(0.1, trunkSize.y),
    5,
    1,
  );
  trunkGeometry.translate(trunkCenter.x, trunkCenter.y, trunkCenter.z);

  return {
    height: Math.max(0.1, combinedBounds.max.y - combinedBounds.min.y),
    width: Math.max(0.1, combinedBounds.max.x - combinedBounds.min.x),
    depth: Math.max(0.1, combinedBounds.max.z - combinedBounds.min.z),
    proxyParts: [
      {
        geometry: canopyGeometry,
        material: makeMaterial(config.trees.leafTop),
        kind: 'leaf',
      },
      {
        geometry: trunkGeometry,
        material: makeMaterial(config.trees.barkTint),
        kind: 'trunk',
      },
    ],
    fallbackImpostorParts: [
      {
        geometry: createCrossCanopyGeometry(leafBounds),
        material: makeMaterial(config.trees.leafTop, THREE.DoubleSide),
        kind: 'leaf',
      },
      {
        geometry: createBoxForBounds(trunkBounds),
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
    material: makeMaterial(config.trees.leafBottom),
    kind: 'leaf',
  };
}

export function createForestUnderstoryPrototypes(config) {
  const shrubGeometry = new THREE.DodecahedronGeometry(0.5, 0);
  shrubGeometry.scale(1.15, 0.7, 1);
  shrubGeometry.translate(0, 0.35, 0);
  shrubGeometry.computeBoundingBox();
  shrubGeometry.computeBoundingSphere();
  const logGeometry = new THREE.CylinderGeometry(0.12, 0.17, 1.8, 6, 1);
  logGeometry.rotateZ(Math.PI * 0.5);
  logGeometry.translate(0, 0.14, 0);
  logGeometry.computeBoundingBox();
  logGeometry.computeBoundingSphere();
  return [
    [{
      geometry: shrubGeometry,
      material: makeMaterial(config.trees.leafBottom),
      kind: 'leaf',
    }],
    [{
      geometry: logGeometry,
      material: makeMaterial(config.trees.barkTint),
      kind: 'trunk',
    }],
  ];
}

export function createRockProxyPrototype(prototype) {
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
  material.flatShading = true;
  material.needsUpdate = true;
  return {
    height: Math.max(0.1, size.y),
    parts: [{ geometry, material, kind: 'rock' }],
  };
}
