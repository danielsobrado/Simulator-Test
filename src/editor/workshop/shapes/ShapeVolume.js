import {
  shapeChoice,
  shapeCommon,
  shapeNumber,
  shapeSuppression,
  shapeRecord,
  shapeBoolean,
} from './ShapeValidation.js';
import {
  ovalFootprint,
  roundedFootprint,
  sampleShapePath,
  placeShapePoint,
  shapeBounds,
} from './ShapePaths.js';
import { CurvePath } from '../curves/CurvePath.js';
import { profileFootprintDimensions } from './ShapeProfileFootprint.js';
import { normalizeShapeOpenings, resolveShapeOpenings, shapeOpeningPortal } from './ShapeOpenings.js';
import { normalizeShapeStyle } from './ShapeStyles.js';
import { normalizeShapeFeatures } from './ShapeFeatureSchema.js';
import { normalizeShapeDetailOverrides } from './ShapeDetailOverrides.js';
import { normalizeShapeProfile, shapeProfileBreaks, shapeProfileOut, shapeProfileReach } from './ShapeProfile.js';
import { normalizeShapeCrown, resolveShapeCrown, shapeRoofReach } from './ShapeCrown.js';
import { offsetShapePolygon } from './ShapeEnvelope.js';

export const SHAPE_ROOF_FAMILIES = Object.freeze(['hip', 'gable', 'bell', 'cone', 'spire', 'flat']);

export function normalizeShapeVolume(source) {
  const common = shapeCommon(source);
  const input = shapeRecord(source.footprint, 'Footprint');
  const family = shapeChoice(input.family, 'footprint', 'rounded', ['rounded', 'oval', 'custom']);
  const path = family === 'custom' ? new CurvePath(input.path).toJSON() : null;
  const dimensions = path ? profileFootprintDimensions(path) : input;
  const width = shapeNumber(dimensions.width, 'Footprint width', 7, 2, 32);
  const depth = shapeNumber(dimensions.depth, 'Footprint depth', 5, 2, 32);
  const cornerRadius = shapeNumber(
    input.cornerRadius,
    'Corner radius',
    0.8,
    0,
    Math.min(width, depth) / 2,
  );
  const height = shapeNumber(source.height, 'Wall height', 4, 1, 24);
  const levels = shapeNumber(source.levels, 'Levels', 1, 1, 8);
  if (!Number.isInteger(levels)) throw new Error('Levels must be an integer.');
  const roof = shapeRecord(source.roof, 'Roof');
  const normalizedOpenings = normalizeShapeOpenings(source.openings, height);
  return Object.freeze({
    ...common,
    style: normalizeShapeStyle(source.style),
    kind: 'curved-volume',
    footprint: Object.freeze({
      family,
      width,
      depth,
      cornerRadius,
      ...(path ? { path } : {}),
    }),
    height,
    levels,
    thickness: shapeNumber(
      source.thickness,
      'Wall thickness',
      0.28,
      0.12,
      Math.min(width, depth) / 5,
    ),
    taper: shapeNumber(source.taper, 'Wall taper', 1, 0.65, 1.2),
    ...normalizeShapeProfile(source, height),
    crown: normalizeShapeCrown(source.crown),
    roof: Object.freeze({
      family: shapeChoice(roof.family, 'roof family', 'gable', SHAPE_ROOF_FAMILIES),
      axis: shapeChoice(roof.axis, 'ridge direction', 'width', ['width', 'depth']),
      rise: shapeNumber(roof.rise, 'Roof rise', 2.6, 0.2, 12),
      overhang: shapeNumber(roof.overhang, 'Roof overhang', 0.4, 0.05, 1.5),
      sweep: shapeNumber(roof.sweep, 'Roof sweep', 0.45, 0, 1),
      sag: shapeNumber(roof.sag, 'Ridge sag', 0.12, 0, 0.5),
    }),
    surface: shapeChoice(source.surface, 'wall surface', 'plaster', [
      'plaster',
      'masonry',
      'planks',
    ]),
    openings: Object.freeze(normalizedOpenings),
    facade: shapeChoice(source.facade, 'facade treatment', 'plain', ['plain', 'timber']),
    shutters: shapeBoolean(source.shutters, 'Shutters'),
    craft: shapeBoolean(source.craft, 'Crafted details', true),
    chimney: shapeBoolean(source.chimney, 'Chimney', source.craft ?? true),
    windowBoxes: shapeBoolean(source.windowBoxes, 'Window boxes', source.craft ?? true),
    interior: shapeChoice(source.interior, 'Interior treatment', 'auto', ['auto', 'none', 'paving', 'bench']),
    ivyDensity: shapeNumber(source.ivyDensity, 'Ivy density', 0.65, 0, 1),
    features: normalizeShapeFeatures(source.features),
    detailOverrides: normalizeShapeDetailOverrides(source.detailOverrides),
    suppressed: shapeSuppression(source),
  });
}

