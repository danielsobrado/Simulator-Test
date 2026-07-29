import * as THREE from 'three/webgpu';
import {
  applyWorkshopProjectedUv,
  beveledQuadPrism,
  createBeveledQuadProfile,
  normalizeGeometry,
  transformGeometry,
} from '../../workshop/ProceduralWorkshopGeometry.js';
import { faceRecessionAt } from '../masonry/StoneFaceReliefField.js';

const BOUNDS_EPSILON = 1e-5;
const AREA_EPSILON = 1e-12;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/** Bilinear sample over a CCW face quad `[bottomLeft, bottomRight, topRight, topLeft]`. */
export function pointOnQuad(corners, u, v) {
  const [bottomLeft, bottomRight, topRight, topLeft] = corners;
  const bottom = lerpPoint(bottomLeft, bottomRight, u);
  const top = lerpPoint(topLeft, topRight, u);
  return lerpPoint(bottom, top, v);
}

function pushVertex(positions, x, y, z) {
  positions.push(x, y, z);
  return (positions.length / 3) - 1;
}

function pushTriangle(indices, a, b, c) {
  indices.push(a, b, c);
}

function triangleNormal(positions, a, b, c) {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const bx = positions[b * 3];
  const by = positions[b * 3 + 1];
  const bz = positions[b * 3 + 2];
  const cx = positions[c * 3];
  const cy = positions[c * 3 + 1];
  const cz = positions[c * 3 + 2];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  return [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ];
}

function triangleArea(positions, a, b, c) {
  const [nx, ny, nz] = triangleNormal(positions, a, b, c);
  return 0.5 * Math.hypot(nx, ny, nz);
}

function assertFinitePositions(positions) {
  for (const value of positions) {
    if (!Number.isFinite(value)) {
      throw new Error('ConstructionReliefQuadPrism: non-finite position.');
    }
  }
}

function ringBounds(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

function geometryBounds(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox;
}

function validateReliefInputs({ frontRelief, backRelief, radius }) {
  if (!frontRelief?.enabled || !backRelief?.enabled) {
    throw new Error('ConstructionReliefQuadPrism: both faces need enabled relief.');
  }
  if (!(frontRelief.edgeRecession < radius) || !(backRelief.edgeRecession < radius)) {
    throw new Error('ConstructionReliefQuadPrism: edge recession >= bevel radius.');
  }
  if (!(frontRelief.columns >= 2) || !(frontRelief.rows >= 2)) {
    throw new Error('ConstructionReliefQuadPrism: face grid collapses.');
  }
  if (frontRelief.columns !== backRelief.columns || frontRelief.rows !== backRelief.rows) {
    throw new Error('ConstructionReliefQuadPrism: front/back grid mismatch.');
  }
}

function appendFaceGrid({
  positions,
  indices,
  profile,
  depth,
  relief,
  side,
}) {
  const columns = relief.columns;
  const rows = relief.rows;
  const start = positions.length / 3;
  const halfDepth = depth / 2;

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let col = 0; col <= columns; col += 1) {
      const u = col / columns;
      const [x, y] = pointOnQuad(profile, u, v);
      const recession = faceRecessionAt(relief, u, v);
      const z = side === 'front'
        ? halfDepth - recession
        : -halfDepth + recession;
      if (Math.abs(z) > halfDepth + BOUNDS_EPSILON) {
        throw new Error('ConstructionReliefQuadPrism: face exceeds nominal depth.');
      }
      pushVertex(positions, x, y, z);
    }
  }

  const vertsPerRow = columns + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const bl = start + row * vertsPerRow + col;
      const br = bl + 1;
      const tl = bl + vertsPerRow;
      const tr = tl + 1;
      if (side === 'front') {
        pushTriangle(indices, bl, br, tr);
        pushTriangle(indices, bl, tr, tl);
      } else {
        pushTriangle(indices, bl, tr, br);
        pushTriangle(indices, bl, tl, tr);
      }
    }
  }

  return { start, columns, rows, vertsPerRow };
}

function appendBevelStrip({
  positions,
  indices,
  ring,
  profile,
  faceZ,
  sideZ,
  outward,
}) {
  const count = ring.length;
  const start = positions.length / 3;
  for (let index = 0; index < count; index += 1) {
    pushVertex(positions, profile[index][0], profile[index][1], faceZ);
    pushVertex(positions, ring[index][0], ring[index][1], sideZ);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const profileA = start + index * 2;
    const ringA = profileA + 1;
    const profileB = start + next * 2;
    const ringB = profileB + 1;
    if (outward) {
      // Front bevel: face outward toward +Z / away from stone core.
      pushTriangle(indices, profileA, ringA, ringB);
      pushTriangle(indices, profileA, ringB, profileB);
    } else {
      pushTriangle(indices, profileA, profileB, ringB);
      pushTriangle(indices, profileA, ringB, ringA);
    }
  }
}

function appendSideWall({
  positions,
  indices,
  ring,
  frontZ,
  backZ,
}) {
  const count = ring.length;
  const start = positions.length / 3;
  for (let index = 0; index < count; index += 1) {
    pushVertex(positions, ring[index][0], ring[index][1], frontZ);
    pushVertex(positions, ring[index][0], ring[index][1], backZ);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const frontA = start + index * 2;
    const backA = frontA + 1;
    const frontB = start + next * 2;
    const backB = frontB + 1;
    // Outward for a CCW ring: frontA → frontB → backB.
    pushTriangle(indices, frontA, frontB, backB);
    pushTriangle(indices, frontA, backB, backA);
  }
}

