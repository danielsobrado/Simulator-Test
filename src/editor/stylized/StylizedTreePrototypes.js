import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materialList } from '../assets/assetUrl.js';
import {
  bakeWorldGeometry,
  isUprightSize,
} from './StylizedPrototypeBake.js';

export function meshKind(mesh, config) {
  const names = materialList(mesh).map((material) => material?.name);
  if (names.includes(config.assets.leafMaterial)) return 'leaf';
  if (names.includes(config.assets.trunkMaterial)) return 'trunk';
  return null;
}

function subtreeKinds(root, config) {
  let hasLeaf = false;
  let hasTrunk = false;
  root.traverse((node) => {
    if (!node.isMesh) return;
    const kind = meshKind(node, config);
    hasLeaf ||= kind === 'leaf';
    hasTrunk ||= kind === 'trunk';
  });
  return { hasLeaf, hasTrunk };
}

export function findPrototypeRoots(root, config) {
  const kinds = subtreeKinds(root, config);
  if (!kinds.hasLeaf || !kinds.hasTrunk) return [];
  const nested = root.children.flatMap((child) => findPrototypeRoots(child, config));
  return nested.length > 0 ? nested : [root];
}

/**
 * Bake each pine part through its full world matrix so Sketchfab parent scale
 * and the −90° axis fix stay intact. Ground on the trunk base (not hanging
 * foliage) so trunks don't float when leaves extend below the bark.
 */
export function extractPrototypeParts(root, config) {
  const sources = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const kind = meshKind(node, config);
    if (!kind) return;
    sources.push({ node, kind });
  });
  if (sources.length === 0) return null;

  const combinedMin = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  const combinedMax = new THREE.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  );
  let trunkMinY = Number.POSITIVE_INFINITY;
  const baked = sources.map(({ node, kind }) => {
    const geometry = bakeWorldGeometry(node);
    geometry.computeBoundingBox();
    combinedMin.min(geometry.boundingBox.min);
    combinedMax.max(geometry.boundingBox.max);
    if (kind === 'trunk') {
      trunkMinY = Math.min(trunkMinY, geometry.boundingBox.min.y);
    }
    return { geometry, kind, source: node };
  });

  const size = combinedMax.clone().sub(combinedMin);
  if (!isUprightSize(size, { strict: true }) || !Number.isFinite(trunkMinY)) {
    for (const part of baked) part.geometry.dispose();
    return null;
  }

  const centerX = (combinedMin.x + combinedMax.x) * 0.5;
  const centerZ = (combinedMin.z + combinedMax.z) * 0.5;
  for (const part of baked) {
    part.geometry.translate(-centerX, -trunkMinY, -centerZ);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
    part.geometry.computeVertexNormals();
  }
  return baked.map(({ geometry, kind, source }) => ({ geometry, kind, source }));
}

export function createRootCollarGeometry(parts) {
  const trunkParts = parts.filter((part) => part.kind === 'trunk');
  if (trunkParts.length === 0) return null;
  let radius = 0;
  for (const part of trunkParts) {
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox;
    radius = Math.max(
      radius,
      Math.abs(box.min.x),
      Math.abs(box.max.x),
      Math.abs(box.min.z),
      Math.abs(box.max.z),
    );
  }
  radius = Math.max(0.16, radius * 0.32);
  const height = Math.max(0.18, radius * 0.7);
  const geometry = new THREE.CylinderGeometry(radius * 1.45, radius, height, 7, 1);
  geometry.translate(0, height * 0.42, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();
  return geometry;
}

export function attachRootCollar(parts) {
  const trunkPart = parts.find((part) => part.kind === 'trunk');
  const root = createRootCollarGeometry(parts);
  if (!trunkPart || !root) return false;
  const trunk = trunkPart.geometry;
  for (const name of Object.keys(root.attributes)) {
    if (!trunk.getAttribute(name)) root.deleteAttribute(name);
  }
  for (const [name, attribute] of Object.entries(trunk.attributes)) {
    if (root.getAttribute(name)) continue;
    root.setAttribute(name, new THREE.BufferAttribute(
      new attribute.array.constructor(root.getAttribute('position').count * attribute.itemSize),
      attribute.itemSize,
      attribute.normalized,
    ));
  }
  const merged = mergeGeometries([trunk, root], false);
  root.dispose();
  if (!merged) return false;
  trunk.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.computeVertexNormals();
  trunkPart.geometry = merged;
  return true;
}
