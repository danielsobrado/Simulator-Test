import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeModelParts } from '../assets/modelParts.js';
import {
  beveledBox,
  leaf,
} from './ProceduralWorkshopGeometry.js';
import {
  applyStoneColor,
  createWorkshopMaterials,
} from './ProceduralWorkshopMaterials.js';
import { createRandom, mixSeed } from './ProceduralRandom.js';
import {
  getCastleWallButtressPositions,
  getCastleWallOpenings,
  getCastleWallTopHeight,
  intersectsCastleOpening,
} from './ProceduralCastleWallLayout.js';

const MAX_STONES = 1800;
const MIN_STONE_WIDTH = 0.26;
const ARCH_BLOCK_HEIGHT = 0.27;
const COPING_HEIGHT = 0.16;
const MATERIAL_SLOTS = Object.freeze([
  'stone',
  'mortar',
  'wood',
  'roof',
  'metal',
  'foliage',
  'recess',
]);

function createGeometrySets() {
  return {
    stone: [],
    mortar: [],
    wood: [],
    roof: [],
    metal: [],
    foliage: [],
    recess: [],
  };
}

function disposeGeometries(geometries) {
  new Set(geometries).forEach((geometry) => geometry.dispose());
}

function disposeGeometrySets(sets) {
  disposeGeometries(MATERIAL_SLOTS.flatMap((slot) => sets[slot]));
}

function addStone(target, recipe, params, stableIndex, heightRatio) {
  if (target.length >= MAX_STONES) {
    throw new Error(`Castle wall generation exceeded ${MAX_STONES} stones.`);
  }
  target.push(applyStoneColor(
    beveledBox({ ...params, detail: recipe.detail }),
    recipe,
    stableIndex,
    heightRatio,
  ));
}

function shouldDropRuinStone(recipe, random, x, y, localTop) {
  if (recipe.shape !== 'tapered') return false;
  const topDistance = localTop - y;
  if (topDistance > 0.75) return false;
  const edgeRatio = Math.abs(x) / Math.max(0.01, recipe.width / 2);
  return random() < 0.12 + edgeRatio * 0.2;
}

function buildWallBody(sets, recipe, openings) {
  const random = createRandom(mixSeed(recipe.seed, 910));
  const courseHeight = 0.5 - recipe.detail * 0.045;
  const courseCount = Math.max(3, Math.ceil(recipe.height / courseHeight));
  const actualCourseHeight = recipe.height / courseCount;
  const targetStoneWidth = 0.92 - recipe.detail * 0.07;
  let stableIndex = 9_100_000;

  for (let course = 0; course < courseCount; course += 1) {
    const y = (course + 0.5) * actualCourseHeight;
    const rowOffset = course % 2 === 0 ? 0 : targetStoneWidth * 0.42;
    let cursor = -recipe.width / 2 - rowOffset;

    while (cursor < recipe.width / 2 - 0.001) {
      const desired = targetStoneWidth * (0.72 + random() * 0.54);
      const stoneWidth = Math.max(MIN_STONE_WIDTH, desired);
      const left = Math.max(-recipe.width / 2, cursor);
      const right = Math.min(recipe.width / 2, cursor + stoneWidth);
      const clippedWidth = right - left;
      const x = (left + right) / 2;
      const localTop = getCastleWallTopHeight(recipe, x);
      const openingHit = openings.some((opening) => intersectsCastleOpening(
        opening,
        x,
        y,
        clippedWidth / 2 + 0.018,
        actualCourseHeight / 2 + 0.012,
      ));

      if (
        clippedWidth >= MIN_STONE_WIDTH * 0.7
        && y <= localTop
        && !openingHit
        && !shouldDropRuinStone(recipe, random, x, y, localTop)
      ) {
        const inset = 0.012 + random() * 0.018;
        addStone(sets.stone, recipe, {
          width: Math.max(0.12, clippedWidth - inset),
          height: Math.max(0.12, actualCourseHeight - inset * 0.7),
          depth: recipe.depth * (0.95 + random() * 0.035),
          position: [
            x,
            y + (random() - 0.5) * 0.025,
            (random() - 0.5) * 0.018,
          ],
          rotation: [
            (random() - 0.5) * 0.006,
            (random() - 0.5) * 0.012,
            (random() - 0.5) * 0.01,
          ],
        }, stableIndex, y / recipe.height);
      }

      cursor += stoneWidth;
      stableIndex += 1;
    }
  }
}

