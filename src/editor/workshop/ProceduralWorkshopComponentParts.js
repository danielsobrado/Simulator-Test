import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeModelParts } from '../assets/modelParts.js';
import { normalizeProceduralRecipe } from './ProceduralAssetStore.js';
import { getCastleWallOpenings } from './ProceduralCastleWallLayout.js';
import {
  createIdentityComponentTransform,
  getComponentTransform,
} from './ProceduralWorkshopComponentTransforms.js';
import { getWorkshopComponentEditPolicy } from './ProceduralWorkshopEditPolicy.js';
import { createProceduralWorkshopParts } from './ProceduralWorkshopGenerator.js';

const STRUCTURE_MIN_HEIGHT = 1.4;
const STRUCTURE_MIN_HORIZONTAL = 0.55;
const OPENING_EXPANSION = Object.freeze({ x: 0.42, y: 0.36, z: 0.52 });
const OPENING_INSERT_SLOTS = new Set(['wood', 'metal', 'recess']);
const EMPTY_MATRIX = new THREE.Matrix4();
const ZERO = new THREE.Vector3();

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function materialSlot(material) {
  if (material?.userData?.workshopSlot) return material.userData.workshopSlot;
  if ((material?.metalness ?? 0) >= 0.4) return 'metal';
  if ((material?.emissiveIntensity ?? 0) > 0.01) return 'recess';
  if (material?.vertexColors) return 'stone';
  if ((material?.roughness ?? 0) >= 0.94) return 'mortar';
  if ((material?.bumpScale ?? 0) >= 0.08 && (material?.roughness ?? 1) <= 0.85) {
    return 'roof';
  }
  const color = material?.color;
  if (
    (material?.roughness ?? 0) >= 0.88
    && !material?.bumpMap
    && color
    && color.g > color.r * 1.08
    && color.g > color.b * 1.08
  ) {
    return 'foliage';
  }
  if ((material?.roughness ?? 0) >= 0.86 && (material?.bumpScale ?? 0) >= 0.04) {
    return 'stone';
  }
  return 'wood';
}

function geometryEntry(part, index) {
  const geometry = part.geometry;
  if (part.matrix && !part.matrix.equals(EMPTY_MATRIX)) {
    geometry.applyMatrix4(part.matrix);
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) {
    throw new Error(`Workshop source part ${index} has no editable bounds.`);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  return {
    index,
    geometry,
    material: part.material,
    slot: materialSlot(part.material),
    bounds,
    center,
    size,
    volume: Math.max(0, size.x * size.y * size.z),
    componentId: null,
    semanticHint: geometry.userData?.workshopSemantic ?? null,
  };
}

function unionBounds(entries) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const entry of entries) bounds.union(entry.bounds);
  return bounds;
}

function horizontalDistance(entry, anchor) {
  const deltaX = entry.center.x - anchor.center.x;
  const deltaZ = entry.center.z - anchor.center.z;
  const scaleX = Math.max(0.5, anchor.size.x);
  const scaleZ = Math.max(0.5, anchor.size.z);
  return (deltaX / scaleX) ** 2 + (deltaZ / scaleZ) ** 2;
}

function createFallbackStructure(entries) {
  const bounds = unionBounds(entries);
  return {
    id: 'structure-main',
    label: 'Main walls',
    kind: 'structure',
    parentId: null,
    bounds,
    center: bounds.getCenter(new THREE.Vector3()),
    size: bounds.getSize(new THREE.Vector3()),
    sourceEntry: null,
  };
}

