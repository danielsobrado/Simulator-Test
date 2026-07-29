import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pointOnQuad,
  reliefQuadPrism,
} from '../src/editor/construction/compile/ConstructionReliefQuadPrism.js';
import { sampleStoneFaceRelief } from '../src/editor/construction/masonry/StoneFaceReliefField.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import {
  beveledQuadPrism,
  createBeveledQuadProfile,
} from '../src/editor/workshop/ProceduralWorkshopGeometry.js';

const soft = constructionStoneReliefProfile('soft-limestone-rubble');

function rectangle(width, height) {
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
}

function bounds(geometry) {
  const position = geometry.getAttribute('position');
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < position.count; index += 1) {
    const values = [position.getX(index), position.getY(index), position.getZ(index)];
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], values[axis]);
      high[axis] = Math.max(high[axis], values[axis]);
    }
  }
  return [...low, ...high];
}

function triangles(geometry) {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

function samplePair({
  width = 0.6,
  height = 0.32,
  depth = 0.8,
  bevelRatio = 0.085,
  corners = rectangle(width, height),
  seed = 3141,
  stableIndex = 9,
} = {}) {
  const { radius } = createBeveledQuadProfile({ corners, depth, bevelRatio });
  const args = {
    profile: soft,
    seed,
    stableIndex,
    category: 'field',
    width,
    height,
    bevelRadius: radius,
    mortarFaceRecess: 0.035,
  };
  return {
    corners,
    depth,
    bevelRatio,
    radius,
    frontRelief: sampleStoneFaceRelief({ ...args, side: 'front' }),
    backRelief: sampleStoneFaceRelief({ ...args, side: 'back' }),
  };
}

function assertFixture(label, corners, depth = 0.8, bevelRatio = 0.085) {
  const width = Math.max(...corners.map(([x]) => x)) - Math.min(...corners.map(([x]) => x));
  const height = Math.max(...corners.map(([, y]) => y)) - Math.min(...corners.map(([, y]) => y));
  const pair = samplePair({ corners, width, height, depth, bevelRatio });
  assert.equal(pair.frontRelief.enabled, true, `${label}: front relief`);
  assert.equal(pair.backRelief.enabled, true, `${label}: back relief`);

  const built = reliefQuadPrism({
    corners,
    depth,
    bevelRatio,
    frontRelief: pair.frontRelief,
    backRelief: pair.backRelief,
  });
  assert.equal(built.reliefApplied, true, `${label}: relief applied`);
  assert.equal(built.reliefFallback, false, `${label}: no fallback`);

  const geometry = built.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  assert.ok(position && normal && uv);

  for (let index = 0; index < position.count; index += 1) {
    assert.ok(Number.isFinite(position.getX(index)));
    assert.ok(Number.isFinite(position.getY(index)));
    assert.ok(Number.isFinite(position.getZ(index)));
    assert.ok(Number.isFinite(normal.getX(index)));
    assert.ok(Number.isFinite(normal.getY(index)));
    assert.ok(Number.isFinite(normal.getZ(index)));
    assert.ok(Number.isFinite(uv.getX(index)));
    assert.ok(Number.isFinite(uv.getY(index)));
    assert.ok(Math.abs(position.getZ(index)) <= depth / 2 + 1e-5);
  }

  // Non-indexed: every three vertices are a triangle.
  for (let index = 0; index < position.count; index += 3) {
    const ax = position.getX(index);
    const ay = position.getY(index);
    const az = position.getZ(index);
    const bx = position.getX(index + 1);
    const by = position.getY(index + 1);
    const bz = position.getZ(index + 1);
    const cx = position.getX(index + 2);
    const cy = position.getY(index + 2);
    const cz = position.getZ(index + 2);
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const area = 0.5 * Math.hypot(
      aby * acz - abz * acy,
      abz * acx - abx * acz,
      abx * acy - aby * acx,
    );
    assert.ok(area > 1e-12, `${label}: positive triangle area`);
  }

  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds(geometry);
  const sourceMinX = Math.min(...corners.map(([x]) => x));
  const sourceMaxX = Math.max(...corners.map(([x]) => x));
  const sourceMinY = Math.min(...corners.map(([, y]) => y));
  const sourceMaxY = Math.max(...corners.map(([, y]) => y));
  assert.ok(minX >= sourceMinX - 1e-5);
  assert.ok(maxX <= sourceMaxX + 1e-5);
  assert.ok(minY >= sourceMinY - 1e-5);
  assert.ok(maxY <= sourceMaxY + 1e-5);
  assert.ok(minZ >= -depth / 2 - 1e-5);
  assert.ok(maxZ <= depth / 2 + 1e-5);
  assert.ok(Math.abs((maxZ - minZ) - depth) < 1e-4 || maxZ - minZ <= depth + 1e-5);

  const columns = pair.frontRelief.columns;
  const rows = pair.frontRelief.rows;
  const faceTriangles = columns * rows * 2 * 2;
  const bevelTriangles = corners.length * 2 * 2;
  const sideTriangles = corners.length * 2;
  assert.equal(triangles(geometry), faceTriangles + bevelTriangles + sideTriangles);

  geometry.dispose();
  return pair;
}

test('pointOnQuad bilinear interpolation hits corners', () => {
  const corners = rectangle(1, 0.5);
  assert.deepEqual(pointOnQuad(corners, 0, 0), corners[0]);
  assert.deepEqual(pointOnQuad(corners, 1, 0), corners[1]);
  assert.deepEqual(pointOnQuad(corners, 1, 1), corners[2]);
  assert.deepEqual(pointOnQuad(corners, 0, 1), corners[3]);
});

test('rectangular quad relief stays inside nominal bounds', () => {
  assertFixture('rectangle', rectangle(0.72, 0.36));
});

test('sloped quad relief stays inside nominal bounds', () => {
  assertFixture('sloped', [
    [-0.4, -0.2],
    [0.42, -0.18],
    [0.38, 0.22],
    [-0.36, 0.2],
  ]);
});

test('tilted head-joint quad relief stays inside nominal bounds', () => {
  assertFixture('tilted', [
    [-0.5, -0.22],
    [0.48, -0.28],
    [0.52, 0.24],
    [-0.46, 0.3],
  ]);
});

test('front and back have different broad shapes', () => {
  const pair = samplePair();
  const built = reliefQuadPrism({
    corners: pair.corners,
    depth: pair.depth,
    bevelRatio: pair.bevelRatio,
    frontRelief: pair.frontRelief,
    backRelief: pair.backRelief,
  });
  assert.notDeepEqual(pair.frontRelief, pair.backRelief);
  // Centre vertices on each face should sit at different absolute Z offsets
  // only through recession differences — both near ±depth/2.
  const position = built.geometry.getAttribute('position');
  let maxZ = -Infinity;
  let minZ = Infinity;
  for (let index = 0; index < position.count; index += 1) {
    maxZ = Math.max(maxZ, position.getZ(index));
    minZ = Math.min(minZ, position.getZ(index));
  }
  assert.ok(maxZ > pair.depth / 2 - pair.frontRelief.edgeRecession - 1e-4);
  assert.ok(minZ < -pair.depth / 2 + pair.backRelief.edgeRecession + 1e-4);
  built.geometry.dispose();
});

test('outer ring XY remains unchanged versus flat bevel prism', () => {
  const corners = rectangle(0.7, 0.34);
  const depth = 0.8;
  const bevelRatio = 0.09;
  const pair = samplePair({ corners, width: 0.7, height: 0.34, depth, bevelRatio });
  const flat = beveledQuadPrism({ corners, depth, bevelRatio });
  const relief = reliefQuadPrism({
    corners,
    depth,
    bevelRatio,
    frontRelief: pair.frontRelief,
    backRelief: pair.backRelief,
  });
  const flatBounds = bounds(flat);
  const reliefBounds = bounds(relief.geometry);
  assert.ok(Math.abs(flatBounds[0] - reliefBounds[0]) < 1e-5);
  assert.ok(Math.abs(flatBounds[1] - reliefBounds[1]) < 1e-5);
  assert.ok(Math.abs(flatBounds[3] - reliefBounds[3]) < 1e-5);
  assert.ok(Math.abs(flatBounds[4] - reliefBounds[4]) < 1e-5);
  flat.dispose();
  relief.geometry.dispose();
});

test('grid boundary matches the inset profile', () => {
  const corners = rectangle(0.64, 0.3);
  const depth = 0.75;
  const bevelRatio = 0.08;
  const pair = samplePair({ corners, width: 0.64, height: 0.3, depth, bevelRatio });
  const { profile } = createBeveledQuadProfile({ corners, depth, bevelRatio });
  const built = reliefQuadPrism({
    corners,
    depth,
    bevelRatio,
    frontRelief: pair.frontRelief,
    backRelief: pair.backRelief,
  });
  const position = built.geometry.getAttribute('position');
  const half = depth / 2;
  const edgeZ = half - pair.frontRelief.edgeRecession;
  const hits = [];
  for (let index = 0; index < position.count; index += 1) {
    if (Math.abs(position.getZ(index) - edgeZ) < 1e-4) {
      hits.push([position.getX(index), position.getY(index)]);
    }
  }
  assert.ok(hits.length >= 4);
  for (const [px, py] of profile) {
    const found = hits.some(([x, y]) => Math.hypot(x - px, y - py) < 1e-4);
    assert.ok(found, 'profile corner present on face boundary');
  }
  built.geometry.dispose();
});

test('fallback produces valid bevelled geometry', () => {
  const corners = rectangle(0.5, 0.01);
  const built = reliefQuadPrism({
    corners,
    depth: 0.8,
    bevelRatio: 0.2,
    frontRelief: {
      enabled: true,
      columns: 3,
      rows: 2,
      edgeRecession: 0.05,
      tiltU: 0,
      tiltV: 0,
      saddle: 0,
      edgeFalloffPower: 1.5,
    },
    backRelief: {
      enabled: true,
      columns: 3,
      rows: 2,
      edgeRecession: 0.05,
      tiltU: 0,
      tiltV: 0,
      saddle: 0,
      edgeFalloffPower: 1.5,
    },
  });
  assert.equal(built.reliefFallback, true);
  assert.equal(built.reliefApplied, false);
  assert.ok(triangles(built.geometry) > 0);
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds(built.geometry);
  assert.ok(Number.isFinite(minX + minY + minZ + maxX + maxY + maxZ));
  built.geometry.dispose();
});