function validateTriangles(positions, indices, {
  frontTriangleCount,
  backTriangleCount,
}) {
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const area = triangleArea(positions, a, b, c);
    if (!(area > AREA_EPSILON)) {
      throw new Error('ConstructionReliefQuadPrism: inverted or collapsed triangle.');
    }
    const [nx, ny, nz] = triangleNormal(positions, a, b, c);
    if (![nx, ny, nz].every(Number.isFinite)) {
      throw new Error('ConstructionReliefQuadPrism: non-finite normal.');
    }
  }

  // Spot-check first front / back face triangles for winding.
  const frontNormal = triangleNormal(
    positions,
    indices[0],
    indices[1],
    indices[2],
  );
  if (!(frontNormal[2] > 0)) {
    throw new Error('ConstructionReliefQuadPrism: front winding reversed.');
  }
  const backStart = frontTriangleCount * 3;
  const backNormal = triangleNormal(
    positions,
    indices[backStart],
    indices[backStart + 1],
    indices[backStart + 2],
  );
  if (!(backNormal[2] < 0)) {
    throw new Error('ConstructionReliefQuadPrism: back winding reversed.');
  }
  void backTriangleCount;
}

function buildReliefGeometry({
  corners,
  depth,
  bevelRatio,
  frontRelief,
  backRelief,
}) {
  const solved = createBeveledQuadProfile({ corners, depth, bevelRatio });
  const { ring, profile, radius } = solved;
  validateReliefInputs({ frontRelief, backRelief, radius });

  if (ring.length < 3 || shortestEdge(ring) < 1e-9) {
    throw new Error('ConstructionReliefQuadPrism: zero-length edge.');
  }
  if (!(polygonAreaLocal(ring) > 1e-8)) {
    throw new Error('ConstructionReliefQuadPrism: non-convex or empty ring.');
  }

  const halfDepth = depth / 2;
  const frontSideZ = halfDepth - radius;
  const backSideZ = -halfDepth + radius;
  const frontFaceEdgeZ = halfDepth - frontRelief.edgeRecession;
  const backFaceEdgeZ = -halfDepth + backRelief.edgeRecession;

  const positions = [];
  const indices = [];

  appendFaceGrid({
    positions,
    indices,
    profile,
    depth,
    relief: frontRelief,
    side: 'front',
  });
  const frontTriangleCount = frontRelief.columns * frontRelief.rows * 2;

  appendFaceGrid({
    positions,
    indices,
    profile,
    depth,
    relief: backRelief,
    side: 'back',
  });
  const backTriangleCount = backRelief.columns * backRelief.rows * 2;

  appendBevelStrip({
    positions,
    indices,
    ring,
    profile,
    faceZ: frontFaceEdgeZ,
    sideZ: frontSideZ,
    outward: true,
  });
  appendBevelStrip({
    positions,
    indices,
    ring,
    profile,
    faceZ: backFaceEdgeZ,
    sideZ: backSideZ,
    outward: false,
  });
  appendSideWall({
    positions,
    indices,
    ring,
    frontZ: frontSideZ,
    backZ: backSideZ,
  });

  assertFinitePositions(positions);
  validateTriangles(positions, indices, { frontTriangleCount, backTriangleCount });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const source = ringBounds(ring);
  const box = geometryBounds(geometry);
  if (
    box.min.x < source.minX - BOUNDS_EPSILON
    || box.max.x > source.maxX + BOUNDS_EPSILON
    || box.min.y < source.minY - BOUNDS_EPSILON
    || box.max.y > source.maxY + BOUNDS_EPSILON
    || box.min.z < -halfDepth - BOUNDS_EPSILON
    || box.max.z > halfDepth + BOUNDS_EPSILON
  ) {
    throw new Error('ConstructionReliefQuadPrism: geometry exceeds source bounds.');
  }

  const triangleCount = indices.length / 3;
  return {
    geometry,
    stats: Object.freeze({
      triangleCount,
      vertexCount: positions.length / 3,
      bevelRadius: radius,
      frontEdgeRecession: frontRelief.edgeRecession,
      backEdgeRecession: backRelief.edgeRecession,
    }),
  };
}

function polygonAreaLocal(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
}

function shortestEdge(ring) {
  let shortest = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    shortest = Math.min(shortest, Math.hypot(x1 - x0, y1 - y0));
  }
  return shortest;
}

function flatFallback({
  corners,
  depth,
  position,
  rotation,
  bevelRatio,
  detail,
}) {
  return {
    geometry: beveledQuadPrism({
      corners,
      depth,
      position,
      rotation,
      bevelRatio,
      detail,
    }),
    reliefApplied: false,
    reliefFallback: true,
    stats: null,
  };
}

/**
 * Low-resolution pillowed prism for a lattice stone face.
 *
 * Builds separate vertex sets for front face, back face, bevels and sides so
 * `computeVertexNormals` cannot average the broad face into an inflated balloon.
 */
export function reliefQuadPrism({
  corners,
  depth,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  bevelRatio = 0.055,
  detail = 2,
  frontRelief,
  backRelief,
}) {
  try {
    const built = buildReliefGeometry({
      corners,
      depth,
      bevelRatio,
      frontRelief,
      backRelief,
    });
    // Indexed normals first, then non-indexed for merge compatibility, then
    // world transform, then projected UVs (axes depend on final normals).
    const local = built.geometry;
    const nonIndexed = normalizeGeometry(local);
    transformGeometry(nonIndexed, { position, rotation });
    applyWorkshopProjectedUv(nonIndexed);
    nonIndexed.computeBoundingBox();
    nonIndexed.computeBoundingSphere();
    return {
      geometry: nonIndexed,
      reliefApplied: true,
      reliefFallback: false,
      stats: built.stats,
    };
  } catch {
    return flatFallback({
      corners,
      depth,
      position,
      rotation,
      bevelRatio,
      detail,
    });
  }
}
