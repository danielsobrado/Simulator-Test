import polygonClipping from 'polygon-clipping';

const EPSILON = 1e-8;

function samePoint(left, right, epsilon = EPSILON) {
  return Math.abs(left[0] - right[0]) <= epsilon
    && Math.abs(left[1] - right[1]) <= epsilon;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1])
    - (b[1] - a[1]) * (c[0] - a[0]);
}

export function signedPolygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function rotateToCanonicalStart(points) {
  let first = 0;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const selected = points[first];
    if (point[0] < selected[0] - EPSILON
      || (Math.abs(point[0] - selected[0]) <= EPSILON && point[1] < selected[1])) {
      first = index;
    }
  }
  return [...points.slice(first), ...points.slice(0, first)];
}

export function normalizeFootprintLoop(input) {
  if (!Array.isArray(input)) throw new Error('A footprint loop must be an array.');
  const points = input.map((point) => {
    if (!Array.isArray(point) || point.length < 2
      || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new Error('A footprint contains a non-finite point.');
    }
    return [point[0], point[1]];
  });
  if (points.length > 1 && samePoint(points[0], points.at(-1))) points.pop();

  const deduped = [];
  for (const point of points) {
    if (!deduped.length || !samePoint(point, deduped.at(-1))) deduped.push(point);
  }
  if (deduped.length > 1 && samePoint(deduped[0], deduped.at(-1))) deduped.pop();

  let changed = true;
  while (changed && deduped.length >= 3) {
    changed = false;
    for (let index = 0; index < deduped.length; index += 1) {
      const previous = deduped[(index - 1 + deduped.length) % deduped.length];
      const current = deduped[index];
      const next = deduped[(index + 1) % deduped.length];
      if (Math.abs(cross(previous, current, next)) <= EPSILON
        && (current[0] - previous[0]) * (current[0] - next[0])
          + (current[1] - previous[1]) * (current[1] - next[1]) <= EPSILON) {
        deduped.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  if (deduped.length < 3 || Math.abs(signedPolygonArea(deduped)) <= EPSILON) {
    throw new Error('A footprint loop must contain at least three non-collinear points.');
  }
  if (signedPolygonArea(deduped) < 0) deduped.reverse();
  return rotateToCanonicalStart(deduped);
}

export function rectangleFootprint(primitive, overhang = 0) {
  const [width, depth] = primitive.dimensions;
  const halfWidth = width / 2 + overhang;
  const halfDepth = depth / 2 + overhang;
  const radians = primitive.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const [centerX, centerZ] = primitive.position;
  return normalizeFootprintLoop([
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ].map(([x, z]) => [
    centerX + cosine * x + sine * z,
    centerZ - sine * x + cosine * z,
  ]));
}

function closed(loop) {
  return [...loop, [...loop[0]]];
}

function polygonAreaWithHoles(polygon) {
  return polygon.reduce((total, ring, index) => (
    total + Math.abs(signedPolygonArea(ring)) * (index === 0 ? 1 : -1)
  ), 0);
}

function intersectsComponent(loop, component) {
  const intersection = polygonClipping.intersection([closed(loop)], component);
  return intersection.some((polygon) => polygonAreaWithHoles(polygon) > EPSILON);
}

function normalizedComponents(result) {
  return result.map((polygon) => {
    if (polygon.length !== 1) {
      throw new Error('Roof footprints with courtyards are not supported.');
    }
    return normalizeFootprintLoop(polygon[0]);
  }).sort((left, right) => {
    const a = left[0];
    const b = right[0];
    return a[0] - b[0] || a[1] - b[1];
  });
}

/**
 * Unions rotated rectangle primitives into deterministic, simply-connected roof
 * components. Connectivity is established before applying the eaves overhang,
 * so overhangs cannot bridge a real gap between two buildings.
 */
export function unionRectangleFootprints(primitives, { overhang = 0 } = {}) {
  if (!Array.isArray(primitives) || primitives.length === 0) return [];
  const ordered = [...primitives].sort((left, right) => left.id.localeCompare(right.id));
  const baseLoops = ordered.map((primitive) => rectangleFootprint(primitive));
  const baseUnion = polygonClipping.union(...baseLoops.map((loop) => [closed(loop)]));
  const result = [];

  for (const baseComponent of baseUnion) {
    if (baseComponent.length !== 1) {
      throw new Error('Roof footprints with courtyards are not supported.');
    }
    const members = ordered.filter((primitive, index) => (
      intersectsComponent(baseLoops[index], baseComponent)
    ));
    const expanded = members.map((primitive) => rectangleFootprint(primitive, overhang));
    const expandedUnion = polygonClipping.union(...expanded.map((loop) => [closed(loop)]));
    for (const polygon of normalizedComponents(expandedUnion)) {
      result.push(Object.freeze({
        polygon: Object.freeze(polygon.map((point) => Object.freeze(point))),
        primitiveIds: Object.freeze(members.map(({ id }) => id)),
      }));
    }
  }

  return result.sort((left, right) => {
    const a = left.polygon[0];
    const b = right.polygon[0];
    return a[0] - b[0] || a[1] - b[1];
  });
}

export function subtractPolygonDiscs(polygon, discs, segments = 32) {
  if (!discs?.length) return [[polygon]];
  const subject = [[closed(polygon)]];
  const clips = discs.map(({ center, radius }) => {
    const ring = Array.from({ length: segments }, (_, index) => {
      const angle = index * Math.PI * 2 / segments;
      return [
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
      ];
    });
    return [closed(ring)];
  });
  return polygonClipping.difference(subject, ...clips);
}