function createStructureAnchors(entries) {
  const hintedGroups = new Map();
  for (const entry of entries) {
    const hint = entry.semanticHint;
    if (hint?.kind !== 'structure') continue;
    const group = hintedGroups.get(hint.id) ?? {
      id: hint.id,
      label: hint.label,
      kind: 'structure',
      parentId: null,
      entries: [],
      attachmentSurface: hint.attachmentSurface ?? null,
    };
    group.entries.push(entry);
    hintedGroups.set(hint.id, group);
  }
  if (hintedGroups.size > 0) {
    return [...hintedGroups.values()].map((group) => {
      const bounds = unionBounds(group.entries);
      const sourceEntry = group.entries
        .slice()
        .sort((left, right) => right.volume - left.volume || left.index - right.index)[0];
      return {
        id: group.id,
        label: group.label,
        kind: group.kind,
        parentId: null,
        bounds,
        center: bounds.getCenter(new THREE.Vector3()),
        size: bounds.getSize(new THREE.Vector3()),
        sourceEntry,
        attachmentSurface: group.attachmentSurface,
      };
    }).sort((left, right) => (
      (left.id === 'structure-main' ? -1 : 0)
      - (right.id === 'structure-main' ? -1 : 0)
      || left.id.localeCompare(right.id)
    ));
  }
  const candidates = entries
    .filter((entry) => (
      entry.slot === 'mortar'
      && entry.size.y >= STRUCTURE_MIN_HEIGHT
      && Math.min(entry.size.x, entry.size.z) >= STRUCTURE_MIN_HORIZONTAL
    ))
    .sort((left, right) => right.volume - left.volume || left.index - right.index);
  if (candidates.length === 0) return [createFallbackStructure(entries)];

  const main = candidates[0];
  const remaining = candidates.slice(1).sort((left, right) => (
    left.center.x - right.center.x
    || left.center.z - right.center.z
    || left.index - right.index
  ));
  const anchors = [{
    id: 'structure-main',
    label: 'Main walls',
    kind: 'structure',
    parentId: null,
    bounds: main.bounds.clone(),
    center: main.center.clone(),
    size: main.size.clone(),
    sourceEntry: main,
  }];
  const sideCounts = new Map();
  for (const entry of remaining) {
    const side = entry.center.x < -0.2 ? 'left' : entry.center.x > 0.2 ? 'right' : 'secondary';
    const count = (sideCounts.get(side) ?? 0) + 1;
    sideCounts.set(side, count);
    const suffix = count === 1 ? '' : `-${count}`;
    const sideLabel = side === 'left' ? 'Left tower' : side === 'right' ? 'Right tower' : 'Secondary structure';
    anchors.push({
      id: `structure-${side}${suffix}`,
      label: count === 1 ? sideLabel : `${sideLabel} ${count}`,
      kind: 'structure',
      parentId: null,
      bounds: entry.bounds.clone(),
      center: entry.center.clone(),
      size: entry.size.clone(),
      sourceEntry: entry,
    });
  }
  return anchors;
}

function nearestStructure(entry, structures) {
  let best = structures[0];
  let bestDistance = horizontalDistance(entry, best);
  for (let index = 1; index < structures.length; index += 1) {
    const distance = horizontalDistance(entry, structures[index]);
    if (distance < bestDistance) {
      best = structures[index];
      bestDistance = distance;
    }
  }
  return best;
}

function expandedBounds(bounds, expansion = OPENING_EXPANSION) {
  return bounds.clone().expandByVector(new THREE.Vector3(
    expansion.x,
    expansion.y,
    expansion.z,
  ));
}

function openingCandidate(entry) {
  const horizontal = Math.max(entry.size.x, entry.size.z);
  const thickness = Math.min(entry.size.x, entry.size.z);
  if (entry.slot === 'wood' && entry.size.y >= 1 && horizontal >= 0.45 && thickness <= 0.5) {
    return 'door';
  }
  if (entry.slot === 'recess' && entry.size.y >= 0.34 && horizontal >= 0.25 && thickness <= 0.5) {
    return 'window';
  }
  return null;
}

