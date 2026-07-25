const MAX_PRIMITIVES = 48;
const MAX_WALL_POINTS = 64;
const VALID_ID = /^[a-z][a-z0-9-]{0,63}$/;
const VALID_ROOFS = Object.freeze({
  rectangle: new Set(['auto', 'gable', 'hip', 'flat']),
  circle: new Set(['auto', 'cone', 'flat']),
});
const VALID_WALL_TOPS = new Set(['plain', 'battlements', 'slate', 'terracotta']);

function requireObject(value, field) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function finite(value, field, fallback, minimum, maximum) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result)
    || result < minimum || result > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

function integer(value, field, fallback, minimum, maximum) {
  const result = finite(value, field, fallback, minimum, maximum);
  if (!Number.isInteger(result)) throw new Error(`${field} must be an integer.`);
  return result;
}

function stableId(value, field) {
  if (typeof value !== 'string' || !VALID_ID.test(value)) {
    throw new Error(`${field} must be a stable lowercase identifier.`);
  }
  return value;
}

function point2(value, field, fallback = [0, 0]) {
  const input = value === undefined ? fallback : value;
  if (!Array.isArray(input) || input.length !== 2) {
    throw new Error(`${field} must contain two coordinates.`);
  }
  return Object.freeze([
    finite(input[0], `${field} x`, 0, -256, 256),
    finite(input[1], `${field} z`, 0, -256, 256),
  ]);
}

function normalizeVolume(source, kind, field) {
  const roofFamily = source.roofFamily ?? 'auto';
  if (!VALID_ROOFS[kind].has(roofFamily)) {
    throw new Error(`${field} has an unsupported roof family.`);
  }
  const common = {
    id: stableId(source.id, `${field} id`),
    kind,
    position: point2(source.position, `${field} position`),
    rotation: finite(source.rotation, `${field} rotation`, 0, -360, 360),
    elevation: finite(source.elevation, `${field} elevation`, 0, -32, 128),
    height: finite(source.height, `${field} height`, 5, 1, 64),
    levels: integer(source.levels, `${field} levels`, 1, 1, 12),
    roofFamily,
  };
  if (kind === 'rectangle') {
    return Object.freeze({
      ...common,
      dimensions: point2(source.dimensions, `${field} dimensions`, [8, 6]).map(
        (dimension, index) => finite(
          dimension,
          `${field} ${index === 0 ? 'width' : 'depth'}`,
          index === 0 ? 8 : 6,
          1,
          64,
        ),
      ),
    });
  }
  return Object.freeze({
    ...common,
    radius: finite(source.radius, `${field} radius`, 3, 0.5, 32),
  });
}

function normalizeWall(source, field) {
  if (!Array.isArray(source.points) || source.points.length < 2
    || source.points.length > MAX_WALL_POINTS) {
    throw new Error(`${field} must contain 2-${MAX_WALL_POINTS} points.`);
  }
  const topFamily = source.topFamily ?? 'plain';
  if (!VALID_WALL_TOPS.has(topFamily)) {
    throw new Error(`${field} has an unsupported top family.`);
  }
  return Object.freeze({
    id: stableId(source.id, `${field} id`),
    kind: 'wall',
    points: Object.freeze(source.points.map((point, index) => (
      point2(point, `${field} point ${index + 1}`)
    ))),
    elevation: finite(source.elevation, `${field} elevation`, 0, -32, 128),
    height: finite(source.height, `${field} height`, 4, 0.5, 32),
    thickness: finite(source.thickness, `${field} thickness`, 0.45, 0.1, 4),
    topFamily,
  });
}

function normalizePrimitive(input, index) {
  const source = requireObject(input, `Composition primitive ${index + 1}`);
  if (source.kind === 'rectangle' || source.kind === 'circle') {
    return normalizeVolume(source, source.kind, `Composition primitive ${index + 1}`);
  }
  if (source.kind === 'wall') {
    return normalizeWall(source, `Composition primitive ${index + 1}`);
  }
  throw new Error(`Composition primitive ${index + 1} has an unsupported kind.`);
}

