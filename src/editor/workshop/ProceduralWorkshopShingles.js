import { beveledBox, transformGeometry } from './ProceduralWorkshopGeometry.js';
import { stoneJitter } from './ProceduralWorkshopIrregularity.js';
import { applyUnitShading } from './ProceduralWorkshopMaterials.js';

/**
 * Individual overlapping roof tiles.
 *
 * Before 2026-07-25 every roof in the workshop was a smooth cone or a pair of
 * flat slabs, and tile courses existed only as seams painted into
 * `roofBumpTexture`. 15-…md line 112 called these "raised roof-tile seams".
 * That reads as a textured surface, never as stacked tiles.
 *
 * These builders lay real solids over the existing roof deck. The deck is left
 * in place and tiles sit just outside it, so jitter can never open a hole
 * through the roof and there is no z-fighting.
 *
 * Cost is bounded two ways: solids are emitted only at Ultra detail (see
 * `shinglesEnabled`), and `MAX_SHINGLES` caps a single roof.
 */

/** Individual tile solids are Ultra-only; lower detail keeps the deck plus texture. */
export const SHINGLE_DETAIL_THRESHOLD = 3;

/**
 * Per-roof tile ceiling.
 *
 * Deliberately separate from the castle wall's `MAX_STONES` budget so a shingled
 * roof cannot starve the masonry it sits on.
 */
export const MAX_SHINGLES = 1400;

/** Tiles overlap the course below by this fraction of their length. */
const COURSE_OVERLAP = 0.45;

/** Lateral overlap, so a jittered tile cannot expose a vertical gap. */
const LATERAL_OVERLAP = 1.06;

const THICKNESS = 0.06;
const BEVEL_RATIO = 0.12;

/** Clearance between deck and tile underside. */
const DECK_CLEARANCE = 0.004;

/** How far the eaves course oversails, as a fraction of tile length. */
const EAVES_OVERSAIL = 0.35;

/** Maximum upward tilt of a tile's free edge, in radians, at full irregularity. */
const MAX_EDGE_KICK = 0.09;

export function shinglesEnabled(recipe) {
  return recipe.detail >= SHINGLE_DETAIL_THRESHOLD;
}

function targetCourseLength(detail) {
  return 0.16 + (3 - detail) * 0.05;
}

function targetTileWidth(detail) {
  return 0.19 + (3 - detail) * 0.04;
}

/**
 * Rotate the local +Y axis by an XYZ-order Euler triple.
 *
 * Second column of `Matrix4.makeRotationFromEuler` for order 'XYZ'. A tile's
 * surface normal is its local +Y, so this is what lifts it clear of the deck.
 */
function offsetAlongLocalY(rotation, distance) {
  const sinX = Math.sin(rotation[0]);
  const cosX = Math.cos(rotation[0]);
  const sinY = Math.sin(rotation[1]);
  const cosY = Math.cos(rotation[1]);
  const sinZ = Math.sin(rotation[2]);
  const cosZ = Math.cos(rotation[2]);
  return [
    distance * -cosY * sinZ,
    distance * (cosX * cosZ - sinX * sinZ * sinY),
    distance * (sinX * cosZ + cosX * sinZ * sinY),
  ];
}

/**
 * Row plan shared by cones and planar slopes.
 *
 * Rows advance by `courseStep` but each tile is longer than the step, which is
 * what produces the overlap. Returned `centre` is the fraction up the slope of
 * the tile's midpoint.
 */
function planCourses(slantLength, detail) {
  const rows = Math.max(4, Math.round(slantLength / targetCourseLength(detail)));
  const courseStep = slantLength / rows;
  const tileLength = courseStep / (1 - COURSE_OVERLAP);
  const courses = [];
  for (let row = 0; row < rows; row += 1) {
    const low = (row * courseStep) / slantLength;
    const oversail = row === 0 ? tileLength * EAVES_OVERSAIL : 0;
    courses.push({
      row,
      low,
      centre: low + (tileLength / 2 - oversail) / slantLength,
      tileLength: tileLength + oversail,
      isEaves: row === 0,
    });
  }
  return { rows, courses, tileLength };
}

function tileGeometry(recipe, {
  width,
  length,
  pitch,
  position,
  stableIndex,
  kickSign,
  heightRatio,
}) {
  const amount = recipe.irregularity ?? 0;
  // Kick the tile's free edge up off the deck. Reducing the pitch raises the
  // down-slope end, so the sign follows which way the slope runs.
  const kick = -kickSign * MAX_EDGE_KICK * amount
    * (((stableIndex * 2654435761) >>> 0) % 1000) / 1000;
  const baseRotation = [pitch + kick, 0, 0];

  const shaped = stoneJitter(recipe, {
    width,
    height: THICKNESS,
    depth: length,
    position,
    rotation: baseRotation,
    bevelRatio: BEVEL_RATIO,
  }, stableIndex, 'shingle', { protrusionAxis: 'y' });

  // Sit clear of the deck along the tile's own normal.
  const lift = offsetAlongLocalY(
    shaped.rotation,
    THICKNESS * 0.5 + DECK_CLEARANCE,
  );
  const lifted = [
    shaped.position[0] + lift[0],
    shaped.position[1] + lift[1],
    shaped.position[2] + lift[2],
  ];

  return applyUnitShading(
    beveledBox({
      width: shaped.width,
      height: shaped.height,
      depth: shaped.depth,
      position: lifted,
      rotation: shaped.rotation,
      bevelRatio: BEVEL_RATIO,
      skew: shaped.skew,
      detail: recipe.detail,
    }),
    recipe,
    {
      stableIndex,
      heightRatio,
      family: 'roof',
      protrusion: shaped.protrusion,
      depth: shaped.depth,
    },
  );
}