function inferredOpeningAnchors(entries, structures) {
  const hintedGroups = new Map();
  for (const entry of entries) {
    const hint = entry.semanticHint;
    if (!hint || !['door', 'window'].includes(hint.kind)) continue;
    const group = hintedGroups.get(hint.id) ?? {
      id: hint.id,
      label: hint.label,
      kind: hint.kind,
      entries: [],
    };
    group.entries.push(entry);
    hintedGroups.set(hint.id, group);
  }
  const hinted = [...hintedGroups.values()].map((group) => {
    const bounds = expandedBounds(unionBounds(group.entries));
    const sourceEntry = group.entries.find((entry) => (
      group.kind === 'door' ? entry.slot === 'wood' : entry.slot === 'recess'
    )) ?? group.entries[0];
    return {
      id: group.id,
      label: group.label,
      kind: group.kind,
      parentId: structures.some(({ id }) => id === group.entries[0].semanticHint?.hostId)
        ? group.entries[0].semanticHint.hostId
        : nearestStructure(sourceEntry, structures).id,
      bounds,
      center: bounds.getCenter(new THREE.Vector3()),
      size: bounds.getSize(new THREE.Vector3()),
      sourceEntry,
    };
  });
  const candidates = entries
    .map((entry) => ({ entry, kind: openingCandidate(entry) }))
    .filter(({ entry, kind }) => Boolean(kind) && !entry.semanticHint)
    .sort((left, right) => (
      compareText(left.kind, right.kind)
      || left.entry.center.y - right.entry.center.y
      || left.entry.center.x - right.entry.center.x
      || left.entry.center.z - right.entry.center.z
      || left.entry.index - right.entry.index
    ));
  const counts = new Map();
  for (const opening of hinted) {
    const suffix = Number(opening.id.match(/-(\d+)$/)?.[1] ?? 0);
    counts.set(opening.kind, Math.max(counts.get(opening.kind) ?? 0, suffix));
  }
  const inferred = candidates.map(({ entry, kind }) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    const label = kind === 'door'
      ? count === 1 ? 'Door' : `Door ${count}`
      : `Window ${count}`;
    return {
      id: `${kind}-${count}`,
      label,
      kind,
      parentId: nearestStructure(entry, structures).id,
      bounds: expandedBounds(entry.bounds),
      center: entry.center.clone(),
      size: entry.size.clone(),
      sourceEntry: entry,
    };
  });
  return [...hinted, ...inferred].sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.center.y - right.center.y
    || left.center.x - right.center.x
    || left.center.z - right.center.z
    || left.id.localeCompare(right.id)
  ));
}

function castleOpeningAnchors(recipe) {
  if (recipe.archetype !== 'wall' || recipe.shape === 'classic') return [];
  return getCastleWallOpenings(recipe).map((opening, index) => {
    const halfWidth = opening.width / 2 + 0.48;
    const top = opening.bottom + opening.springHeight + opening.radius + 0.48;
    const bounds = new THREE.Box3(
      new THREE.Vector3(
        opening.centerX - halfWidth,
        Math.max(0, opening.bottom - 0.08),
        -recipe.depth / 2 - 0.58,
      ),
      new THREE.Vector3(
        opening.centerX + halfWidth,
        top,
        recipe.depth / 2 + 0.58,
      ),
    );
    return {
      id: opening.componentId ?? `arch-${index + 1}`,
      label: opening.componentLabel ?? `Arch ${index + 1}`,
      kind: 'opening',
      parentId: 'structure-main',
      bounds,
      center: bounds.getCenter(new THREE.Vector3()),
      size: bounds.getSize(new THREE.Vector3()),
      sourceEntry: null,
    };
  });
}

function createOpeningAnchors(entries, recipe, structures) {
  const castle = castleOpeningAnchors(recipe);
  return castle.length > 0 ? castle : inferredOpeningAnchors(entries, structures);
}

function openingScore(entry, opening) {
  if (opening.sourceEntry) {
    if (entry === opening.sourceEntry) return -1;
    if (!OPENING_INSERT_SLOTS.has(entry.slot)) return Number.POSITIVE_INFINITY;
  }
  if (!opening.bounds.containsPoint(entry.center)) return Number.POSITIVE_INFINITY;
  const delta = entry.center.clone().sub(opening.center);
  const scale = opening.size.clone().max(new THREE.Vector3(0.25, 0.25, 0.25));
  return (delta.x / scale.x) ** 2
    + (delta.y / scale.y) ** 2
    + (delta.z / scale.z) ** 2;
}

function matchingOpening(entry, openings) {
  if (!['stone', 'wood', 'metal', 'recess'].includes(entry.slot)) return null;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const opening of openings) {
    const score = openingScore(entry, opening);
    if (score < bestScore) {
      best = opening;
      bestScore = score;
    }
  }
  return best;
}

function ensureComponent(components, definition) {
  if (!components.has(definition.id)) {
    components.set(definition.id, {
      id: definition.id,
      label: definition.label,
      kind: definition.kind,
      parentId: definition.parentId ?? null,
      attachmentSurface: definition.attachmentSurface ?? null,
      entries: [],
    });
  }
  return components.get(definition.id);
}

