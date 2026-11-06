import * as THREE from 'three/webgpu';
import { attribute, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { treeWindTimeFor } from '../forest/TreeWindTime.js';
import { foliageWindPosition } from '../forest/foliageWind.js';
import { foliageMaterialClass } from '../forest/FoliageNodeMaterial.js';
import { configureTreeFoliageSurface } from '../forest/TreeFoliageSurface.js';
import { resolveTreeFoliageSettings, resolveTreeBarkSettings } from '../forest/treeSurfaceSettings.js';
import { bakeCanopyVisibility } from '../forest/CanopyVisibility.js';
import { treeFoliageEmission, treeBarkEmission } from '../forest/foliageLight.js';
import { applyTreeBarkWetSurface } from '../forest/TreeWetSurface.js';
import { surfaceWetnessUniform } from '../../weather/surfaceWetness.js';

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
  material.color.copy(value);
  material.colorNode = vec3(value.r, value.g, value.b);
  return material;
}

/** Preserve the broad color of painted crowns in the cheap/loading fallback. */
function proxyCanopyColor(parts, fallback) {
  const sum = new THREE.Vector3();
  let count = 0;
  for (const part of parts) {
    if (part.kind !== 'leaf') continue;
    const colors = part.geometry.getAttribute('color');
    if (!colors) continue;
    for (let i = 0; i < colors.count; i++) {
      sum.x += colors.getX(i); sum.y += colors.getY(i); sum.z += colors.getZ(i);
    }
    count += colors.count;
  }
  return count > 0 ? new THREE.Color().setRGB(sum.x / count, sum.y / count, sum.z / count) : fallback;
}

function makeTreeLeafMaterial(color, config, bounds, geometry, settings = resolveTreeFoliageSettings(config.trees)) {
  const material = settings.enabled
    ? new (foliageMaterialClass(THREE.MeshLambertNodeMaterial))({ side: THREE.DoubleSide }) : makeMaterial(color);
  if (settings.enabled) {
    const value = new THREE.Color(color);
    material.colorNode = vec3(...value.toArray());
    bakeCanopyVisibility([{ kind: 'leaf', geometry }], config.trees);
    const surface = configureTreeFoliageSurface(material, { settings,
      visibility: attribute('canopyVisibility', 'float'), color: material.colorNode,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    });
    material.emissiveNode = treeFoliageEmission(material.colorNode, null, surface.visibility);
  }
  const wind = config.wind;
  const time = treeWindTimeFor(config);
  // `treeWindTimeFor` always yields a node, so a config without a wind block has
  // to be rejected here or prototype construction throws on it.
  if (!time || !bounds || !Array.isArray(wind?.direction)) return material;
  material.positionNode = foliageWindPosition({
    config, time, minimumY: bounds.min.y, maximumY: bounds.max.y, flutter: false,
  });
  return material;
}

function makeTreeTrunkMaterial(config) {
  const settings = resolveTreeBarkSettings(config.trees);
  if (!settings.enabled) return makeMaterial(config.trees.barkTint);
  const material = new (foliageMaterialClass(THREE.MeshStandardNodeMaterial))({ roughness: settings.roughness });
  const value = new THREE.Color(config.trees.barkTint);
  material.colorNode = vec3(...value.toArray());
  material.treeWetnessNode = surfaceWetnessUniform.mul(0.7);
  material.colorNode = material.colorNode.mul(material.treeWetnessNode.mul(settings.wetStrength * 0.45).oneMinus());
  material.emissiveNode = treeBarkEmission(material.colorNode);
  return applyTreeBarkWetSurface(material, settings);
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
    // A low central lobe overlaps the trunk axis. The three silhouette lobes
    // can leave an empty pocket around that axis even when their AABBs overlap,
    // which reads as a floating crown at proxy distance.
    [0, -0.22, 0, 0.5],
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
  const connectorBounds = crownLobeGeometries.at(-1).boundingBox.clone();
  const canopyGeometry = mergeGeometries(crownLobeGeometries, false);
  crownLobeGeometries.forEach((geometry) => geometry.dispose());
  canopyGeometry.computeBoundingBox();
  canopyGeometry.computeBoundingSphere();
  canopyGeometry.userData.trunkConnectorBounds = {
    min: connectorBounds.min.toArray(),
    max: connectorBounds.max.toArray(),
  };
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
          proxyCanopyColor(parts, config.trees.leafTop),
          config,
          canopyGeometry.boundingBox,
          canopyGeometry,
          parts.find(part => part.kind === 'leaf')?.material?.userData?.treeFoliageSurface,
        ),
        kind: 'leaf',
      },
      {
        geometry: trunkGeometry,
        material: makeTreeTrunkMaterial(config),
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
      geometry,
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