function assertBudget(count) {
  if (count > MAX_SHINGLES) {
    throw new Error(`Roof tile generation exceeded ${MAX_SHINGLES} tiles.`);
  }
}

/**
 * Tile a conical or pyramidal roof.
 *
 * Rows thin out toward the apex because each row's circumference shrinks, which
 * keeps tile width roughly constant up the roof instead of fanning out.
 *
 * Tiles are built in a pre-yaw frame and then rotated into place, so the pitch
 * is applied in the tile's own frame. Composing two transforms this way yields
 * Ry * Rx, which a single XYZ Euler triple cannot express.
 */
export function shingledConeGeometries(recipe, {
  radius,
  height,
  baseY,
  centerX = 0,
  centerZ = 0,
  seedOffset,
  sides = 0,
}) {
  if (!shinglesEnabled(recipe) || radius <= 0 || height <= 0) return [];
  const slant = Math.hypot(radius, height);
  const pitch = Math.atan2(height, radius);
  const { courses } = planCourses(slant, recipe.detail);
  const geometries = [];
  let stableIndex = seedOffset * 10_000;

  for (const course of courses) {
    const rowRadius = Math.max(0.05, radius * (1 - course.centre));
    const circumference = Math.PI * 2 * rowRadius;
    const columns = Math.max(3, Math.round(circumference / targetTileWidth(recipe.detail)));
    const width = (circumference / columns) * LATERAL_OVERLAP;
    // Half-tile stagger, the running bond that stops joints lining up.
    const phase = (course.row % 2) * (Math.PI / columns);
    const y = height * course.centre;

    for (let column = 0; column < columns; column += 1) {
      const yaw = phase + (column / columns) * Math.PI * 2;
      const tile = tileGeometry(recipe, {
        width,
        length: course.tileLength,
        pitch,
        position: [0, y, rowRadius],
        stableIndex,
        kickSign: 1,
        heightRatio: course.centre,
      });
      // Pyramids keep their tiles on the flat facets rather than following a
      // circle, so a square tower roof still reads as four planes.
      const snappedYaw = sides > 0
        ? Math.round(yaw / (Math.PI * 2 / sides)) * (Math.PI * 2 / sides)
          + (yaw - Math.round(yaw / (Math.PI * 2 / sides)) * (Math.PI * 2 / sides))
        : yaw;
      geometries.push(transformGeometry(tile, {
        rotation: [0, snappedYaw, 0],
        position: [centerX, baseY, centerZ],
      }));
      stableIndex += 1;
      assertBudget(geometries.length);
    }
  }
  return geometries;
}

/**
 * Tile one planar roof pitch.
 *
 * `side` matches the convention in `wallRoofPlanes`: +1 is the slope facing +z,
 * -1 the slope facing -z, and the pitch is `side * angle` for both so the
 * surface normal comes out upward either way.
 */
export function shingledSlopeGeometries(recipe, {
  width,
  height,
  roofDepth,
  baseY,
  side,
  centerX = 0,
  centerZ = 0,
  seedOffset,
}) {
  if (!shinglesEnabled(recipe) || width <= 0 || height <= 0) return [];
  const run = roofDepth / 2;
  const slant = Math.hypot(run, height);
  const angle = Math.atan2(height, run);
  const pitch = side * angle;
  const { courses } = planCourses(slant, recipe.detail);
  const columns = Math.max(3, Math.round(width / targetTileWidth(recipe.detail)));
  const tileWidth = (width / columns) * LATERAL_OVERLAP;
  const geometries = [];
  let stableIndex = seedOffset * 10_000;

  for (const course of courses) {
    const y = baseY + height * course.centre;
    const z = centerZ + side * run * (1 - course.centre);
    const stagger = (course.row % 2) * (width / columns) * 0.5;

    for (let column = 0; column < columns; column += 1) {
      const x = centerX - width / 2 + (width / columns) * (column + 0.5) + stagger;
      geometries.push(tileGeometry(recipe, {
        width: tileWidth,
        length: course.tileLength,
        pitch,
        position: [x, y, z],
        stableIndex,
        kickSign: side,
        heightRatio: course.centre,
      }));
      stableIndex += 1;
      assertBudget(geometries.length);
    }
  }
  return geometries;
}

/**
 * Analytic tile count, for the generator preflight.
 *
 * Must stay in step with `planCourses` and the column maths above, so the
 * preflight rejects an over-budget roof before any geometry is allocated.
 */
export function estimateConeShingles(recipe, { radius, height }) {
  if (!shinglesEnabled(recipe) || radius <= 0 || height <= 0) return 0;
  const slant = Math.hypot(radius, height);
  const { courses } = planCourses(slant, recipe.detail);
  let total = 0;
  for (const course of courses) {
    const rowRadius = Math.max(0.05, radius * (1 - course.centre));
    total += Math.max(
      3,
      Math.round((Math.PI * 2 * rowRadius) / targetTileWidth(recipe.detail)),
    );
  }
  return total;
}

export function estimateSlopeShingles(recipe, { width, height, roofDepth }) {
  if (!shinglesEnabled(recipe) || width <= 0 || height <= 0) return 0;
  const slant = Math.hypot(roofDepth / 2, height);
  const { rows } = planCourses(slant, recipe.detail);
  const columns = Math.max(3, Math.round(width / targetTileWidth(recipe.detail)));
  return rows * columns;
}
