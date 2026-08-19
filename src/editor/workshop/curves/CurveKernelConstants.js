export const CURVE_PATH_VERSION = 1;
export const CURVE_PATH_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const CURVE_POINT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const CURVE_SEGMENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export const CURVE_SEGMENT_KINDS = Object.freeze(['line', 'arc', 'quadratic']);

export const DEFAULT_GEOMETRY_TOLERANCE = Object.freeze({
  position: 1e-6,
  length: 1e-6,
  parameter: 1e-9,
  angle: 1e-8,
  intersection: 1e-6,
  relativeRadius: 1e-6,
  projectionIterations: 28,
  bezierSubdivisions: 64,
  intersectionSubdivisions: 96,
});

export const MAX_CURVE_POINTS = 256;
export const MAX_CURVE_SEGMENTS = 256;
export const TAU = Math.PI * 2;
