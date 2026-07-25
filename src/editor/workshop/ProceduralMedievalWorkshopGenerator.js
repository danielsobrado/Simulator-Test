import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeModelParts } from '../assets/modelParts.js';
import { normalizeProceduralRecipe } from './ProceduralAssetStore.js';
import { createProceduralMedievalParts } from './ProceduralMedievalGenerator.js';
import { harmonizeVertexColors } from './ProceduralWorkshopGeometry.js';
import { estimateConeShingles, shinglesEnabled } from './ProceduralWorkshopShingles.js';

const MAX_SOURCE_PARTS = 7_500;
const MAX_STONE_PARTS = 6_500;
const MAX_SOURCE_VERTICES = 2_500_000;
const PASSAGE_INSET = 0.045;
const IDENTITY_MATRIX = new THREE.Matrix4();

function materialSlot(material) {
  return material?.userData?.workshopSlot ?? 'unknown';
}

function disposeMaterial(material) {
  for (const value of Object.values(material ?? {})) {
    if (value?.isTexture) value.dispose();
  }
  material?.dispose?.();
}

function disposePartGeometries(parts) {
  new Set(parts.map((part) => part.geometry)).forEach((geometry) => geometry.dispose());
}

function partBounds(part) {
  part.geometry.computeBoundingBox();
  const bounds = part.geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) {
    throw new Error('The workshop generated a medieval part without valid bounds.');
  }
  if (part.matrix && !part.matrix.equals(IDENTITY_MATRIX)) bounds.applyMatrix4(part.matrix);
  return bounds;
}

function wallCourseEstimate(width, height, detail) {
  const courseHeight = 0.5 - detail * 0.045;
  const courses = Math.max(2, Math.ceil(height / courseHeight));
  const targetWidth = 0.94 - detail * 0.08;
  const minimumWidth = Math.max(0.28, targetWidth * 0.72);
  return courses * Math.ceil(width / minimumWidth);
}

function towerBodyEstimate(radius, height, detail) {
  const courseHeight = 0.5 - detail * 0.04;
  const courses = Math.max(3, Math.ceil(height / courseHeight));
  const blockWidth = 0.82 - detail * 0.06;
  const blocks = Math.max(12, Math.ceil(Math.PI * 2 * radius / blockWidth));
  return courses * blocks;
}

function towerTopEstimate(radius, topStyle) {
  const circumference = Math.PI * 2 * radius;
  const machicolations = Math.max(12, Math.ceil(circumference / 0.78));
  if (topStyle !== 'battlements') return machicolations;
  const merlons = Math.max(10, Math.ceil(circumference / 1.05));
  return machicolations + merlons * 3;
}

function estimatedStoneParts(recipe) {
  if (recipe.archetype === 'wall') {
    return wallCourseEstimate(recipe.width, recipe.height, recipe.detail)
      + Math.ceil(recipe.width / 0.7)
      + Math.ceil(recipe.width / 1.25);
  }
  if (recipe.archetype === 'tower') {
    const wallDepth = Math.max(0.5, recipe.depth * 0.58);
    const radius = Math.max(1, recipe.width / 2 - wallDepth * 0.22);
    return towerBodyEstimate(radius, recipe.height, recipe.detail)
      + towerTopEstimate(radius, recipe.topStyle);
  }
  if (recipe.archetype === 'square-tower') {
    const depth = Math.max(2.8, Math.min(recipe.width * 0.82, recipe.depth * 2.3));
    const walls = wallCourseEstimate(recipe.width, recipe.height, recipe.detail) * 2
      + wallCourseEstimate(depth, recipe.height, recipe.detail) * 2;
    return walls + Math.ceil((recipe.width + depth) * 4 / 0.7);
  }
  if (recipe.archetype === 'gatehouse') {
    const towerRadius = Math.max(1.05, recipe.depth * 0.72);
    const towerHeight = recipe.height * 1.16;
    const tower = towerBodyEstimate(towerRadius, towerHeight, recipe.detail)
      + towerTopEstimate(towerRadius, recipe.topStyle);
    return wallCourseEstimate(recipe.width, recipe.height, recipe.detail) + tower * 2;
  }

  const depth = Math.max(3.2, Math.min(7.5, recipe.depth * 2.2));
  const roofHeight = Math.min(5.4, Math.max(0.85, depth * 0.47 * recipe.roofScale));
  return wallCourseEstimate(recipe.width, 0.62, recipe.detail)
    + (recipe.shape === 'classic' ? 0 : Math.ceil(roofHeight / 0.38) * 4);
}

