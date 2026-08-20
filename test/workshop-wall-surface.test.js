import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWallEndpointJoins } from '../src/editor/workshop/geometry/wall/WallJoins.js';
import { planWall } from '../src/editor/workshop/geometry/wall/WallPlanner.js';
import {
  projectPointToWallSurface,
  wallSurfaceCoordinateToPoint,
} from '../src/editor/workshop/geometry/wall/WallSurfaceProjection.js';

function wall(id, start, end) {
  return {
    version: 1,
    id,
    path: {
      version: 1,
      id,
      closed: false,
      points: [
        { id: 'start', position: start },
        { id: 'end', position: end },
      ],
      segments: [{ id: 'main', kind: 'line', startId: 'start', endId: 'end' }],
    },
    elevation: 0,
    height: 4,
    thickness: 0.5,
    profile: 'rect',
    topFamily: 'plain',
  };
}

test('wall surface coordinates survive compatible path edits', () => {
  const before = wall('wall-a', [0, 0], [4, 0]);
  const coordinate = projectPointToWallSurface(before, [2, 1.5, 0.25]);
  assert.equal(coordinate.segmentId, 'main');
  assert.equal(coordinate.side, 'a');
  assert.equal(coordinate.surfaceId, 'wall-a:main:side-a');
  assert.ok(Math.abs(coordinate.segmentParameter - 0.5) < 1e-9);
  assert.deepEqual(wallSurfaceCoordinateToPoint(before, coordinate), [2, 1.5, 0.25]);

  const after = wall('wall-a', [0, 0], [6, 0]);
  assert.deepEqual(wallSurfaceCoordinateToPoint(after, coordinate), [3, 1.5, 0.25]);
});

test('shared wall endpoint joins have stable semantic identity', () => {
  const first = planWall(wall('wall-a', [0, 0], [4, 0]));
  const second = planWall(wall('wall-b', [4, 0], [4, 5]));
  assert.deepEqual(first.surfaceDomains.map(({ id }) => id), [
    'wall-a:main:side-a',
    'wall-a:main:side-b',
    'wall-a:main:top',
  ]);
  assert.deepEqual(first.surfaceDomains[0].frame.tangent, [1, 0, 0]);
  const joins = resolveWallEndpointJoins([second, first]);
  assert.equal(joins.length, 1);
  assert.deepEqual(joins[0].socketIds, ['wall-a:end', 'wall-b:start']);
  assert.equal(joins[0].id, 'join:wall-a:end+wall-b:start');

  const editedSecond = planWall(wall('wall-b', [4, 0], [6, 5]));
  assert.equal(resolveWallEndpointJoins([first, editedSecond])[0].id, joins[0].id);
});
