import { CurvePath } from '../curves/CurvePath.js';
import {
  shapeChoice,
  shapeCommon,
  shapeNumber,
  shapeSuppression,
  shapeBoolean,
} from './ShapeValidation.js';
import { arcWallPath, sampleShapePath, placeShapePoint, shapeBounds } from './ShapePaths.js';
import { normalizeShapeOpenings, resolveShapeOpenings, shapeOpeningPortal } from './ShapeOpenings.js';
import { normalizeShapeStyle } from './ShapeStyles.js';
import { normalizeShapeProfile } from './ShapeProfile.js';
import { normalizeShapeCrown, resolveShapeCrown } from './ShapeCrown.js';

export function normalizeShapeWall(source) {
  const height = shapeNumber(source.height, 'Wall height', 2.4, 0.5, 16);
  return Object.freeze({
    ...shapeCommon(source),
    style: normalizeShapeStyle(source.style),
    kind: 'curved-wall',
    length: shapeNumber(source.length, 'Wall length', 8, 1, 32),
    bend: shapeNumber(source.bend, 'Wall bend', 3, -16, 16),
    ...(source.path !== undefined ? { path: new CurvePath(source.path).toJSON() } : {}),
    height,
    thickness: shapeNumber(source.thickness, 'Wall thickness', 0.4, 0.15, 2),
    taper: shapeNumber(source.taper, 'Wall taper', 1, 0.7, 1.2),
    stonework: normalizeShapeProfile(source, height).stonework,
    base: normalizeShapeProfile({ base: source.base }, height).base,
    crown: normalizeShapeCrown(source.crown),
    surface: shapeChoice(source.surface, 'wall surface', 'masonry', [
      'masonry',
      'planks',
      'plaster',
    ]),
    suppressed: shapeSuppression(source),
    openings: normalizeShapeOpenings(source.openings, height),
    automaticGates: shapeBoolean(source.automaticGates, 'Automatic path gates', true),
  });
}

export function planShapeWall(primitive) {
  const curve = sampleShapePath(
    primitive.path ?? arcWallPath(primitive.id, primitive.length, primitive.bend),
  );
  const boundary = curve.samples.map((sample) => placeShapePoint(primitive, sample.point));
  const openings = resolveShapeOpenings(primitive, curve);
  const slabs = (curve.closed ? boundary : boundary.slice(0, -1)).map((start, index) => ({
    id: `${primitive.id}:${curve.samples[index].segmentId}:${index}`,
    primitiveId: primitive.id,
    start,
    end: boundary[(index + 1) % boundary.length],
    elevation: primitive.elevation,
    height: primitive.height,
    thickness: primitive.thickness,
    topThickness: primitive.thickness * primitive.taper,
    gaps: openings,
  }));
  return resolveShapeCrown({
    id: primitive.id,
    primitive,
    curve,
    openings,
    boundary,
    bounds: shapeBounds(boundary, primitive.thickness),
    regions: ['walls', 'trim', 'inserts', 'glazing', 'foliage', 'metal'].map((family) => ({
      id: `${primitive.id}:${family}`,
      primitiveId: primitive.id,
      componentId: primitive.id,
      label: `${primitive.label} · ${family}`,
      family:
        family === 'trim'
          ? 'stone'
          : family === 'inserts'
            ? 'wood'
            : family === 'glazing'
              ? 'recess'
              : family,
      connected: true,
    })),
    rpg: {
      collisionSlabs: slabs,
      walkableFloors: [],
      roomBoundaries: [],
      portals: openings
        .filter((o) => !['window', 'slit'].includes(o.role))
        .map((o) => shapeOpeningPortal({ id: primitive.id, primitive }, o)),
      stairSockets: [],
      foundationContacts: slabs.map((slab) => ({
        ...slab,
        id: `${slab.id}:contact`,
      })),
      coverSurfaces: slabs.map((slab) => ({ ...slab, id: `${slab.id}:cover` })),
    },
  });
}