function buildArchFace(sets, recipe, opening, faceSign, stableOffset) {
  const faceZ = faceSign * (recipe.depth / 2 + 0.075);
  const trimDepth = Math.min(0.34, recipe.depth * 0.26);
  const trimWidth = Math.max(0.2, opening.width * 0.105);
  const jambCourses = Math.max(3, Math.ceil(opening.springHeight / ARCH_BLOCK_HEIGHT));
  const jambHeight = opening.springHeight / jambCourses;
  let stableIndex = stableOffset;

  for (let course = 0; course < jambCourses; course += 1) {
    const y = opening.bottom + (course + 0.5) * jambHeight;
    for (const side of [-1, 1]) {
      addStone(sets.stone, recipe, {
        width: trimWidth,
        height: jambHeight * 0.92,
        depth: trimDepth,
        position: [
          opening.centerX + side * (opening.width / 2 + trimWidth * 0.46),
          y,
          faceZ,
        ],
      }, stableIndex, y / recipe.height);
      stableIndex += 1;
    }
  }

  const ringRadius = opening.radius + trimWidth * 0.48;
  const blockCount = Math.max(9, Math.ceil(Math.PI * ringRadius / 0.28));
  for (let block = 0; block < blockCount; block += 1) {
    const angle = (block + 0.5) / blockCount * Math.PI;
    const x = opening.centerX + Math.cos(angle) * ringRadius;
    const y = opening.bottom + opening.springHeight + Math.sin(angle) * ringRadius;
    addStone(sets.stone, recipe, {
      width: Math.PI * ringRadius / blockCount * 0.93,
      height: trimWidth,
      depth: trimDepth,
      position: [x, y, faceZ],
      rotation: [0, 0, angle - Math.PI / 2],
    }, stableIndex, y / recipe.height);
    stableIndex += 1;
  }

  const crownY = opening.bottom + opening.springHeight + opening.radius + trimWidth * 0.45;
  addStone(sets.stone, recipe, {
    width: trimWidth * 1.35,
    height: trimWidth * 1.28,
    depth: trimDepth * 1.06,
    position: [opening.centerX, crownY, faceZ + faceSign * 0.012],
  }, stableIndex, crownY / recipe.height);
}

function buildOpenings(sets, recipe, openings) {
  openings.forEach((opening, index) => {
    buildArchFace(sets, recipe, opening, 1, 9_300_000 + index * 10_000);
    buildArchFace(sets, recipe, opening, -1, 9_400_000 + index * 10_000);
  });
}

function buildButtresses(sets, recipe, openings) {
  const positions = getCastleWallButtressPositions(recipe, openings);
  const courseHeight = 0.42;

  positions.forEach((x, positionIndex) => {
    const top = getCastleWallTopHeight(recipe, x) * (recipe.shape === 'tapered' ? 0.62 : 0.72);
    const courses = Math.max(2, Math.ceil(top / courseHeight));
    const actualHeight = top / courses;

    for (const faceSign of [-1, 1]) {
      for (let course = 0; course < courses; course += 1) {
        const progress = course / Math.max(1, courses - 1);
        const projection = THREE.MathUtils.lerp(recipe.depth * 0.62, recipe.depth * 0.22, progress);
        const width = THREE.MathUtils.lerp(0.62, 0.42, progress);
        const y = (course + 0.5) * actualHeight;
        addStone(sets.stone, recipe, {
          width,
          height: actualHeight * 0.91,
          depth: projection,
          position: [
            x,
            y,
            faceSign * (recipe.depth / 2 + projection / 2 - 0.05),
          ],
          rotation: [0, 0, faceSign * (progress - 0.5) * 0.012],
        }, 9_600_000 + positionIndex * 10_000 + (faceSign > 0 ? 5000 : 0) + course, y / recipe.height);
      }
    }
  });
}

function buildCoping(sets, recipe) {
  const count = Math.max(4, Math.ceil(recipe.width / 0.58));
  const segmentWidth = recipe.width / count;
  const target = recipe.topStyle === 'battlements' ? sets.stone : sets.roof;

  for (let index = 0; index < count; index += 1) {
    const x = -recipe.width / 2 + segmentWidth * (index + 0.5);
    const sampleOffset = Math.min(0.15, segmentWidth * 0.35);
    const leftHeight = getCastleWallTopHeight(recipe, x - sampleOffset);
    const rightHeight = getCastleWallTopHeight(recipe, x + sampleOffset);
    const top = getCastleWallTopHeight(recipe, x);
    const slope = Math.atan2(rightHeight - leftHeight, sampleOffset * 2);
    const geometry = beveledBox({
      width: segmentWidth * 0.96,
      height: COPING_HEIGHT,
      depth: recipe.depth + 0.22,
      position: [x, top + COPING_HEIGHT * 0.4, 0],
      rotation: [0, 0, slope],
      detail: recipe.detail,
      bevelRatio: 0.12,
    });
    if (recipe.topStyle === 'battlements') {
      if (target.length >= MAX_STONES) {
        geometry.dispose();
        throw new Error(`Castle wall generation exceeded ${MAX_STONES} stones.`);
      }
      target.push(applyStoneColor(geometry, recipe, 9_800_000 + index, 1));
    } else {
      target.push(geometry);
    }
  }
}

