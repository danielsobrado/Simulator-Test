import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COLLIDER_NODE_PATTERN = /^COLLIDER(?:_WALKABLE)?(?:$|[_:.-])/i;

/**
 * Shared GLB prototype grounding for stylized scatter.
 *
 * Upstream GrassField keeps rocks/trees at their authored scene transforms.
 * When we re-instance them across the streamed world we must NOT bake the
 * demo's art-directed tumble/lean into the prototype — only the mesh shape
 * and Sketchfab world scale — then sit the AABB on y = 0.
 */

export function ensureVertexNormals(geometry) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}

export function groundGeometry(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  geometry.translate(-centerX, -bounds.min.y, -centerZ);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  ensureVertexNormals(geometry);
  return geometry;
}

/**
 * Scale-only bake: drops placement rotation/lean from the demo GLB so scatter
 * instances rest naturally. Matches the mesh's local authored up-axis.
 */
export function bakeScaledGeometry(mesh) {
  const geometry = mesh.geometry.clone();
  const worldScale = new THREE.Vector3();
  mesh.getWorldScale(worldScale);
  geometry.scale(
    Math.abs(worldScale.x) || 1,
    Math.abs(worldScale.y) || 1,
    Math.abs(worldScale.z) || 1,
  );
  return groundGeometry(geometry);
}

/**
 * Full world-matrix bake: keeps parent axis fixes (Sketchfab −90°) and nested
 * part offsets. Used for multi-part pines whose parts are authored upright
 * under a Sketchfab root.
 */
export function bakeWorldGeometry(mesh) {
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  return geometry;
}

function sceneNodesByName(scene, names, label) {
  const requested = new Map(names.map((name) => [
    THREE.PropertyBinding.sanitizeNodeName(name),
    name,
  ]));
  const found = new Map();
  scene.traverse((node) => {
    const authoredName = requested.get(node.name);
    if (authoredName && !found.has(authoredName)) found.set(authoredName, node);
  });
  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`${label} references missing GLB nodes: ${missing.join(', ')}.`);
  }
  return names.map((name) => found.get(name));
}

/**
 * Resolves configuration-authored groups of scene roots.
 *
 * Packs commonly present their reusable objects in a showroom scene rather
 * than as separate files. Keeping the grouping in YAML lets one GLB supply
 * multi-part plants or trees without baking source-scene placement into the
 * streamed instances.
 */
export function resolveAuthoredPrototypeGroups(scene, groups, label = 'Authored prototype') {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error(`${label} groups must be a non-empty array.`);
  }
  return groups.map((names, index) => {
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error(`${label} group ${index} must contain at least one node name.`);
    }
    return sceneNodesByName(scene, names, label);
  });
}

function collectMeshes(roots) {
  const meshes = [];
  const seen = new Set();
  for (const root of roots) {
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry || seen.has(node)) return;
      seen.add(node);
      meshes.push(node);
    });
  }
  return meshes;
}

