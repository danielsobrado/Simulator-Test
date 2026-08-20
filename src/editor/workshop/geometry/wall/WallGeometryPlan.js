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
  const normal2 = [-evaluated.tangent[1], evaluated.tangent[0]];
  const lateral = side === 'a' ? wall.thickness / 2 : side === 'b' ? -wall.thickness / 2 : 0;
  const y = side === 'top' ? wall.elevation + wall.height : wall.elevation;
  const normal = side === 'top'
    ? [0, 1, 0]
    : side === 'a'
      ? [normal2[0], 0, normal2[1]]
      : [-normal2[0], 0, -normal2[1]];
  return Object.freeze({
    origin: Object.freeze([
      evaluated.point[0] + normal2[0] * lateral,
      y,
      evaluated.point[1] + normal2[1] * lateral,
    ]),
    tangent: Object.freeze([evaluated.tangent[0], 0, evaluated.tangent[1]]),
    up: Object.freeze([0, 1, 0]),
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
        style: wall.style,
        side: 'a',
        frame: surfaceFrame(wall, segment, 'a'),
      },
      {
        id: `${prefix}:side-b`,
        wallId: wall.id,
        segmentId: segment.id,
        family: 'walls',
        style: wall.style,
        side: 'b',
        frame: surfaceFrame(wall, segment, 'b'),
      },
      {
        id: `${prefix}:top`,
        wallId: wall.id,
        segmentId: segment.id,
        family: wall.topFamily === 'plain' ? 'stone' : 'roof',
        style: wall.style,
        side: 'top',
        frame: surfaceFrame(wall, segment, 'top'),
      },
    );
  }
  return freezeArray(regions);
}

function rpgSemantics(wall, sections) {
  const collisionSlabs = [];
  const foundationContacts = [];
  const coverSurfaces = [];
  const sliceCounts = new Map();
  for (let index = 0; index < sections.length - 1; index += 1) {
    const current = sections[index];
    const next = sections[index + 1];
    const segmentId = current.segmentId === next.segmentId ? current.segmentId : next.segmentId;
    const slice = (sliceCounts.get(segmentId) ?? 0) + 1;
    sliceCounts.set(segmentId, slice);
    const start = current.point;
    const end = next.point;
    const id = `${wall.id}:${segmentId}:slice-${slice}`;
    collisionSlabs.push({
      id,
      wallId: wall.id,
      segmentId,
      start,
      end,
      elevation: wall.elevation,
      height: wall.height,
      thickness: wall.thickness,
      gaps: Object.freeze([]),
    });
    foundationContacts.push({
      id: `${id}:contact`,
      wallId: wall.id,
      segmentId,
      start,
      end,
      thickness: wall.thickness,
      elevation: wall.elevation,
    });
    coverSurfaces.push({
      id: `${id}:cover`,
      wallId: wall.id,
      segmentId,
      start,
      end,
      height: wall.elevation + wall.height,
      thickness: wall.thickness,
    });
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
    revisionKey: JSON.stringify([serializedWall, sections.map(({ distance, point, tangent, miterRatio }) => (
      [distance, point, tangent, miterRatio]
    ))]),
  });
}