/**
 * Conservative roof-tile estimate.
 *
 * Deliberately does not mirror each archetype's internal roof formulas; those
 * would drift out of step with the generator. It bounds the count from the
 * recipe's own outer limits instead, so it over-estimates rather than letting an
 * over-budget roof through, and doubles the figure to allow for an attached
 * tower roof. The per-roof ceiling is enforced by `MAX_SHINGLES` at generation
 * time, and tile size adapts before that ceiling is reached.
 */
function estimatedRoofTileParts(recipe) {
  if (!shinglesEnabled(recipe)) return 0;
  const radius = recipe.width / 2 + recipe.roofOverhang;
  const height = Math.min(5.4, Math.max(0.85, recipe.depth * 2.2 * 0.47 * recipe.roofScale));
  return estimateConeShingles(recipe, { radius, height }) * 2;
}

function preflightComplexity(recipe) {
  const estimate = estimatedStoneParts(recipe) + estimatedRoofTileParts(recipe);
  if (estimate > MAX_STONE_PARTS) {
    throw new Error(
      `This medieval object would require about ${estimate} masonry parts; reduce its width, depth, height, or detail.`,
    );
  }
}

function openingHalfWidth(opening, y) {
  const localY = y - opening.bottom;
  if (localY < 0 || localY > opening.springHeight + opening.radius) return 0;
  if (localY <= opening.springHeight) return opening.width / 2;
  const archY = localY - opening.springHeight;
  return Math.sqrt(Math.max(0, opening.radius ** 2 - archY ** 2));
}

function openingIntersectsBounds(opening, bounds) {
  const openingTop = opening.bottom + opening.springHeight + opening.radius;
  const overlapBottom = Math.max(bounds.min.y, opening.bottom);
  const overlapTop = Math.min(bounds.max.y, openingTop);
  if (overlapBottom >= overlapTop) return false;

  const springY = opening.bottom + opening.springHeight;
  const widestY = overlapBottom <= springY ? springY : overlapBottom;
  const halfWidth = Math.max(0, openingHalfWidth(opening, widestY) - PASSAGE_INSET);
  if (halfWidth <= 0) return false;
  if (
    bounds.max.x <= opening.centerX - halfWidth
    || bounds.min.x >= opening.centerX + halfWidth
  ) {
    return false;
  }
  if (opening.frontZ === undefined) return true;
  return !(
    bounds.max.z < opening.frontZ - opening.frontTolerance
    || bounds.min.z > opening.frontZ + opening.frontTolerance
  );
}

function classicWallOpenings(recipe) {
  if (!recipe.windows || recipe.height < 3.4) return [];
  return [-1, 1].map((side) => ({
    centerX: side * recipe.width * 0.23,
    bottom: recipe.height * 0.43,
    width: 0.44,
    springHeight: 0.64,
    radius: 0.22,
    minimumStructuralDepth: Math.max(0.38, recipe.depth * 0.62),
  }));
}

function roundTowerOpenings(recipe, {
  centerX = 0,
  centerZ = 0,
  radius,
  wallDepth,
  height,
  includeDoor,
}) {
  if (!recipe.windows) return [];
  const openings = [];
  if (includeDoor) {
    const width = Math.min(1.45, recipe.width * 0.26);
    openings.push({
      centerX,
      bottom: 0,
      width,
      springHeight: Math.min(1.8, height * 0.3),
      radius: width / 2,
    });
  }
  if (height >= 3.6) {
    openings.push({
      centerX,
      bottom: height * 0.52,
      width: 0.55,
      springHeight: 0.72,
      radius: 0.275,
    });
  }
  return openings.map((opening) => ({
    ...opening,
    frontZ: centerZ + radius,
    frontTolerance: Math.max(0.42, wallDepth * 0.72),
    minimumStructuralDepth: Math.max(0.38, wallDepth * 0.62),
  }));
}