export function resolveVolumePath(primitive) {
  const f = primitive.footprint;
  return f.family === 'custom'
    ? new CurvePath(f.path)
    : f.family === 'oval'
      ? ovalFootprint(primitive.id, f.width, f.depth)
      : roundedFootprint(primitive.id, f.width, f.depth, f.cornerRadius);
}

export function planShapeVolume(primitive) {
  const curve = sampleShapePath(resolveVolumePath(primitive));
  const openings = resolveShapeOpenings(primitive, curve);
  const boundary = curve.samples.map((sample) => placeShapePoint(primitive, sample.point));
  const topBoundary = curve.samples.map((sample) =>
    placeShapePoint(primitive, sample.point, primitive.taper),
  );
  const scaled = (t) => curve.samples.map((sample) => placeShapePoint(primitive, sample.point, 1 + (primitive.taper - 1) * t));
  // The centre-line envelope of the shell at a local height, including the vertical profile.
  const envelope = (y) => offsetShapePolygon(scaled(y / primitive.height), shapeProfileOut(primitive, y));
  const footprint = { kind: 'polygon', points: envelope(0) };
  const sections = [0, ...shapeProfileBreaks(primitive), primitive.height];
  const floors = Array.from({ length: primitive.levels }, (_, index) => ({
    id: `${primitive.id}:level-${index + 1}`,
    primitiveId: primitive.id,
    elevation: primitive.elevation + (primitive.height * index) / primitive.levels,
    footprint: {
      kind: 'polygon',
      points: envelope((primitive.height * index) / primitive.levels),
    },
  }));
  return resolveShapeCrown({
    id: primitive.id,
    primitive,
    curve,
    openings,
    boundary,
    topBoundary,
    bounds: shapeBounds([...boundary, ...topBoundary], Math.max(shapeRoofReach(primitive), primitive.thickness / 2 + shapeProfileReach(primitive))),
    regions: ['walls', 'roof', 'trim', 'deck', 'inserts', 'glazing', 'foliage', 'metal'].map((family) => ({
      id: `${primitive.id}:${family}`,
      primitiveId: primitive.id,
      componentId: primitive.id,
      label: `${primitive.label} · ${family}`,
      family:
        family === 'trim' || family === 'deck'
          ? 'stone'
          : family === 'inserts'
            ? 'wood'
            : family === 'glazing'
              ? 'recess'
              : family,
      connected: true,
    })),
    rpg: {
      // One slab per straight run of the profile, so collision follows batters and setbacks.
      collisionSlabs: sections.slice(0, -1).map((bottom, index) => ({
        id: index ? `${primitive.id}:shell-${index}` : `${primitive.id}:shell`,
        primitiveId: primitive.id,
        elevation: primitive.elevation + bottom,
        height: sections[index + 1] - bottom,
        thickness: primitive.thickness,
        footprint: { kind: 'polygon', points: envelope(bottom) },
        topFootprint: { kind: 'polygon', points: envelope(sections[index + 1] - 1e-4) },
        gaps: openings,
      })),
      walkableFloors: floors,
      roomBoundaries: floors.map((floor) => ({
        id: `${floor.id}:room`,
        primitiveId: primitive.id,
        levelId: floor.id,
        boundary: floor.footprint,
        adjacentRoomIds: [],
      })),
      portals: openings
        .filter((o) => !['window', 'slit'].includes(o.role))
        .map((o) => shapeOpeningPortal({ id: primitive.id, primitive }, o)),
      foundationContacts: [
        {
          id: `${primitive.id}:contact`,
          primitiveId: primitive.id,
          elevation: primitive.elevation,
          footprint,
        },
      ],
      coverSurfaces: [
        {
          id: `${primitive.id}:cover`,
          primitiveId: primitive.id,
          height: primitive.elevation + primitive.height,
          footprint,
        },
      ],
      stairSockets: [],
    },
  });
}
