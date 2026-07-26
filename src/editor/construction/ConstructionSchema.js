export const CONSTRUCTION_RECORD_VERSION = 1;
export const CUBIC_BEZIER_PATH_VERSION = 2;
export const MAX_CONSTRUCTION_PATH_POINTS = 512;

const ID_PATTERN = /^[a-z][a-z0-9-]{0,95}$/;
const PATH_TYPES = new Set(['polyline', 'cubicBezier']);
const FEATURE_KINDS = new Set(['door', 'window', 'arch', 'gate', 'tower', 'breach']);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} has an invalid identifier.`);
  }
  return value;
}

function finite(value, label, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}.`);
  }
  return value;
}

function vector2(value, label) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must contain exactly two coordinates.`);
  }
  return Object.freeze([
    finite(value[0], `${label} X`),
    finite(value[1], `${label} Z`),
  ]);
}

function uniqueIds(entries, label) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`${label} contains duplicate id ${entry.id}.`);
    ids.add(entry.id);
  }
  return ids;
}

function normalizeFeatures(input, validSegmentIds) {
  if (!Array.isArray(input)) throw new Error('Construction features must be an array.');
  const features = input.map((value, index) => {
    const feature = requireObject(value, `Construction feature ${index + 1}`);
    const kind = typeof feature.kind === 'string' ? feature.kind : '';
    if (!FEATURE_KINDS.has(kind)) {
      throw new Error(`Construction feature ${index + 1} has unsupported kind ${kind}.`);
    }
    const segmentId = requireId(feature.segmentId, `Construction feature ${index + 1} segment`);
    if (!validSegmentIds.has(segmentId)) {
      throw new Error(`Construction feature ${index + 1} references missing segment ${segmentId}.`);
    }
    return Object.freeze({
      id: requireId(feature.id, `Construction feature ${index + 1}`),
      kind,
      segmentId,
      arcFraction: finite(
        feature.arcFraction,
        `Construction feature ${index + 1} arc fraction`,
        0,
        1,
      ),
      width: finite(feature.width ?? 1.2, `Construction feature ${index + 1} width`, 0.2, 20),
      height: finite(feature.height ?? 2.2, `Construction feature ${index + 1} height`, 0.2, 30),
    });
  });
  uniqueIds(features, 'Construction features');
  return Object.freeze(features);
}

function normalizePolylinePath(source) {
  if (!Array.isArray(source.points) || source.points.length < 2) {
    throw new Error('A polyline construction path requires at least two points.');
  }
  if (source.points.length > MAX_CONSTRUCTION_PATH_POINTS) {
    throw new Error(
      `A polyline construction path supports at most ${MAX_CONSTRUCTION_PATH_POINTS} points.`,
    );
  }
  const points = source.points.map((value, index) => {
    const point = requireObject(value, `Path point ${index + 1}`);
    return Object.freeze({
      id: requireId(point.id, `Path point ${index + 1}`),
      position: vector2(point.position, `Path point ${index + 1} position`),
    });
  });
  uniqueIds(points, 'Path points');
  const segmentIds = new Set();
  for (let index = 0; index < points.length - 1; index += 1) {
    segmentIds.add(`segment-${points[index].id}-${points[index + 1].id}`);
  }
  if (source.closed) segmentIds.add(`segment-${points.at(-1).id}-${points[0].id}`);
  return Object.freeze({
    version: 1,
    type: 'polyline',
    closed: Boolean(source.closed),
    points: Object.freeze(points),
    features: normalizeFeatures(source.features ?? [], segmentIds),
  });
}

function normalizeCubicBezierPath(source) {
  if (source.version !== CUBIC_BEZIER_PATH_VERSION) {
    throw new Error(`Cubic Bézier path version must be ${CUBIC_BEZIER_PATH_VERSION}.`);
  }
  if (!Array.isArray(source.anchors) || source.anchors.length < 2) {
    throw new Error('A cubic Bézier construction path requires at least two anchors.');
  }
  if (source.anchors.length > MAX_CONSTRUCTION_PATH_POINTS) {
    throw new Error(
      `A cubic Bézier construction path supports at most ${MAX_CONSTRUCTION_PATH_POINTS} anchors.`,
    );
  }
  const anchors = source.anchors.map((value, index) => {
    const anchor = requireObject(value, `Path anchor ${index + 1}`);
    return Object.freeze({
      id: requireId(anchor.id, `Path anchor ${index + 1}`),
      position: vector2(anchor.position, `Path anchor ${index + 1} position`),
    });
  });
  const anchorIds = uniqueIds(anchors, 'Path anchors');
  const expectedSegments = source.closed ? anchors.length : anchors.length - 1;
  if (!Array.isArray(source.segments) || source.segments.length !== expectedSegments) {
    throw new Error(`Cubic Bézier path requires exactly ${expectedSegments} ordered segments.`);
  }
  const segments = source.segments.map((value, index) => {
    const segment = requireObject(value, `Path segment ${index + 1}`);
    const startAnchorId = requireId(segment.startAnchorId, `Path segment ${index + 1} start`);
    const endAnchorId = requireId(segment.endAnchorId, `Path segment ${index + 1} end`);
    if (!anchorIds.has(startAnchorId) || !anchorIds.has(endAnchorId)) {
      throw new Error(`Path segment ${index + 1} references a missing anchor.`);
    }
    const expectedStart = anchors[index].id;
    const expectedEnd = anchors[(index + 1) % anchors.length].id;
    if (startAnchorId !== expectedStart || endAnchorId !== expectedEnd) {
      throw new Error(`Path segment ${index + 1} does not follow anchor order.`);
    }
    return Object.freeze({
      id: requireId(segment.id, `Path segment ${index + 1}`),
      startAnchorId,
      endAnchorId,
      startHandle: vector2(segment.startHandle, `Path segment ${index + 1} start handle`),
      endHandle: vector2(segment.endHandle, `Path segment ${index + 1} end handle`),
    });
  });
  const segmentIds = uniqueIds(segments, 'Path segments');
  return Object.freeze({
    version: CUBIC_BEZIER_PATH_VERSION,
    type: 'cubicBezier',
    closed: Boolean(source.closed),
    anchors: Object.freeze(anchors),
    segments: Object.freeze(segments),
    features: normalizeFeatures(source.features ?? [], segmentIds),
  });
}

export function normalizeConstructionPath(input) {
  const source = requireObject(input, 'Construction path');
  if (!PATH_TYPES.has(source.type)) {
    throw new Error(`Unsupported construction path type ${source.type}.`);
  }
  return source.type === 'polyline'
    ? normalizePolylinePath(source)
    : normalizeCubicBezierPath(source);
}

export function normalizeConstructionRecord(input) {
  const source = requireObject(input, 'Construction record');
  if (source.version !== CONSTRUCTION_RECORD_VERSION) {
    throw new Error(`Construction record version must be ${CONSTRUCTION_RECORD_VERSION}.`);
  }
  const style = requireObject(source.style ?? {}, 'Construction style');
  const dimensions = requireObject(source.dimensions ?? {}, 'Construction dimensions');
  const path = normalizeConstructionPath({
    ...source.path,
    features: source.features ?? source.path?.features ?? [],
  });
  return Object.freeze({
    version: CONSTRUCTION_RECORD_VERSION,
    id: requireId(source.id, 'Construction'),
    revision: integer(source.revision, 'Construction revision', 1),
    seed: integer(source.seed, 'Construction seed'),
    kind: source.kind === 'building' ? 'building' : 'wall',
    label: typeof source.label === 'string' && source.label.trim()
      ? source.label.trim().slice(0, 80)
      : 'Curved wall',
    style: Object.freeze({
      key: requireId(style.key ?? 'coursed-rubble', 'Construction style'),
      version: integer(style.version ?? 1, 'Construction style version', 1),
    }),
    dimensions: Object.freeze({
      height: finite(dimensions.height ?? 3.5, 'Construction height', 0.5, 30),
      thickness: finite(dimensions.thickness ?? 0.8, 'Construction thickness', 0.1, 10),
    }),
    path,
    features: path.features,
  });
}