function childDefinition(structure, suffix, label, kind) {
  return {
    id: `${structure.id}-${suffix}`,
    label: structure.id === 'structure-main' ? label : `${structure.label} ${label.toLowerCase()}`,
    kind,
    parentId: structure.id,
  };
}

function isTopologyDrivenOpening(recipe, component) {
  if (component.kind === 'opening') {
    return recipe.archetype === 'wall' && recipe.shape !== 'classic';
  }
  return component.kind === 'door' || component.kind === 'window';
}

function classifyComponents(entries, recipe) {
  const structures = createStructureAnchors(entries);
  const openings = createOpeningAnchors(entries, recipe, structures);
  const components = new Map();
  structures.forEach((structure) => ensureComponent(components, structure));
  openings.forEach((opening) => ensureComponent(components, opening));

  for (const entry of entries) {
    const opening = matchingOpening(entry, openings);
    if (opening) {
      entry.componentId = opening.id;
      ensureComponent(components, opening).entries.push(entry);
      continue;
    }

    const structure = nearestStructure(entry, structures);
    let definition = structure;
    if (entry.slot === 'foliage') {
      definition = childDefinition(structure, 'foliage', 'Ivy and plants', 'foliage');
    } else if (entry.slot === 'roof') {
      definition = childDefinition(structure, 'roof', 'Roof', 'roof');
    } else if (entry.slot === 'wood' || entry.slot === 'recess') {
      definition = childDefinition(structure, 'woodwork', 'Woodwork', 'woodwork');
    } else if (entry.slot === 'metal') {
      const high = entry.center.y >= structure.bounds.max.y - 0.2;
      definition = high
        ? childDefinition(structure, 'roof', 'Roof', 'roof')
        : childDefinition(structure, 'metalwork', 'Metalwork', 'metalwork');
    }
    entry.componentId = definition.id;
    ensureComponent(components, definition).entries.push(entry);
  }

  for (const [componentId, component] of components) {
    if (component.entries.length === 0) {
      components.delete(componentId);
      continue;
    }
    component.bounds = unionBounds(component.entries);
    component.center = component.bounds.getCenter(new THREE.Vector3());
    component.size = component.bounds.getSize(new THREE.Vector3());
    const floorPivot = ['structure', 'door', 'window', 'opening', 'woodwork'].includes(component.kind);
    component.pivot = new THREE.Vector3(
      component.center.x,
      floorPivot ? component.bounds.min.y : component.center.y,
      component.center.z,
    );
    component.storedTransform = getComponentTransform(recipe.componentTransforms, componentId);
    component.transformPolicy = isTopologyDrivenOpening(recipe, component) ? 'opening2d' : 'free';
    component.transform = component.storedTransform;
    if (component.parentId && !components.has(component.parentId)) {
      throw new Error(`Workshop component ${componentId} has a missing parent.`);
    }
    Object.freeze(component);
  }
  return components;
}

function componentMetadata(component) {
  return Object.freeze({
    id: component.id,
    label: component.label,
    kind: component.kind,
    parentId: component.parentId,
    pivot: Object.freeze(component.pivot.toArray()),
    transform: component.transform,
    storedTransform: component.storedTransform,
    transformPolicy: component.transformPolicy,
    editPolicy: getWorkshopComponentEditPolicy(component),
    attachmentSurface: component.attachmentSurface,
  });
}

function componentLocalMatrix(component, components) {
  const parentPivot = component.parentId
    ? components.get(component.parentId).pivot
    : ZERO;
  const transform = component.transformPolicy === 'opening2d'
    ? createIdentityComponentTransform()
    : component.transform;
  const position = component.pivot
    .clone()
    .sub(parentPivot)
    .add(new THREE.Vector3(...transform.position));
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation));
  return new THREE.Matrix4().compose(
    position,
    quaternion,
    new THREE.Vector3(...transform.scale),
  );
}

function componentWorldMatrix(component, components, cache, visiting = new Set()) {
  const cached = cache.get(component.id);
  if (cached) return cached;
  if (visiting.has(component.id)) {
    throw new Error(`Workshop component hierarchy contains a cycle at ${component.id}.`);
  }
  visiting.add(component.id);
  const local = componentLocalMatrix(component, components);
  const world = component.parentId
    ? componentWorldMatrix(components.get(component.parentId), components, cache, visiting)
      .clone()
      .multiply(local)
    : local;
  visiting.delete(component.id);
  cache.set(component.id, world);
  return world;
}