function squareTowerOpenings(recipe) {
  if (!recipe.windows) return [];
  const depth = Math.max(2.8, Math.min(recipe.width * 0.82, recipe.depth * 2.3));
  const wallDepth = Math.max(0.46, Math.min(0.82, recipe.depth * 0.34));
  const doorWidth = Math.min(1.45, recipe.width * 0.27);
  const openings = [{
    centerX: 0,
    bottom: 0,
    width: doorWidth,
    springHeight: Math.min(1.85, recipe.height * 0.28),
    radius: Math.min(0.725, recipe.width * 0.135),
  }];
  if (recipe.height >= 4.4) {
    openings.push({
      centerX: 0,
      bottom: recipe.height * 0.54,
      width: 0.58,
      springHeight: 0.78,
      radius: 0.29,
    });
  }
  return openings.map((opening) => ({
    ...opening,
    frontZ: depth / 2,
    frontTolerance: Math.max(0.4, wallDepth * 0.75),
    minimumStructuralDepth: Math.max(0.38, wallDepth * 0.62),
  }));
}

function gatehouseOpenings(recipe) {
  if (!recipe.windows) return [];
  const gateWidth = Math.min(recipe.width * 0.32, 2.8);
  const openings = [{
    centerX: 0,
    bottom: 0,
    width: gateWidth,
    springHeight: Math.min(2.15, recipe.height * 0.46),
    radius: gateWidth / 2,
    minimumStructuralDepth: Math.max(0.38, recipe.depth * 0.62),
  }];
  const wallDepth = Math.max(0.48, recipe.depth * 0.55);
  const radius = Math.max(1.05, recipe.depth * 0.72);
  const height = recipe.height * 1.16;
  for (const side of [-1, 1]) {
    openings.push(...roundTowerOpenings(recipe, {
      centerX: side * recipe.width * 0.39,
      centerZ: 0,
      radius,
      wallDepth,
      height,
      includeDoor: false,
    }));
  }
  return openings;
}

function structuralOpenings(recipe) {
  if (recipe.archetype === 'wall') return classicWallOpenings(recipe);
  if (recipe.archetype === 'tower') {
    const wallDepth = Math.max(0.5, recipe.depth * 0.58);
    const radius = Math.max(1, recipe.width / 2 - wallDepth * 0.22);
    return roundTowerOpenings(recipe, {
      radius,
      wallDepth,
      height: recipe.height,
      includeDoor: true,
    });
  }
  if (recipe.archetype === 'square-tower') return squareTowerOpenings(recipe);
  if (recipe.archetype === 'gatehouse') return gatehouseOpenings(recipe);
  return [];
}

function obstructsPassage(part, openings) {
  if (materialSlot(part.material) !== 'stone' || openings.length === 0) return false;
  const bounds = partBounds(part);
  const size = bounds.getSize(new THREE.Vector3());
  return openings.some((opening) => (
    size.z >= opening.minimumStructuralDepth
    && openingIntersectsBounds(opening, bounds)
  ));
}

function validateSourceParts(parts) {
  if (parts.length > MAX_SOURCE_PARTS) {
    throw new Error(`The workshop generated more than ${MAX_SOURCE_PARTS} source parts.`);
  }
  let stones = 0;
  let vertices = 0;
  for (const part of parts) {
    if (materialSlot(part.material) === 'stone') stones += 1;
    vertices += part.geometry.getAttribute('position')?.count ?? 0;
  }
  if (stones > MAX_STONE_PARTS) {
    throw new Error(`The workshop generated more than ${MAX_STONE_PARTS} masonry parts.`);
  }
  if (vertices > MAX_SOURCE_VERTICES) {
    throw new Error(`The workshop generated more than ${MAX_SOURCE_VERTICES} source vertices.`);
  }
}