export function normalizeWorkshopComposition(input = {}) {
  const source = requireObject(input, 'Workshop composition');
  const primitiveInputs = source.primitives ?? [];
  if (!Array.isArray(primitiveInputs) || primitiveInputs.length > MAX_PRIMITIVES) {
    throw new Error(`Workshop composition must contain at most ${MAX_PRIMITIVES} primitives.`);
  }
  const primitives = primitiveInputs.map(normalizePrimitive);
  const ids = new Set();
  for (const primitive of primitives) {
    if (ids.has(primitive.id)) {
      throw new Error(`Duplicate composition primitive id: ${primitive.id}.`);
    }
    ids.add(primitive.id);
  }
  return Object.freeze({
    version: 1,
    primitives: Object.freeze(primitives.sort((left, right) => left.id.localeCompare(right.id))),
  });
}

export function serializeWorkshopComposition(input = {}) {
  const composition = normalizeWorkshopComposition(input);
  return {
    version: composition.version,
    primitives: composition.primitives.map((primitive) => ({
      ...primitive,
      ...(primitive.position ? { position: [...primitive.position] } : {}),
      ...(primitive.dimensions ? { dimensions: [...primitive.dimensions] } : {}),
      ...(primitive.points ? { points: primitive.points.map((point) => [...point]) } : {}),
    })),
  };
}

function rectangleSurfaces(primitive) {
  return [
    ['facade:north', 'North façade', 'walls'],
    ['facade:east', 'East façade', 'walls'],
    ['facade:south', 'South façade', 'walls'],
    ['facade:west', 'West façade', 'walls'],
    ['roof:main', 'Main roof', 'roof'],
    ['foundation', 'Foundation', 'stone'],
  ].map(([suffix, label, family]) => ({
    id: `${primitive.id}:${suffix}`,
    primitiveId: primitive.id,
    label,
    family,
    connected: true,
  }));
}

function circleSurfaces(primitive) {
  return [
    ['tower-shell', 'Tower shell', 'walls'],
    ['roof:main', 'Tower roof', 'roof'],
    ['foundation', 'Foundation', 'stone'],
  ].map(([suffix, label, family]) => ({
    id: `${primitive.id}:${suffix}`,
    primitiveId: primitive.id,
    label,
    family,
    connected: true,
  }));
}

function wallSurfaces(primitive) {
  const result = [];
  for (let index = 0; index < primitive.points.length - 1; index += 1) {
    result.push({
      id: `${primitive.id}:segment-${index + 1}:side-a`,
      primitiveId: primitive.id,
      label: `Wall segment ${index + 1}, side A`,
      family: 'walls',
      connected: true,
    }, {
      id: `${primitive.id}:segment-${index + 1}:side-b`,
      primitiveId: primitive.id,
      label: `Wall segment ${index + 1}, side B`,
      family: 'walls',
      connected: true,
    });
  }
  result.push({
    id: `${primitive.id}:${primitive.topFamily === 'battlements' ? 'battlements' : 'top'}`,
    primitiveId: primitive.id,
    label: primitive.topFamily === 'battlements' ? 'Battlements' : 'Wall top',
    family: primitive.topFamily === 'plain' ? 'stone' : 'roof',
    connected: true,
  });
  return result;
}

function volumeFootprint(primitive) {
  if (primitive.kind === 'circle') {
    return {
      kind: 'circle',
      center: [...primitive.position],
      radius: primitive.radius,
      rotation: primitive.rotation,
    };
  }
  return {
    kind: 'rectangle',
    center: [...primitive.position],
    dimensions: [...primitive.dimensions],
    rotation: primitive.rotation,
  };
}

function volumeSemantics(primitive) {
  const levelHeight = primitive.height / primitive.levels;
  const floors = Array.from({ length: primitive.levels }, (_, index) => ({
    id: `${primitive.id}:level-${index + 1}`,
    primitiveId: primitive.id,
    elevation: primitive.elevation + index * levelHeight,
    footprint: volumeFootprint(primitive),
  }));
  return {
    collisionSlabs: [{
      id: `${primitive.id}:shell`,
      primitiveId: primitive.id,
      elevation: primitive.elevation,
      height: primitive.height,
      footprint: volumeFootprint(primitive),
      gaps: [],
    }],
    walkableFloors: floors,
    roomBoundaries: floors.map((floor) => ({
      id: `${floor.id}:room`,
      primitiveId: primitive.id,
      levelId: floor.id,
      boundary: floor.footprint,
      adjacentRoomIds: [],
    })),
    foundationContacts: [{
      id: `${primitive.id}:contact`,
      primitiveId: primitive.id,
      elevation: primitive.elevation,
      footprint: volumeFootprint(primitive),
    }],
    coverSurfaces: [{
      id: `${primitive.id}:cover`,
      primitiveId: primitive.id,
      height: primitive.elevation + primitive.height,
      footprint: volumeFootprint(primitive),
    }],
  };
}

