import { addWallPatch, wallSolidBands } from './ShapeWallSurface.js';
import { createShapeRoofSurface } from './ShapeRoofSurface.js';
import { shapeRandom } from './ShapeMesh.js';
import { shapeCellWear } from './ShapeWeathering.js';
import { WORKSHOP_GEOMETRY_TOLERANCE as tolerance } from '../curves/GeometryTolerancePolicy.js';
import { SHAPE_COURSE_HEIGHT } from './ShapeProfile.js';
import { SHAPE_CASTLE_CONFIG } from './config/ShapeCastleConfig.generated.js';

const CELL_RELIEF = 0.1;
const ROOF_UNDERSIDE = 0.07;

// Cool grey ashlar is a vertex tint over the shared stone slot, so it never recolours other buildings.
// The multipliers are linear and sized against the slot's base colour for each recipe stone.
const ASHLAR_TINT = Object.freeze({ granite: [1.0, 1.08, 1.35], default: [0.54, 0.67, 1.06] });
const PLAIN = Object.freeze([1, 1, 1]);

/** Multiplier every dressed-stone tone of a shape shares, so trim never drifts from its wall. */
export function shapeStoneTint(recipe, plan) {
  return plan.primitive.stonework === 'ashlar' ? ASHLAR_TINT[recipe.style] ?? ASHLAR_TINT.default : PLAIN;
}
/** Mortar seen between ashlar stones: a dark recessed joint rather than a plaster-coloured gap. */
export const SHAPE_ASHLAR_JOINT_TONE = Object.freeze([0.17, 0.25, 0.5]);

export function shapeStoneTone(recipe, plan, domain, key) {
  const random = shapeRandom(recipe.seed, plan.id, domain, key);
  const warm = shapeRandom(recipe.seed, plan.id, `${domain}-warmth`, key) - 0.5;
  if (plan.primitive.stonework === 'ashlar') {
    // Mostly even stones with the occasional darker or paler block, as in weathered ashlar.
    const v = 0.74 + random * 0.16 + (random > 0.9 ? 0.07 : random < 0.08 ? -0.1 : 0);
    const tint = shapeStoneTint(recipe, plan);
    return [tint[0] * (v + warm * 0.035), tint[1] * v, tint[2] * (v - warm * 0.035)];
  }
  const v = 0.8 + random * 0.2;
  return [v + warm * 0.04, v, v - warm * 0.04];
}

/** Masonry reads as stone at every detail level, so its uncoursed core is the stone slot. */
export function shapeWallCoreMesh(plan, meshes, recipe) {
  return plan.primitive.surface === 'masonry' && recipe.detail < 2 ? meshes.trim : meshes.walls;
}

export const SHAPE_MASONRY_CORE_TONE = Object.freeze([0.9, 0.88, 0.84]);

/**
 * Local height of the roof underside above the outer face of a course, or the wall top
 * where the host has no pitched roof. Courses stop below it at eaves and climb into gables.
 */
export function shapeMasonryCeiling(plan, surface) {
  const p = plan.primitive;
  if (!p.roof || plan.roofReplaced || !['gable', 'hip'].includes(p.roof.family)) return () => p.height;
  const roof = createShapeRoofSurface(plan);
  return (distance) => {
    const face = surface.point(distance, p.height, p.thickness / 2 + CELL_RELIEF);
    return roof.heightAt(face[0], face[2]) - p.elevation - ROOF_UNDERSIDE;
  };
}

/**
 * Lay staggered course cells over one band of a wall-like surface. Closed loops get a whole
 * number of stones per course, so the bond runs around a tower without a seam.
 */
