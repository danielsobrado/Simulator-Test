import { beveledBox, transformGeometry } from './ProceduralWorkshopGeometry.js';
import { offsetAlongLocalY, stoneJitter } from './ProceduralWorkshopIrregularity.js';
import { applyUnitShading } from './ProceduralWorkshopMaterials.js';
import { mixSeed } from './ProceduralRandom.js';

/**
 * Individual overlapping roof tiles.
 *
 * Before 2026-07-25 every roof in the workshop was a smooth cone or a pair of
 * flat slabs, and tile courses existed only as seams painted into
 * `roofBumpTexture` — what 15-…md line 112 called "raised roof-tile seams".
 * That reads as a textured surface, never as stacked tiles.
 *
 * These builders lay real solids over the existing roof deck. The deck stays in
 * place and tiles sit just outside it, so jitter can never open a hole through
 * the roof and there is no z-fighting.
 *
 * Cost is bounded three ways: solids are emitted only at Ultra detail (see
 * `shinglesEnabled`); tile size grows on large roofs so the count stays inside
 * `MAX_SHINGLES` (04-…md §15, "when a region exceeds budget, increase target
 * stone size"); and `assertBudget` fails closed if either of those is ever
 * bypassed.
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

/**
 * Absolute ceiling on that oversail, in metres.
 *
 * Tile length grows adaptively on large roofs to hold the tile budget, so a
 * purely proportional oversail grew with it: a 8 m square tower's pyramid
 * oversailed its deck by 1.27 m, which is not an eaves detail but a second roof.
 * It also inflated the detail-3 envelope far enough past the detail-1 envelope
 * that the LOD ladder refused the asset outright. An eaves overhang is an
 * architectural dimension and does not scale with how coarsely the roof is tiled.
 */
const MAX_EAVES_OVERSAIL = 0.18;

/** Maximum upward tilt of a tile's free edge, in radians, at full irregularity. */
const MAX_EDGE_KICK = 0.09;

/** A pyramid, not a cone: few enough sides that the facets read as flat planes. */
const MAX_FACETED_SIDES = 8;

export function shinglesEnabled(recipe) {
  return recipe.detail >= SHINGLE_DETAIL_THRESHOLD;
}

function baseMetrics(detail) {
  return {
    courseLength: 0.16 + (3 - detail) * 0.05,
    tileWidth: 0.19 + (3 - detail) * 0.04,
  };
}

/**
 * Grow tile size until the predicted count fits the budget.
 *
 * Count scales inversely with course length times tile width, so a uniform
 * `sqrt(over)` scale converges in one step; the extra passes absorb the rounding
 * in the per-row column counts. Small roofs — the common case — return the base
 * metrics untouched on the first pass, at real-world tile scale.
 */
function fitMetrics(detail, countFor) {
  let metrics = baseMetrics(detail);
  for (let pass = 0; pass < 5; pass += 1) {
    const count = countFor(metrics);
    if (count <= MAX_SHINGLES) return metrics;
    const scale = Math.sqrt(count / MAX_SHINGLES) * 1.02;
    metrics = {
      courseLength: metrics.courseLength * scale,
      tileWidth: metrics.tileWidth * scale,
    };
  }
  return metrics;
}

/**
 * Row plan shared by cones and planar slopes.
 *
 * Rows advance by `courseStep` but each tile is longer than the step, which is
 * what produces the overlap. `centre` is the fraction up the slope of the tile's
 * midpoint.
 */
