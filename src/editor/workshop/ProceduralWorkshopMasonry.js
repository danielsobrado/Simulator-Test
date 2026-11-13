import { beveledQuadPrism } from './ProceduralWorkshopGeometry.js';
import { packCourse, stackCourses } from './ProceduralWorkshopCoursePacker.js';

export { stackCourses };
import {
  pillowedBevelRatio,
  stoneJitter,
  stoneQuadCorners,
} from './ProceduralWorkshopIrregularity.js';
import { applyUnitShading } from './ProceduralWorkshopMaterials.js';
import { createRandom, mixSeed } from './ProceduralRandom.js';

/**
 * Shared coursed-masonry primitives.
 *
 * Every workshop archetype that lays field stone — castle walls, towers, the
 * manor plinth and the village houses' stone storeys — goes through these, so
 * per-unit shaping stays inside the course band the packer assigned and
 * structural dressings keep their reduced jitter (04-…md §6, §8, §19).
 */

/** Smallest field stone a packed course may emit, before mortar inset. */
export const MIN_COURSE_STONE_WIDTH = 0.28;

export function openingHalfWidth(opening, y) {
  const localY = y - opening.bottom;
  if (localY < 0 || localY > opening.springHeight + opening.radius) return 0;
  if (opening.rectangular) return opening.width / 2;
  if (localY <= opening.springHeight) return opening.width / 2;
  const archY = localY - opening.springHeight;
  return Math.sqrt(Math.max(0, opening.radius ** 2 - archY ** 2));
}

export function isInsideOpening(opening, x, y, stoneHalfWidth = 0) {
  const halfWidth = openingHalfWidth(opening, y);
  return halfWidth > 0 && Math.abs(x - opening.centerX) < halfWidth + stoneHalfWidth * 0.35;
}

/** Returns the shaped parameters so callers can record surface relief. */
export function addStone(target, recipe, params, stableIndex, heightRatio, category = 'field') {
  const shaped = stoneJitter(recipe, params, stableIndex, category);
  const corners = stoneQuadCorners(recipe, params, shaped, stableIndex, category);
  const bevelRatio = pillowedBevelRatio(recipe, params, shaped, stableIndex, category);
  target.push(applyUnitShading(
    beveledQuadPrism({
      ...params,
      ...shaped,
      corners,
      bevelRatio,
      detail: recipe.detail,
    }),
    recipe,
    {
      stableIndex,
      heightRatio,
      protrusion: shaped.protrusion,
      depth: shaped.depth,
    },
  ));
  return shaped;
}

/** A run narrower than this beside an opening is left as void rather than a sliver stone. */
const MIN_RUN_WIDTH = MIN_COURSE_STONE_WIDTH * 0.5;

/**
 * The stretches of one course left between its openings, along the wall.
 *
 * A course whose centre line crosses an opening stops exactly at its reveal.
 * Packing the full span and dropping stones whose centre fell inside an
 * opening left every stone straddling a jamb half in the void, so window and
 * door edges read as ragged steps.
 */
