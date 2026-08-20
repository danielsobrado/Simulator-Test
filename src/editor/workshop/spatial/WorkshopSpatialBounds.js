import { planWallEntity } from '../geometry/wall/WallPlanner.js';

function finite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return value;
}

function point2(value, field) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${field} must contain two coordinates.`);
  return [finite(value[0], `${field}[0]`), finite(value[1], `${field}[1]`)];
}

function orderedBounds(min, max) {
  return Object.freeze({
    min: Object.freeze([Math.min(min[0], max[0]), Math.min(min[1], max[1])]),
    max: Object.freeze([Math.max(min[0], max[0]), Math.max(min[1], max[1])]),
  });
}

function rectangleBounds(primitive) {
  const [cx, cz] = primitive.position;
  const [width, depth] = primitive.dimensions;
  const radians = primitive.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const corners = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ].map(([x, z]) => [cx + x * cosine - z * sine, cz + x * sine + z * cosine]);
  return orderedBounds(
    [Math.min(...corners.map(([x]) => x)), Math.min(...corners.map(([, z]) => z))],
    [Math.max(...corners.map(([x]) => x)), Math.max(...corners.map(([, z]) => z))],
  );
}

function wallBounds(primitive) {
  const halfThickness = primitive.thickness / 2;
  const xs = primitive.points.map(([x]) => x);
  const zs = primitive.points.map(([, z]) => z);
  return orderedBounds(
    [Math.min(...xs) - halfThickness, Math.min(...zs) - halfThickness],
    [Math.max(...xs) + halfThickness, Math.max(...zs) + halfThickness],
  );
}

function semanticWallBounds(entity) {
  const bounds = planWallEntity(entity).bounds;
  return orderedBounds([bounds.min[0], bounds.min[2]], [bounds.max[0], bounds.max[2]]);
}

export function normalizeWorkshopSpatialBounds(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workshop spatial bounds must be an object.');
  }
  return orderedBounds(point2(input.min, 'Workshop bounds min'), point2(input.max, 'Workshop bounds max'));
}

export function workshopEntitySpatialBounds(entity) {
  const explicit = entity?.properties?.spatialBounds;
  if (explicit) return normalizeWorkshopSpatialBounds(explicit);
  if (!entity?.type?.startsWith('composition-')) return null;
  if (entity.type === 'composition-wall' && entity.properties?.wall) return semanticWallBounds(entity);
  const primitive = entity.properties?.primitive;
  if (!primitive) return null;
  if (primitive.kind === 'rectangle') return rectangleBounds(primitive);
  if (primitive.kind === 'circle') {
    return orderedBounds(
      [primitive.position[0] - primitive.radius, primitive.position[1] - primitive.radius],
      [primitive.position[0] + primitive.radius, primitive.position[1] + primitive.radius],
    );
  }
  if (primitive.kind === 'wall') return wallBounds(primitive);
  return null;
}

export function workshopBoundsIntersect(left, right) {
  return !(
    left.max[0] < right.min[0]
    || left.min[0] > right.max[0]
    || left.max[1] < right.min[1]
    || left.min[1] > right.max[1]
  );
}
