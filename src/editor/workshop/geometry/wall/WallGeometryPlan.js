import { evaluateCurveSegment } from '../../curves/CurveSegment.js';
import { serializeWallDefinition } from './WallPath.js';

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function wallBounds(wall, sections) {
  const xs = sections.flatMap(({ left, right }) => [left[0], right[0]]);
  const zs = sections.flatMap(({ left, right }) => [left[1], right[1]]);
  return Object.freeze({
    min: Object.freeze([Math.min(...xs), wall.elevation, Math.min(...zs)]),
    max: Object.freeze([Math.max(...xs), wall.elevation + wall.height, Math.max(...zs)]),
  });
}

function surfaceFrame(wall, segment, side) {
  const evaluated = evaluateCurveSegment(segment, 0.5);
  const tangent = [evaluated.tangent[0], 0, evaluated.tangent[1]];
  const normal2 = [-evaluated.tangent[1], evaluated.tangent[0]];
  const lateral = side === 'a' ? wall.thickness / 2 : side === 'b' ? -wall.thickness / 2 : 0;
  const horizontal = side === 'top' || side === 'bottom';
  const y = side === 'top' ? wall.elevation + wall.height : wall.elevation;
  const normal = side === 'top'
    ? [0, 1, 0]
    : side === 'bottom'
      ? [0, -1, 0]
      : side === 'a'
        ? [normal2[0], 0, normal2[1]]
        : [-normal2[0], 0, -normal2[1]];
  return Object.freeze({
    origin: Object.freeze([
      evaluated.point[0] + normal2[0] * lateral,
      y,
      evaluated.point[1] + normal2[1] * lateral,
    ]),
    tangent: Object.freeze(tangent),
    up: Object.freeze(horizontal ? [normal2[0], 0, normal2[1]] : [0, 1, 0]),
    normal: Object.freeze(normal),
  });
}

function surfaceRegions(wall) {
  const regions = [];
  for (const segment of wall.path.listSegments()) {
    const prefix = `${wall.id}:${segment.id}`;
    regions.push(
      {
        id: `${prefix}:side-a`,
        wallId: wall.id,
        segmentId: segment.id,
        family: 'walls',
        side: 'a',
        frame: surfaceFrame(wall, segment, 'a'),
      },
      {
        id: `${prefix}:side-b`,
        wallId: wall.id,
        segmentId: segment.id,
        family: 'walls',
        side: 'b',
        frame: surfaceFrame(wall, segment, 'b'),
      },
      {
        id: `${prefix}:top`,
        wallId: wall.id,
        segmentId: segment.id,
        family: wall.topFamily === 'plain' ? 'stone' : 'roof',
        side: 'top',
        frame: surfaceFrame(wall, segment, 'top'),
      },
      {
        id: `${prefix}:bottom`,
        wallId: wall.id,
        segmentId: segment.id,
        family: 'walls',
        side: 'bottom',
        frame: surfaceFrame(wall, segment, 'bottom'),
      },
    );
  }
  return freezeArray(regions);
}

function wallSlice(wall, segmentId, start, end, suffix = '') {
  const id = `${wall.id}:${segmentId}${suffix}`;
  return {
    collision: {
      id,
      primitiveId: wall.id,
      wallId: wall.id,
      segmentId,
      start,
      end,
      elevation: wall.elevation,
      height: wall.height,
      thickness: wall.thickness,
      gaps: Object.freeze([]),
    },
    foundation: {
      id: `${id}:contact`,
      primitiveId: wall.id,
      wallId: wall.id,
      segmentId,
      start,
      end,
      thickness: wall.thickness,
      elevation: wall.elevation,
    },
    cover: {
      id: `${id}:cover`,
      primitiveId: wall.id,
      wallId: wall.id,
      segmentId,
      start,
      end,
      height: wall.elevation + wall.height,
      thickness: wall.thickness,
    },
  };
}

function rpgSemantics(wall, sections) {
  const spansBySegment = new Map();
  for (let index = 0; index < sections.length - 1; index += 1) {
    const current = sections[index];
    const next = sections[index + 1];
    const segmentId = current.segmentId === next.segmentId ? current.segmentId : next.segmentId;
    const spans = spansBySegment.get(segmentId) ?? [];
    spans.push({ start: current.point, end: next.point });
    spansBySegment.set(segmentId, spans);
  }

  const collisionSlabs = [];
  const foundationContacts = [];
  const coverSurfaces = [];
  for (const segment of wall.path.listSegments()) {
    const spans = spansBySegment.get(segment.id) ?? [];
    if (spans.length === 0) continue;
    const slices = segment.kind === 'line'
      ? [wallSlice(wall, segment.id, spans[0].start, spans.at(-1).end)]
      : spans.map((span, index) => wallSlice(
        wall,
        segment.id,
        span.start,
        span.end,
        `:slice-${index + 1}`,
      ));
    for (const slice of slices) {
      collisionSlabs.push(slice.collision);
      foundationContacts.push(slice.foundation);
      coverSurfaces.push(slice.cover);
    }
  }

  return Object.freeze({
    collisionSlabs: freezeArray(collisionSlabs),
    walkableFloors: Object.freeze([]),
    roomBoundaries: Object.freeze([]),
    portals: Object.freeze([]),
    stairSockets: Object.freeze([]),
    foundationContacts: freezeArray(foundationContacts),
    coverSurfaces: freezeArray(coverSurfaces),
  });
}

export function createWallGeometryPlan(wall, sections) {
  if (!wall || !Array.isArray(sections) || sections.length < 2) {
    throw new Error('Wall geometry plan requires a wall and at least two sections.');
  }
  const serializedWall = serializeWallDefinition(wall);
  const frozenSections = freezeArray(sections);
  const modifiers = wall.topFamily === 'battlements'
    ? Object.freeze([Object.freeze({ kind: 'legacy-battlements', topFamily: wall.topFamily })])
    : Object.freeze([]);
  return Object.freeze({
    version: 1,
    wallId: wall.id,
    wall: Object.freeze(serializedWall),
    path: Object.freeze(serializedWall.path),
    sections: frozenSections,
    surfaceDomains: surfaceRegions(wall),
    rpg: rpgSemantics(wall, sections),
    endpointSockets: Object.freeze([
      Object.freeze({ id: `${wall.id}:start`, wallId: wall.id, end: 'start', point: sections[0].point, tangent: sections[0].tangent }),
      Object.freeze({ id: `${wall.id}:end`, wallId: wall.id, end: 'end', point: sections.at(-1).point, tangent: sections.at(-1).tangent }),
    ]),
    modifiers,
    bounds: wallBounds(wall, sections),
    revisionKey: JSON.stringify([serializedWall, sections.map(({
      distance,
      segmentDistance,
      point,
      tangent,
      miterRatio,
    }) => [distance, segmentDistance, point, tangent, miterRatio])]),
  });
}