function mergePartsByMaterial(parts) {
  const buckets = new Map();
  for (const part of parts) {
    const material = part.source.material;
    const key = Array.isArray(material)
      ? `multi:${part.source.uuid}`
      : `single:${material?.uuid ?? part.source.uuid}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(part);
    else buckets.set(key, [part]);
  }
  return [...buckets.values()].flatMap((bucket) => {
    if (bucket.length === 1) return bucket;
    const geometry = mergeGeometries(
      bucket.map((part) => ensureVertexNormals(part.geometry)),
      false,
    );
    if (!geometry) return bucket;
    for (const part of bucket) part.geometry.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    ensureVertexNormals(geometry);
    return [{ geometry, source: bucket[0].source }];
  });
}

/**
 * Extracts curated multi-part prototypes from a showroom-style GLB.
 *
 * Every group is grounded and centred as one object, but its mesh parts remain
 * separate so each embedded material (leaf, stem, blossom, and so on) survives
 * instancing and both authored LOD bands.
 */
export function extractAuthoredGroupedPrototypes(
  scene,
  { scale = 1, groups, label = 'Authored prototype' } = {},
) {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Authored scatter prototype scale must be positive.');
  }
  scene.updateMatrixWorld(true);
  return resolveAuthoredPrototypeGroups(scene, groups, label).map((roots) => {
    const meshes = collectMeshes(roots);
    if (meshes.length === 0) {
      throw new Error(`${label} group contains no mesh geometry.`);
    }
    const parts = meshes.map((source) => {
      const geometry = bakeWorldGeometry(source);
      if (scale !== 1) geometry.scale(scale, scale, scale);
      geometry.computeBoundingBox();
      return { geometry, source };
    });
    const bounds = new THREE.Box3();
    for (const part of parts) bounds.union(part.geometry.boundingBox);
    const centerX = (bounds.min.x + bounds.max.x) * 0.5;
    const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
    for (const part of parts) {
      part.geometry.translate(-centerX, -bounds.min.y, -centerZ);
      part.geometry.computeBoundingBox();
      part.geometry.computeBoundingSphere();
      ensureVertexNormals(part.geometry);
    }
    return mergePartsByMaterial(parts);
  });
}

/**
 * Turns every authored mesh in a GLB into an independently grounded scatter
 * prototype. Full world transforms retain Sketchfab axis/unit conversions while
 * re-centering discards the source scene's showcase placement.
 */
export function extractAuthoredMeshPrototypes(scene, { scale = 1, rootNames = null } = {}) {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Authored scatter prototype scale must be positive.');
  }
  scene.updateMatrixWorld(true);
  const prototypes = [];
  const roots = rootNames
    ? sceneNodesByName(scene, rootNames, 'Authored mesh prototype')
    : [scene];
  for (const node of collectMeshes(roots)) {
    const geometry = bakeWorldGeometry(node);
    if (scale !== 1) geometry.scale(scale, scale, scale);
    prototypes.push({
      geometry: groundGeometry(geometry),
      source: node,
    });
  }
  return prototypes;
}

function colliderSuffix(name) {
  return THREE.PropertyBinding.sanitizeNodeName(
    name.replace(/^COLLIDER(?:_WALKABLE)?(?:[_:.-])?/i, ''),
  );
}

function authoredColliderFor(visual, index, visualCount, colliders) {
  const visualKey = THREE.PropertyBinding.sanitizeNodeName(visual.name ?? '');
  const byName = colliders.find((node) => colliderSuffix(node.name) === visualKey);
  if (byName) return byName;
  const byIndex = colliders.find((node) => colliderSuffix(node.name) === String(index));
  if (byIndex) return byIndex;
  return visualCount === 1 && colliders.length === 1 ? colliders[0] : null;
}

function alignedProxyGeometry(proxyNode, visualBounds, scale) {
  if (!proxyNode) return null;
  const geometry = bakeWorldGeometry(proxyNode);
  if (scale !== 1) geometry.scale(scale, scale, scale);
  const centerX = (visualBounds.min.x + visualBounds.max.x) * 0.5;
  const centerZ = (visualBounds.min.z + visualBounds.max.z) * 0.5;
  geometry.translate(-centerX, -visualBounds.min.y, -centerZ);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  ensureVertexNormals(geometry);
  return geometry;
}

/**
 * Extracts visual rocks and reserved authored collision meshes in one pass.
 * Reserved nodes never become render prototypes. The proxy is translated by the
 * visual rock's centring/grounding transform so both remain in the same frame.
 */
export function extractAuthoredRockPrototypes(scene, { scale = 1, rootNames = null } = {}) {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Authored rock prototype scale must be positive.');
  }
  scene.updateMatrixWorld(true);
  const roots = rootNames
    ? sceneNodesByName(scene, rootNames, 'Authored rock prototype')
    : [scene];
  const meshes = collectMeshes(roots);
  const colliderMeshes = meshes.filter((node) => COLLIDER_NODE_PATTERN.test(node.name ?? ''));
  const visualMeshes = meshes.filter((node) => !COLLIDER_NODE_PATTERN.test(node.name ?? ''));
  return visualMeshes.map((source, index) => {
    const rawVisual = bakeWorldGeometry(source);
    if (scale !== 1) rawVisual.scale(scale, scale, scale);
    rawVisual.computeBoundingBox();
    const visualBounds = rawVisual.boundingBox.clone();
    const proxyNode = authoredColliderFor(source, index, visualMeshes.length, colliderMeshes);
    return {
      geometry: groundGeometry(rawVisual),
      source,
      collisionProxyGeometry: alignedProxyGeometry(proxyNode, visualBounds, scale),
      collisionProxyName: proxyNode?.name ?? null,
    };
  });
}

export function isUprightSize(size, { strict = false } = {}) {
  if (strict) return size.y >= size.x && size.y >= size.z;
  return size.y >= size.x * 0.55 && size.y >= size.z * 0.55;
}

/**
 * Rock prototypes: scale only — never bake the demo GLB's placement tumble.
 * Dedupes repeated instances of the same mesh geometry.
 */
export function extractRockPrototypes(scene, rockMaterialName) {
  const seenGroups = new Set();
  const prototypes = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (!materials.some((material) => material?.name === rockMaterialName)) return;
    const groupKey = node.parent?.name || node.geometry?.uuid || node.name;
    if (!groupKey || seenGroups.has(groupKey)) return;
    seenGroups.add(groupKey);
    prototypes.push({
      geometry: bakeScaledGeometry(node),
      source: node,
    });
  });
  return prototypes;
}