function planCourses(slantLength, courseLength) {
  const rows = Math.max(4, Math.round(slantLength / courseLength));
  const courseStep = slantLength / rows;
  const tileLength = courseStep / (1 - COURSE_OVERLAP);
  const courses = [];
  for (let row = 0; row < rows; row += 1) {
    const low = (row * courseStep) / slantLength;
    const oversail = row === 0
      ? Math.min(tileLength * EAVES_OVERSAIL, MAX_EAVES_OVERSAIL)
      : 0;
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

function coneSurface(radius, height, sides) {
  const faceted = sides >= 3 && sides <= MAX_FACETED_SIDES;
  // A pyramid's surface sits at the inradius, not the circumradius. Laying tiles
  // on a circle of `radius` would float them above each facet's middle.
  const surfaceRadius = faceted ? radius * Math.cos(Math.PI / sides) : radius;
  return {
    faceted,
    surfaceRadius,
    slant: Math.hypot(surfaceRadius, height),
    pitch: Math.atan2(height, surfaceRadius),
  };
}

function coneColumnsFor(course, { faceted, surfaceRadius }, radius, sides, tileWidth) {
  const shrink = 1 - course.centre;
  if (faceted) {
    // Each facet is an isosceles triangle narrowing toward the apex, so the
    // row's usable width shrinks with height and the tile count with it.
    const facetWidth = 2 * radius * Math.sin(Math.PI / sides) * shrink;
    return {
      columns: Math.max(1, Math.round(facetWidth / tileWidth)),
      span: facetWidth,
      surfaceZ: Math.max(0.02, surfaceRadius * shrink),
    };
  }
  const rowRadius = Math.max(0.05, surfaceRadius * shrink);
  const circumference = Math.PI * 2 * rowRadius;
  return {
    columns: Math.max(3, Math.round(circumference / tileWidth)),
    span: circumference,
    surfaceZ: rowRadius,
  };
}

function countCone(radius, height, sides, metrics) {
  const surface = coneSurface(radius, height, sides);
  const { courses } = planCourses(surface.slant, metrics.courseLength);
  let total = 0;
  for (const course of courses) {
    const { columns } = coneColumnsFor(course, surface, radius, sides, metrics.tileWidth);
    total += surface.faceted ? columns * sides : columns;
  }
  return total;
}

function countSlope(width, height, roofDepth, metrics) {
  const slant = Math.hypot(roofDepth / 2, height);
  const { rows } = planCourses(slant, metrics.courseLength);
  return rows * Math.max(3, Math.round(width / metrics.tileWidth));
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
  // down-slope end, so the sign follows which way the slope runs. Always a lift,
  // never a dig-in, so no tile is driven through the deck.
  const kickLane = (mixSeed(recipe.seed ^ 0xc2b2ae35, stableIndex) & 255) / 255;
  const kick = -kickSign * MAX_EDGE_KICK * amount * kickLane;

  const shaped = stoneJitter(recipe, {
    width,
    height: THICKNESS,
    depth: length,
    position,
    rotation: [pitch + kick, 0, 0],
    bevelRatio: BEVEL_RATIO,
  }, stableIndex, 'shingle', { protrusionAxis: 'y' });

  // Sit clear of the deck along the tile's own normal.
  const lift = offsetAlongLocalY(shaped.rotation, THICKNESS * 0.5 + DECK_CLEARANCE);

  return applyUnitShading(
    beveledBox({
      width: shaped.width,
      height: shaped.height,
      depth: shaped.depth,
      position: [
        shaped.position[0] + lift[0],
        shaped.position[1] + lift[1],
        shaped.position[2] + lift[2],
      ],
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
 * Rows thin out toward the apex, keeping tile width roughly constant up the roof
 * instead of fanning out.
 *
 * Tiles are built in a pre-yaw frame and then rotated into place, so the pitch
 * applies in the tile's own frame. Composing two transforms this way yields
 * `Ry * Rx`, which a single XYZ Euler triple cannot express.
 */
export function shingledConeGeometries(recipe, {
  radius,
  height,
  baseY,
  centerX = 0,
  centerZ = 0,
  seedOffset,
  sides = 0,
  rotationY = 0,
  depthScale = 1,
}) {
  if (!shinglesEnabled(recipe) || radius <= 0 || height <= 0) return [];
  const metrics = fitMetrics(
    recipe.detail,
    (candidate) => countCone(radius, height, sides, candidate),
  );
  const surface = coneSurface(radius, height, sides);
  const { courses } = planCourses(surface.slant, metrics.courseLength);
  const geometries = [];
  let stableIndex = seedOffset * 10_000;

  const emit = (tile, yaw) => {
    transformGeometry(tile, {
      rotation: [0, rotationY + yaw, 0],
      position: [centerX, baseY, centerZ],
    });
    // World-space, after the yaw, exactly as the deck applies it
    // (`roof.scale(1, 1, depth / width)`). Passing it through `transformGeometry`
    // scaled in the tile's pre-rotation frame instead, so on the facets that face
    // +/-X the depth squash landed on world X and the tiles no longer matched the
    // deck they cover.
    if (depthScale !== 1) tile.scale(1, 1, depthScale);
    geometries.push(tile);
    stableIndex += 1;
    assertBudget(geometries.length);
  };

  for (const course of courses) {
    const y = height * course.centre;
    const row = coneColumnsFor(course, surface, radius, sides, metrics.tileWidth);
    const step = row.span / row.columns;
    const width = step * LATERAL_OVERLAP;

    if (surface.faceted) {
      // Alternate rows shift a quarter step either way rather than a half step
      // one way. Adjacent rows still break joint by a half step, but every row
      // spans the same extent, so no tile hangs past the facet edge and the tile
      // count is exactly `columns` on every row — which is what lets
      // `countCone` predict generation exactly instead of approximately.
      const stagger = (course.row % 2 === 0 ? -1 : 1) * step * 0.25;
      for (let facet = 0; facet < sides; facet += 1) {
        for (let column = 0; column < row.columns; column += 1) {
          const x = -row.span / 2 + step * (column + 0.5) + stagger;
          emit(tileGeometry(recipe, {
            width,
            length: course.tileLength,
            pitch: surface.pitch,
            position: [x, y, row.surfaceZ],
            stableIndex,
            kickSign: 1,
            heightRatio: course.centre,
          // Half-facet offset. A tile is built facing local +Z, so without it the
          // tile facets sit at theta 0/90/180/270 while `ConeGeometry` centres
          // its facets between its vertices, at 45/135/225/315 — the tiles ended
          // up rotated a half facet off the deck they are meant to lie on, which
          // on a square tower is a full 45 degrees.
          }), ((facet + 0.5) / sides) * Math.PI * 2);
        }
      }
      continue;
    }

    // Half-tile stagger, the running bond that stops joints lining up.
    const phase = (course.row % 2) * (Math.PI / row.columns);
    for (let column = 0; column < row.columns; column += 1) {
      emit(tileGeometry(recipe, {
        width,
        length: course.tileLength,
        pitch: surface.pitch,
        position: [0, y, row.surfaceZ],
        stableIndex,
        kickSign: 1,
        heightRatio: course.centre,
      }), phase + (column / row.columns) * Math.PI * 2);
    }
  }
  return geometries;
}

/**
 * Tile one planar roof pitch.
 *
 * `side` matches the convention in `wallRoofPlanes`: +1 is the slope facing +z,
 * -1 the slope facing -z. The pitch is `side * angle` for both, which comes out
 * with an upward surface normal either way.
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
  const metrics = fitMetrics(
    recipe.detail,
    (candidate) => countSlope(width, height, roofDepth, candidate),
  );
  const run = roofDepth / 2;
  const slant = Math.hypot(run, height);
  const pitch = side * Math.atan2(height, run);
  const { courses } = planCourses(slant, metrics.courseLength);
  const columns = Math.max(3, Math.round(width / metrics.tileWidth));
  const step = width / columns;
  const tileWidth = step * LATERAL_OVERLAP;
  const geometries = [];
  let stableIndex = seedOffset * 10_000;

  for (const course of courses) {
    const y = baseY + height * course.centre;
    const z = centerZ + side * run * (1 - course.centre);
    // Quarter-step alternation, as on faceted cones: adjacent rows break joint
    // by a half step while every row keeps the same extent, so no tile overhangs
    // the verge and the count is exactly `columns` per row.
    const stagger = (course.row % 2 === 0 ? -1 : 1) * step * 0.25;

    for (let column = 0; column < columns; column += 1) {
      const x = centerX - width / 2 + step * (column + 0.5) + stagger;
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

function faceFrame(face) {
  const [[startX, startZ], [endX, endZ]] = face.sourceEdge;
  const length = Math.hypot(endX - startX, endZ - startZ);
  if (length <= 1e-8) throw new Error('A shingled roof face has a zero-length eave.');
  const edgeX = (endX - startX) / length;
  const edgeZ = (endZ - startZ) / length;
  const centroid = face.rings[0].reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
    [0, 0],
  ).map((value) => value / face.rings[0].length);
  let inwardX = -edgeZ;
  let inwardZ = edgeX;
  if ((centroid[0] - startX) * inwardX + (centroid[1] - startZ) * inwardZ < 0) {
    inwardX *= -1;
    inwardZ *= -1;
  }
  const toLocal = ([x, z]) => [
    (x - startX) * edgeX + (z - startZ) * edgeZ,
    (x - startX) * inwardX + (z - startZ) * inwardZ,
  ];
  return {
    startX,
    startZ,
    edgeX,
    edgeZ,
    inwardX,
    inwardZ,
    yaw: Math.atan2(inwardX, inwardZ),
    rings: face.rings.map((ring) => ring.map(toLocal)),
  };
}

function scanlineIntervals(rings, v) {
  const intersections = [];
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const [u1, v1] = ring[index];
      const [u2, v2] = ring[(index + 1) % ring.length];
      if ((v1 <= v && v2 > v) || (v2 <= v && v1 > v)) {
        intersections.push(u1 + (u2 - u1) * ((v - v1) / (v2 - v1)));
      }
    }
  }
  intersections.sort((left, right) => left - right);
  const intervals = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    if (intersections[index + 1] - intersections[index] > 1e-6) {
      intervals.push([intersections[index], intersections[index + 1]]);
    }
  }
  return intervals;
}

function countFaceTiles(frames, pitch, metrics) {
  let count = 0;
  for (const frame of frames) {
    const maxV = Math.max(...frame.rings.flat().map(([, v]) => v));
    if (maxV <= 1e-6) continue;
    const slant = maxV / Math.max(0.01, Math.cos(pitch));
    const { courses } = planCourses(slant, metrics.courseLength);
    for (const course of courses) {
      const v = maxV * course.centre;
      for (const [start, end] of scanlineIntervals(frame.rings, v)) {
        count += Math.max(1, Math.round((end - start) / metrics.tileWidth));
      }
    }
  }
  return count;
}

/**
 * Tile arbitrary straight-skeleton roof faces.
 *
 * Each face supplies one or more clipped rings plus its source eave. Rows are
 * intersected with all rings using even/odd fill, so concave faces and tower
 * cut-outs are handled by the same deterministic scanline path.
 */
export function shingledRoofFaceGeometries(recipe, {
  faces,
  baseY,
  pitchDegrees,
  seedOffset,
}) {
  if (!shinglesEnabled(recipe) || !faces?.length) return [];
  const pitch = pitchDegrees * Math.PI / 180;
  const frames = faces.map(faceFrame);
  const metrics = fitMetrics(
    recipe.detail,
    (candidate) => countFaceTiles(frames, pitch, candidate),
  );
  const geometries = [];
  let stableIndex = seedOffset * 10_000;
  for (const frame of frames) {
    const maxV = Math.max(...frame.rings.flat().map(([, v]) => v));
    if (maxV <= 1e-6) continue;
    const slant = maxV / Math.max(0.01, Math.cos(pitch));
    const { courses } = planCourses(slant, metrics.courseLength);
    for (const course of courses) {
      const v = maxV * course.centre;
      for (const [start, end] of scanlineIntervals(frame.rings, v)) {
        const span = end - start;
        const columns = Math.max(1, Math.round(span / metrics.tileWidth));
        const step = span / columns;
        for (let column = 0; column < columns; column += 1) {
          const u = start + step * (column + 0.5);
          const tile = tileGeometry(recipe, {
            width: step * LATERAL_OVERLAP,
            length: course.tileLength,
            pitch: -pitch,
            position: [u, baseY + v * Math.tan(pitch), v],
            stableIndex,
            kickSign: -1,
            heightRatio: course.centre,
          });
          geometries.push(transformGeometry(tile, {
            rotation: [0, frame.yaw, 0],
            position: [frame.startX, 0, frame.startZ],
          }));
          stableIndex += 1;
          assertBudget(geometries.length);
        }
      }
    }
  }
  return geometries;
}

/**
 * Analytic tile counts for the generator preflight.
 *
 * Both delegate to the same `fitMetrics` and counting helpers the builders use,
 * so an estimate can never disagree with what generation actually emits.
 */
export function estimateConeShingles(recipe, { radius, height, sides = 0 }) {
  if (!shinglesEnabled(recipe) || radius <= 0 || height <= 0) return 0;
  const metrics = fitMetrics(
    recipe.detail,
    (candidate) => countCone(radius, height, sides, candidate),
  );
  return countCone(radius, height, sides, metrics);
}

export function estimateSlopeShingles(recipe, { width, height, roofDepth }) {
  if (!shinglesEnabled(recipe) || width <= 0 || height <= 0) return 0;
  const metrics = fitMetrics(
    recipe.detail,
    (candidate) => countSlope(width, height, roofDepth, candidate),
  );
  return countSlope(width, height, roofDepth, metrics);
}