function wallSemantics(primitive) {
  const slabs = primitive.points.slice(0, -1).map((start, index) => ({
    id: `${primitive.id}:segment-${index + 1}`,
    primitiveId: primitive.id,
    start: [...start],
    end: [...primitive.points[index + 1]],
    elevation: primitive.elevation,
    height: primitive.height,
    thickness: primitive.thickness,
    gaps: [],
  }));
  return {
    collisionSlabs: slabs,
    walkableFloors: [],
    roomBoundaries: [],
    foundationContacts: slabs.map((slab) => ({
      id: `${slab.id}:contact`,
      primitiveId: primitive.id,
      start: slab.start,
      end: slab.end,
      thickness: slab.thickness,
      elevation: slab.elevation,
    })),
    coverSurfaces: slabs.map((slab) => ({
      id: `${slab.id}:cover`,
      primitiveId: primitive.id,
      start: slab.start,
      end: slab.end,
      height: slab.elevation + slab.height,
    })),
  };
}

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

export function planWorkshopComposition(recipe, dirtyIds = []) {
  const composition = normalizeWorkshopComposition(recipe?.composition);
  if (!Array.isArray(dirtyIds)) throw new Error('Dirty composition ids must be an array.');
  const primitiveIds = new Set(composition.primitives.map(({ id }) => id));
  const normalizedDirtyIds = [...new Set(dirtyIds)].sort();
  for (const id of normalizedDirtyIds) {
    if (!primitiveIds.has(id)) throw new Error(`Unknown dirty composition primitive: ${id}.`);
  }

  const materialRegions = [];
  const collisionSlabs = [];
  const walkableFloors = [];
  const roomBoundaries = [];
  const foundationContacts = [];
  const coverSurfaces = [];
  for (const primitive of composition.primitives) {
    materialRegions.push(...(
      primitive.kind === 'rectangle'
        ? rectangleSurfaces(primitive)
        : primitive.kind === 'circle'
          ? circleSurfaces(primitive)
          : wallSurfaces(primitive)
    ));
    const semantics = primitive.kind === 'wall'
      ? wallSemantics(primitive)
      : volumeSemantics(primitive);
    collisionSlabs.push(...semantics.collisionSlabs);
    walkableFloors.push(...semantics.walkableFloors);
    roomBoundaries.push(...semantics.roomBoundaries);
    foundationContacts.push(...semantics.foundationContacts);
    coverSurfaces.push(...semantics.coverSurfaces);
  }

  return Object.freeze({
    version: 1,
    recipe: Object.freeze(JSON.parse(JSON.stringify(recipe ?? {}))),
    revisionKey: JSON.stringify([
      serializeWorkshopComposition(composition),
      normalizedDirtyIds,
    ]),
    dirtyIds: Object.freeze(normalizedDirtyIds),
    primitives: composition.primitives,
    structural: Object.freeze({
      contacts: Object.freeze([]),
      suppressedFaces: Object.freeze([]),
      supports: Object.freeze([]),
    }),
    materialRegions: freezeArray(materialRegions.sort((a, b) => a.id.localeCompare(b.id))),
    attachments: Object.freeze([]),
    rpg: Object.freeze({
      collisionSlabs: freezeArray(collisionSlabs),
      walkableFloors: freezeArray(walkableFloors),
      roomBoundaries: freezeArray(roomBoundaries),
      portals: Object.freeze([]),
      stairSockets: Object.freeze([]),
      foundationContacts: freezeArray(foundationContacts),
      coverSurfaces: freezeArray(coverSurfaces),
    }),
  });
}