export function buildShapeCourseBand(plan, mesh, recipe, surface, {
  bottom = 0, top, faces, spans = null, ceiling = null, distances = [], openingEdges = new Set(),
  course = SHAPE_COURSE_HEIGHT, cellWidth = SHAPE_CASTLE_CONFIG.masonry.ashlarLength, stagger = true,
  domain = 'masonry', key = '', rows = null,
}) {
  const detail = recipe.detail >= 2, length = surface.length, closed = surface.closed;
  const cells = closed ? Math.max(2, Math.round(length / cellWidth)) : Math.ceil(length / cellWidth);
  const width = closed ? length / cells : cellWidth;
  const marks = closed ? [...distances, ...distances.map((d) => d + length)] : distances;
  const wrap = (d) => (closed ? ((d % length) + length) % length : d);
  const windows = !spans ? [[-Infinity, Infinity]]
    : closed ? spans.flatMap(([a, b]) => [[a - length, b - length], [a, b], [a + length, b + length]]) : spans;
  const count = Math.ceil((top - bottom) / course - tolerance.length);
  for (let row = 0; row < count; row++) {
    if (rows && !rows(row)) continue;
    const y0 = bottom + row * course + 0.012,
      y1 = Math.min(top - 0.012, bottom + (row + 1) * course - 0.012);
    const shift = stagger ? ((row % 2) * width) / 2 : 0;
    for (let cell = closed ? 0 : -1; cell < cells; cell++) {
      const left = cell * width + shift + 0.012, right = (cell + 1) * width + shift - 0.012;
      const color = shapeStoneTone(recipe, plan, domain, `${key}${row}:${cell}`);
      for (const [from, to] of windows) {
        const u0 = Math.max(closed ? left : Math.max(0, left), from),
          u1 = Math.min(closed ? right : Math.min(length, right), to);
        if (u1 - u0 < 0.08) continue;
        const pieces = Math.max(1, Math.ceil((u1 - u0) / 0.18));
        const cuts = [u0, ...marks.filter((d) => d > u0 && d < u1), u1];
        for (let k = 1; k < pieces; k++) cuts.push(u0 + ((u1 - u0) * k) / pieces);
        cuts.sort((a, b) => a - b);
        const wear = shapeCellWear(plan, recipe.seed, `${key}${row}:${cell}`);
        for (let k = 0; k < cuts.length - 1; k++) {
          // A stone is chipped at its own corners only, never along the cuts that bend it round a curve.
          const first = k === 0, last = k === cuts.length - 2;
          const chips = [first ? wear[0] : 0, last ? wear[1] : 0, last ? wear[2] : 0, first ? wear[3] : 0];
          // Courses stop under the eave and climb a gable, following the roof underside.
          const roofed = ceiling ? [ceiling(cuts[k]) - 0.012, ceiling(cuts[k + 1]) - 0.012] : [y1, y1];
          for (const band of wallSolidBands(surface, cuts[k], cuts[k + 1], y0, y1, false)) {
            const high = band.top.map((value, i) => Math.min(value, roofed[i]));
            const low = band.bottom.map((value, i) => Math.min(value, high[i]));
            if (Math.max(high[0] - low[0], high[1] - low[1]) < 0.04) continue;
            for (const face of faces) {
              addWallPatch(mesh, surface, cuts[k], cuts[k + 1], low, high, face.offset, face.thickness, color, {
                back: false,
                bevel: detail,
                wear: chips,
                start: k === 0 || openingEdges.has(wrap(cuts[k])),
                end: k === cuts.length - 2 || openingEdges.has(wrap(cuts[k + 1])),
              });
            }
          }
        }
      }
    }
  }
}

export function buildShapeMasonryCourses(plan, meshes, recipe, surface, distances, openingEdges) {
  const p = plan.primitive, planks = p.surface === 'planks';
  const ceiling = p.surface === 'masonry' ? shapeMasonryCeiling(plan, surface) : () => p.height;
  const detail = recipe.detail >= 2;
  buildShapeCourseBand(plan, planks ? meshes.inserts : meshes.trim, recipe, surface, {
    top: Math.max(p.height, ...distances.map(ceiling)),
    faces: (p.kind === 'curved-wall' ? [-1, 1] : [1]).map((side) => ({ offset: side * (p.thickness / 2 + 0.045), thickness: side * 0.055 })),
    ceiling, distances, openingEdges, domain: p.surface,
    course: planks ? p.height : SHAPE_COURSE_HEIGHT, cellWidth: planks ? 0.24 : undefined, stagger: !planks,
    rows: (row) => (detail || row === 0) && !(p.surface === 'plaster' && (row > 1 || p.grounded === false)),
  });
}