function buildBattlements(sets, recipe) {
  if (recipe.topStyle !== 'battlements') return;
  const count = Math.max(3, Math.ceil(recipe.width / 1.18));
  const spacing = recipe.width / count;

  for (let index = 0; index < count; index += 1) {
    const x = -recipe.width / 2 + spacing * (index + 0.5);
    const top = getCastleWallTopHeight(recipe, x);
    addStone(sets.stone, recipe, {
      width: Math.min(0.62, spacing * 0.58),
      height: 0.62,
      depth: recipe.depth + 0.16,
      position: [x, top + 0.39, 0],
    }, 9_900_000 + index, 1);
  }
}

function buildIvy(sets, recipe) {
  if (!recipe.ivy) return;
  const random = createRandom(mixSeed(recipe.seed, 970));
  const clusterCount = 24 + recipe.detail * 9;
  const anchorX = (random() < 0.5 ? -1 : 1) * recipe.width * (0.26 + random() * 0.14);

  for (let index = 0; index < clusterCount; index += 1) {
    const progress = index / Math.max(1, clusterCount - 1);
    const x = anchorX + Math.sin(progress * 9 + recipe.seed * 0.01) * recipe.width * 0.07;
    const localTop = getCastleWallTopHeight(recipe, x);
    const y = 0.18 + progress * localTop * (0.58 + random() * 0.18);
    sets.foliage.push(leaf({
      radius: 0.085 + random() * 0.065,
      position: [
        x + (random() - 0.5) * 0.35,
        y,
        recipe.depth / 2 + 0.09 + random() * 0.035,
      ],
      rotation: [random() * 0.7, random() * 0.6, random() * Math.PI],
    }));
  }
}

function disposeMaterial(material) {
  for (const value of Object.values(material)) {
    if (value?.isTexture) value.dispose();
  }
  material.dispose();
}

function createPartsForSet(geometries, material, remesh) {
  if (geometries.length === 0) {
    disposeMaterial(material);
    return [];
  }
  if (!remesh) {
    return geometries.map((geometry) => ({
      geometry,
      material,
      matrix: new THREE.Matrix4(),
    }));
  }

  let merged = null;
  try {
    merged = mergeGeometries(geometries, false);
    if (!merged) {
      throw new Error('The workshop could not merge the castle wall geometry.');
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return [{ geometry: merged, material, matrix: new THREE.Matrix4() }];
  } catch (error) {
    merged?.dispose();
    disposeMaterial(material);
    throw error;
  } finally {
    disposeGeometries(geometries);
  }
}

function disposeUnprocessedSlots(sets, materials, startIndex) {
  for (let index = startIndex; index < MATERIAL_SLOTS.length; index += 1) {
    const slot = MATERIAL_SLOTS[index];
    disposeGeometries(sets[slot]);
    disposeMaterial(materials[slot]);
  }
}

function buildParts(recipe, sets) {
  const materials = createWorkshopMaterials(recipe);
  const parts = [];
  for (let index = 0; index < MATERIAL_SLOTS.length; index += 1) {
    const slot = MATERIAL_SLOTS[index];
    try {
      parts.push(...createPartsForSet(sets[slot], materials[slot], recipe.remesh));
    } catch (error) {
      disposeModelParts(parts);
      disposeUnprocessedSlots(sets, materials, index + 1);
      throw error;
    }
  }
  return parts;
}

function buildStats(recipe, sets) {
  const allGeometry = MATERIAL_SLOTS.flatMap((slot) => sets[slot]);
  const populatedSets = MATERIAL_SLOTS.filter((slot) => sets[slot].length > 0);
  return Object.freeze({
    stones: sets.stone.length,
    features: allGeometry.length - sets.stone.length,
    sourceVertices: allGeometry.reduce(
      (sum, geometry) => sum + geometry.getAttribute('position').count,
      0,
    ),
    drawParts: recipe.remesh ? populatedSets.length : allGeometry.length,
  });
}

function buildCastleWall(recipe) {
  const sets = createGeometrySets();
  try {
    const openings = getCastleWallOpenings(recipe);
    buildWallBody(sets, recipe, openings);
    buildOpenings(sets, recipe, openings);
    buildButtresses(sets, recipe, openings);
    buildCoping(sets, recipe);
    buildBattlements(sets, recipe);
    buildIvy(sets, recipe);
    return sets;
  } catch (error) {
    disposeGeometrySets(sets);
    throw error;
  }
}

export function createProceduralCastleWallParts(recipe) {
  const sets = buildCastleWall(recipe);
  const stats = buildStats(recipe, sets);
  const parts = buildParts(recipe, sets);
  Object.defineProperty(parts, 'stats', { value: stats, enumerable: false });
  return Object.freeze(parts);
}

export function getProceduralCastleWallStats(recipe) {
  const sets = buildCastleWall(recipe);
  const stats = buildStats(recipe, sets);
  disposeGeometrySets(sets);
  return stats;
}