function buildStats(parts, drawParts) {
  let stones = 0;
  let sourceVertices = 0;
  for (const part of parts) {
    if (materialSlot(part.material) === 'stone') stones += 1;
    sourceVertices += part.geometry.getAttribute('position')?.count ?? 0;
  }
  return Object.freeze({
    stones,
    features: parts.length - stones,
    sourceVertices,
    drawParts,
  });
}

function groupPartsByMaterial(parts) {
  const groups = new Map();
  for (const part of parts) {
    const group = groups.get(part.material) ?? [];
    group.push(part);
    groups.set(part.material, group);
  }
  return groups;
}

function cloneTransformedGeometry(part) {
  const geometry = part.geometry.clone();
  if (part.matrix && !part.matrix.equals(IDENTITY_MATRIX)) geometry.applyMatrix4(part.matrix);
  return geometry;
}

function mergeParts(parts) {
  const mergedParts = [];
  try {
    for (const [material, group] of groupPartsByMaterial(parts)) {
      const geometries = group.map(cloneTransformedGeometry);
      harmonizeVertexColors(geometries, { required: material.vertexColors === true });
      let merged = null;
      try {
        merged = mergeGeometries(geometries, false);
        if (!merged) {
          throw new Error('The workshop could not merge the validated medieval geometry.');
        }
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
      } catch (error) {
        merged?.dispose();
        throw error;
      } finally {
        geometries.forEach((geometry) => geometry.dispose());
      }
      mergedParts.push({ geometry: merged, material, matrix: new THREE.Matrix4() });
    }
    return mergedParts;
  } catch (error) {
    disposePartGeometries(mergedParts);
    throw error;
  }
}

function disposeUnusedMaterials(rawParts, keptParts) {
  const used = new Set(keptParts.map((part) => part.material));
  const all = new Set(rawParts.map((part) => part.material));
  for (const material of all) {
    if (!used.has(material)) disposeMaterial(material);
  }
}

function partitionParts(rawParts, openings) {
  const kept = [];
  const removed = [];
  for (const part of rawParts) {
    (obstructsPassage(part, openings) ? removed : kept).push(part);
  }
  return { kept, removed };
}

function attachStats(parts, stats) {
  Object.defineProperty(parts, 'stats', { value: stats, enumerable: false });
  return Object.freeze(parts);
}

export function createProceduralMedievalWorkshopParts(input) {
  const recipe = normalizeProceduralRecipe(input);
  preflightComplexity(recipe);
  const rawParts = createProceduralMedievalParts({ ...recipe, remesh: false });
  try {
    validateSourceParts(rawParts);
    const { kept, removed } = partitionParts(rawParts, structuralOpenings(recipe));
    const drawParts = recipe.remesh
      ? new Set(kept.map((part) => part.material)).size
      : kept.length;
    const stats = buildStats(kept, drawParts);

    if (!recipe.remesh) {
      disposePartGeometries(removed);
      disposeUnusedMaterials(rawParts, kept);
      return attachStats(kept, stats);
    }

    const mergedParts = mergeParts(kept);
    disposePartGeometries(rawParts);
    disposeUnusedMaterials(rawParts, kept);
    return attachStats(mergedParts, stats);
  } catch (error) {
    disposeModelParts(rawParts);
    throw error;
  }
}

export function getProceduralMedievalWorkshopStats(input) {
  const recipe = normalizeProceduralRecipe(input);
  const parts = createProceduralMedievalWorkshopParts({ ...recipe, remesh: false });
  try {
    const drawParts = recipe.remesh
      ? new Set(parts.map((part) => part.material)).size
      : parts.length;
    return Object.freeze({ ...parts.stats, drawParts });
  } finally {
    disposeModelParts(parts);
  }
}