function courseRuns(width, y, openings) {
  const half = width / 2;
  const cuts = openings
    .map((opening) => {
      const halfWidth = openingHalfWidth(opening, y);
      return halfWidth > 0 ? [opening.centerX - halfWidth, opening.centerX + halfWidth] : null;
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  const runs = [];
  let cursor = -half;
  for (const [start, end] of cuts) {
    if (start > cursor) runs.push([cursor, Math.min(start, half)]);
    cursor = Math.max(cursor, end);
    if (cursor >= half) break;
  }
  if (cursor < half) runs.push([cursor, half]);
  return runs.filter(([start, end]) => end - start >= MIN_RUN_WIDTH);
}

/**
 * Stack uneven courses and boost the ground footing course so the wall rests on
 * broader, heavier base boulders while still filling `height` to the millimetre.
 */
function stackRubbleCourses(height, targetHeight, random, footingScale = 1.24) {
  const raw = stackCourses(height, targetHeight, random);
  if (raw.length < 2 || footingScale === 1) return raw;
  const weights = raw.map((course, index) => course.height * (index === 0 ? footingScale : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let bottom = 0;
  return weights.map((weight) => {
    const courseHeight = (weight / total) * height;
    const course = { y: bottom + courseHeight / 2, height: courseHeight };
    bottom += courseHeight;
    return course;
  });
}

/**
 * Deterministic bed-line wave and head-joint lean so adjacent stones in a
 * course share undulating horizontal beds and leaning vertical joints instead
 * of a rigid rectangular grid.
 */
function createCourseWave(seed, courseCount, amplitude = 0.022) {
  const bedWave = (courseIndex, x) => {
    if (courseIndex <= 0 || courseIndex >= courseCount) return 0;
    const h0 = mixSeed(seed ^ 0x3c6ef372, courseIndex * 11 + 1);
    const h1 = mixSeed(seed ^ 0xa54ff53a, courseIndex * 11 + 2);
    const phase0 = ((h0 & 255) / 255) * Math.PI * 2;
    const phase1 = ((h1 & 255) / 255) * Math.PI * 2;
    const freq0 = 0.72 + (((h0 >>> 8) & 255) / 255) * 0.55;
    const freq1 = 1.45 + (((h1 >>> 8) & 255) / 255) * 0.85;
    return amplitude * (0.62 * Math.sin(x * freq0 + phase0) + 0.38 * Math.sin(x * freq1 + phase1));
  };
  const headLean = (courseIndex, x) => {
    const key = Math.round(x * 200) ^ Math.imul(courseIndex + 1, 0x9e3779b1);
    const hash = mixSeed(seed ^ 0x510e527f, key);
    return ((((hash >>> 8) & 255) / 255) - 0.5) * 2 * 0.032;
  };
  return { bedWave, headLean };
}

/**
 * Lay packed field-stone courses along one planar wall.
 *
 * The wall runs along its local X, centred on (`centerX`, `centerZ`) and turned
 * by `yaw`; courses start at y = 0. `openings` are in the same along-wall
 * coordinate: a course crossing one is packed as separate runs that stop at
 * its reveal, so the opening is a real, clean-edged void rather than a panel
 * over solid masonry.
 */
export function buildWallCourses(recipe, {
  width = recipe.width,
  depth = recipe.depth,
  height = recipe.height,
  centerX = 0,
  centerZ = 0,
  openings = [],
  seedOffset = 0,
  yaw = 0,
  relief = null,
  rubble = recipe?.archetype === 'house',
} = {}) {
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  const geometries = [];
  const baseCourseHeight = rubble
    ? 0.35 - recipe.detail * 0.024
    : 0.46 - recipe.detail * 0.04;
  const baseStoneWidth = rubble
    ? 0.56 - recipe.detail * 0.045
    : 0.84 - recipe.detail * 0.07;
  const minStoneWidth = rubble ? 0.22 : MIN_COURSE_STONE_WIDTH;
  const courses = stackRubbleCourses(height, baseCourseHeight, random, rubble ? 1.28 : 1.16);
  const { bedWave, headLean } = createCourseWave(
    mixSeed(recipe.seed, seedOffset ^ 0x7f4a),
    courses.length,
    rubble ? 0.024 : 0.016,
  );
  const splitChance = rubble ? 0.32 : 0.18;
  let stableIndex = seedOffset * 10000;

  // Joints of the course below, so this course can break bond against them
  // (04-…md §5) instead of faking a running bond by shrinking one stone.
  let previousJoints = [];

  for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
    const { y: courseCenterY, height: actualCourseHeight } = courses[courseIndex];
    const footing = courseIndex === 0;
    const targetStoneWidth = baseStoneWidth * (footing ? 1.26 : (0.86 + random() * 0.28));
    const stones = [];
    const joints = [];
    for (const [start, end] of courseRuns(width, courseCenterY, openings)) {
      const middle = (start + end) / 2;
      const run = packCourse({
        span: end - start,
        targetWidth: targetStoneWidth,
        minWidth: minStoneWidth,
        random,
        forbiddenJoints: previousJoints
          .filter((joint) => joint > start && joint < end)
          .map((joint) => joint - middle),
      });
      for (const stone of run.stones) stones.push({ center: stone.center + middle, width: stone.width });
      for (const joint of run.joints) joints.push(joint + middle);
    }
    previousJoints = joints;

    if (stones.length > 512) {
      throw new Error('Workshop stone packing exceeded its safety budget.');
    }

    const emitCell = (cellCenterX, cellWidth, cellBottom, cellTop, tiltL, tiltR, subCategory = rubble ? 'rubble' : 'field') => {
      const inset = 0.015 + random() * 0.018;
      const w = Math.max(0.11, cellWidth - inset);
      const h = Math.max(0.10, (cellTop - cellBottom) - inset * 0.78);
      const cellY = (cellBottom + cellTop) / 2;
      const x0 = cellCenterX - cellWidth / 2;
      const x1 = cellCenterX + cellWidth / 2;
      const dropL = bedWave(courseIndex, x0) * 0.55;
      const dropR = bedWave(courseIndex, x1) * 0.55;
      const liftL = bedWave(courseIndex + 1, x0) * 0.55;
      const liftR = bedWave(courseIndex + 1, x1) * 0.55;
      const halfW = w / 2;
      const halfH = h / 2;
      const corners = [
        [-halfW - tiltL * 0.45, -halfH + dropL],
        [halfW - tiltR * 0.45, -halfH + dropR],
        [halfW + tiltR * 0.45, halfH + liftR],
        [-halfW + tiltL * 0.45, halfH + liftL],
      ];
      const shaped = addStone(geometries, recipe, {
        width: w,
        height: h,
        depth: depth * (footing ? 1.02 + random() * 0.04 : 0.94 + random() * 0.07),
        corners,
        position: [
          centerX + Math.cos(yaw) * cellCenterX,
          cellY + (random() - 0.5) * 0.016,
          centerZ - Math.sin(yaw) * cellCenterX,
        ],
        rotation: [0, yaw + (random() - 0.5) * 0.016, 0],
      }, stableIndex, cellY / height, footing ? 'boulder' : subCategory);
      relief?.record(cellCenterX, cellY, shaped.protrusion);
      stableIndex += 1;
    };

    const courseBottom = courseCenterY - actualCourseHeight / 2;
    const courseTop = courseCenterY + actualCourseHeight / 2;

    for (const stone of stones) {
      const x0 = stone.center - stone.width / 2;
      const x1 = stone.center + stone.width / 2;
      const tiltL = headLean(courseIndex, x0);
      const tiltR = headLean(courseIndex, x1);
      // In taller courses, split a fraction of stones horizontally into two
      // thinner stacked bricks (or a jumper + sneck pair) so courses break
      // out of continuous straight horizontal rows.
      const canSplitHoriz = !footing
        && actualCourseHeight >= 0.27
        && stone.width >= 0.34
        && random() < splitChance;
      if (canSplitHoriz) {
        const splitFraction = 0.38 + random() * 0.24;
        const splitY = courseBottom + actualCourseHeight * splitFraction;
        emitCell(stone.center, stone.width, courseBottom, splitY, tiltL * 0.6, tiltR * 0.6);
        if (stone.width >= 0.56 && random() < 0.55) {
          const vSplit = 0.36 + random() * 0.28;
          const wLeft = stone.width * vSplit;
          const wRight = stone.width - wLeft;
          const midTilt = headLean(courseIndex + 7, x0 + wLeft);
          emitCell(x0 + wLeft / 2, wLeft, splitY, courseTop, tiltL * 0.5, midTilt * 0.5);
          emitCell(x1 - wRight / 2, wRight, splitY, courseTop, midTilt * 0.5, tiltR * 0.5);
        } else {
          emitCell(stone.center, stone.width, splitY, courseTop, tiltL * 0.6, tiltR * 0.6);
        }
      } else {
        emitCell(stone.center, stone.width, courseBottom, courseTop, tiltL, tiltR);
      }
    }
  }
  return geometries;
}