function componentGeometryMatrix(component, components, cache) {
  return componentWorldMatrix(component, components, cache)
    .clone()
    .multiply(new THREE.Matrix4().makeTranslation(
      -component.pivot.x,
      -component.pivot.y,
      -component.pivot.z,
    ));
}

function mergedGeometry(geometries, errorMessage) {
  if (geometries.length === 1) return geometries[0];
  let merged = null;
  try {
    merged = mergeGeometries(geometries, false);
    if (!merged) throw new Error(errorMessage);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
  } catch (error) {
    merged?.dispose();
    throw error;
  }
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}

function disposeBuiltGeometries(parts) {
  const geometries = new Set(parts.map((part) => part.geometry));
  geometries.forEach((geometry) => geometry.dispose());
}

function buildPreviewParts(entries, components, remesh) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.componentId}|${entry.slot}`;
    const group = groups.get(key) ?? {
      component: components.get(entry.componentId),
      material: entry.material,
      geometries: [],
    };
    entry.geometry.translate(
      -group.component.pivot.x,
      -group.component.pivot.y,
      -group.component.pivot.z,
    );
    group.geometries.push(entry.geometry);
    groups.set(key, group);
  }

  const parts = [];
  try {
    for (const group of groups.values()) {
      const metadata = componentMetadata(group.component);
      if (remesh) {
        parts.push({
          geometry: mergedGeometry(
            group.geometries,
            `The workshop could not merge editable component ${metadata.label}.`,
          ),
          material: group.material,
          matrix: new THREE.Matrix4(),
          component: metadata,
        });
      } else {
        for (const geometry of group.geometries) {
          parts.push({
            geometry,
            material: group.material,
            matrix: new THREE.Matrix4(),
            component: metadata,
          });
        }
      }
    }
    return parts;
  } catch (error) {
    disposeBuiltGeometries(parts);
    throw error;
  }
}

function buildRuntimeParts(entries, components, remesh) {
  const groups = new Map();
  const worldMatrices = new Map();
  for (const entry of entries) {
    const component = components.get(entry.componentId);
    entry.geometry.applyMatrix4(componentGeometryMatrix(component, components, worldMatrices));
    const group = groups.get(entry.slot) ?? {
      material: entry.material,
      geometries: [],
    };
    group.geometries.push(entry.geometry);
    groups.set(entry.slot, group);
  }

  const parts = [];
  try {
    for (const group of groups.values()) {
      if (remesh) {
        parts.push({
          geometry: mergedGeometry(
            group.geometries,
            'The workshop could not merge transformed component geometry.',
          ),
          material: group.material,
          matrix: new THREE.Matrix4(),
        });
      } else {
        for (const geometry of group.geometries) {
          parts.push({ geometry, material: group.material, matrix: new THREE.Matrix4() });
        }
      }
    }
    return parts;
  } catch (error) {
    disposeBuiltGeometries(parts);
    throw error;
  }
}

function attachMetadata(parts, rawStats, components) {
  const stats = Object.freeze({
    ...rawStats,
    drawParts: parts.length,
    components: components.size,
  });
  Object.defineProperty(parts, 'stats', { value: stats, enumerable: false });
  Object.defineProperty(parts, 'components', {
    value: Object.freeze([...components.values()].map(componentMetadata)),
    enumerable: false,
  });
  return Object.freeze(parts);
}

export function createProceduralWorkshopComponentParts(input, {
  preserveComponents = false,
} = {}) {
  const recipe = normalizeProceduralRecipe(input);
  const rawParts = createProceduralWorkshopParts({
    ...recipe,
    remesh: false,
  });
  try {
    const entries = rawParts.map(geometryEntry);
    const components = classifyComponents(entries, recipe);
    const parts = preserveComponents
      ? buildPreviewParts(entries, components, recipe.remesh)
      : buildRuntimeParts(entries, components, recipe.remesh);
    return attachMetadata(parts, rawParts.stats, components);
  } catch (error) {
    disposeModelParts(rawParts);
    throw error;
  }
}
