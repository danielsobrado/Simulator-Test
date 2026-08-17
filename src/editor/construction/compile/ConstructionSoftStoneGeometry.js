import * as THREE from 'three/webgpu';
import {
  applyWorkshopProjectedUv,
  beveledQuadPrism,
  normalizeGeometry,
  transformGeometry,
} from '../../workshop/ProceduralWorkshopGeometry.js';
import { faceRecessionAt } from '../masonry/StoneFaceReliefField.js';
import { pointOnQuad } from './ConstructionReliefQuadPrism.js';

const BOUNDS_EPSILON = 1e-5;

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

/**
 * Static vertex / index estimates before typed-array allocation.
 */
export function estimateSoftStoneTopology({
  faceGrid,
  bevelRings = 2,
  edgeMidpoints = false,
  flattenedCornerCount = 0,
}) {
  void flattenedCornerCount;
  const columns = Math.max(1, faceGrid?.columns ?? 1);
  const rows = Math.max(1, faceGrid?.rows ?? 1);
  const loopCount = edgeMidpoints ? 8 : 4;
  const rings = bevelRings <= 1 ? 1 : 2;
  // Coarse 1×1 uses four corners + centre (5 verts, 4 tris) per broad face.
  const faceVerts = columns === 1 && rows === 1
    ? 5
    : (columns + 1) * (rows + 1);
  const faceTris = columns === 1 && rows === 1
    ? 4
    : columns * rows * 2;
  const bevelBands = rings;
  const bevelVerts = loopCount * 2 * bevelBands * 2; // front + back
  const sideVerts = loopCount * 2;
  const vertices = faceVerts * 2 + bevelVerts + sideVerts;
  const triangles = faceTris * 2 + loopCount * 2 * bevelBands * 2 + loopCount * 2;
  return Object.freeze({
    vertices,
    indices: triangles * 3,
    triangles,
  });
}

function createBuffers(vertexCount, triangleCount) {
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);
  let positionOffset = 0;
  let indexOffset = 0;
  const writeVertex = (x, y, z) => {
    const index = positionOffset;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    positionOffset += 1;
    return index;
  };
  const writeTriangle = (a, b, c) => {
    indices[indexOffset] = a;
    indices[indexOffset + 1] = b;
    indices[indexOffset + 2] = c;
    indexOffset += 3;
  };
  return {
    positions,
    indices,
    writeVertex,
    writeTriangle,
    get positionOffset() { return positionOffset; },
    get indexOffset() { return indexOffset; },
  };
}

function writeBevelBand(buffers, loopCount, innerLoop, outerLoop, innerZ, outerZ, outward) {
  const start = buffers.positionOffset;
  for (let index = 0; index < loopCount; index += 1) {
    const iz = typeof innerZ === 'number' ? innerZ : innerZ[index];
    const oz = typeof outerZ === 'number' ? outerZ : outerZ[index];
    buffers.writeVertex(innerLoop[index][0], innerLoop[index][1], iz);
    buffers.writeVertex(outerLoop[index][0], outerLoop[index][1], oz);
  }
  for (let index = 0; index < loopCount; index += 1) {
    const next = (index + 1) % loopCount;
    const innerA = start + index * 2;
    const outerA = innerA + 1;
    const innerB = start + next * 2;
    const outerB = innerB + 1;
    if (outward) {
      buffers.writeTriangle(innerA, outerA, outerB);
      buffers.writeTriangle(innerA, outerB, innerB);
    } else {
      buffers.writeTriangle(innerA, innerB, outerB);
      buffers.writeTriangle(innerA, outerB, outerA);
    }
  }
}

function writeSideWalls(buffers, loopCount, frontLoop, backLoop, frontZ, backZ) {
  const start = buffers.positionOffset;
  for (let index = 0; index < loopCount; index += 1) {
    buffers.writeVertex(frontLoop[index][0], frontLoop[index][1], typeof frontZ === 'number' ? frontZ : frontZ[index]);
    buffers.writeVertex(backLoop[index][0], backLoop[index][1], typeof backZ === 'number' ? backZ : backZ[index]);
  }
  for (let index = 0; index < loopCount; index += 1) {
    const next = (index + 1) % loopCount;
    const frontA = start + index * 2;
    const backA = frontA + 1;
    const frontB = start + next * 2;
    const backB = frontB + 1;
    buffers.writeTriangle(frontA, frontB, backB);
    buffers.writeTriangle(frontA, backB, backA);
  }
}

function writeFaceGrid(buffers, faceCorners, relief, side, columns, rows, half) {
  const start = buffers.positionOffset;
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let col = 0; col <= columns; col += 1) {
      const u = col / columns;
      const [x, y] = pointOnQuad(faceCorners, u, v);
      const recession = faceRecessionAt(relief, u, v);
      const z = side === 'front' ? half - recession : -half + recession;
      if (Math.abs(z) > half + BOUNDS_EPSILON) {
        throw new Error('ConstructionSoftStoneGeometry: face exceeds nominal depth.');
      }
      buffers.writeVertex(x, y, z);
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
        buffers.writeTriangle(bl, br, tr);
        buffers.writeTriangle(bl, tr, tl);
      } else {
        buffers.writeTriangle(bl, tr, br);
        buffers.writeTriangle(bl, tl, tr);
      }
    }
  }
}

/** Four corners + centre → four triangles for coarse broad faces. */
function writeCoarseFace(buffers, faceCorners, relief, side, half) {
  const corners = [];
  for (let index = 0; index < 4; index += 1) {
    const u = index === 1 || index === 2 ? 1 : 0;
    const v = index === 2 || index === 3 ? 1 : 0;
    const [x, y] = faceCorners[index];
    const recession = faceRecessionAt(relief, u, v);
    const z = side === 'front' ? half - recession : -half + recession;
    if (Math.abs(z) > half + BOUNDS_EPSILON) {
      throw new Error('ConstructionSoftStoneGeometry: face exceeds nominal depth.');
    }
    corners.push(buffers.writeVertex(x, y, z));
  }
  const centreRecession = faceRecessionAt(relief, 0.5, 0.5);
  const [cx, cy] = pointOnQuad(faceCorners, 0.5, 0.5);
  const cz = side === 'front' ? half - centreRecession : -half + centreRecession;
  if (Math.abs(cz) > half + BOUNDS_EPSILON) {
    throw new Error('ConstructionSoftStoneGeometry: centre exceeds nominal depth.');
  }
  const centre = buffers.writeVertex(cx, cy, cz);
  // corners: 0 BL, 1 BR, 2 TR, 3 TL
  if (side === 'front') {
    buffers.writeTriangle(corners[0], corners[1], centre);
    buffers.writeTriangle(corners[1], corners[2], centre);
    buffers.writeTriangle(corners[2], corners[3], centre);
    buffers.writeTriangle(corners[3], corners[0], centre);
  } else {
    buffers.writeTriangle(corners[0], centre, corners[1]);
    buffers.writeTriangle(corners[1], centre, corners[2]);
    buffers.writeTriangle(corners[2], centre, corners[3]);
    buffers.writeTriangle(corners[3], centre, corners[0]);
  }
}

function finalizeGeometry(buffers, topology, vertexCount, triangleCount, faceTris) {
  if (buffers.positionOffset !== vertexCount || buffers.indexOffset !== triangleCount * 3) {
    throw new Error('ConstructionSoftStoneGeometry: buffer size mismatch.');
  }

  const { positions, indices } = buffers;
  const frontNormal = triangleNormal(positions, indices[0], indices[1], indices[2]);
  if (!(frontNormal[2] > 0)) {
    throw new Error('ConstructionSoftStoneGeometry: front winding reversed.');
  }
  const backStart = faceTris * 3;
  const backNormal = triangleNormal(
    positions,
    indices[backStart],
    indices[backStart + 1],
    indices[backStart + 2],
  );
  if (!(backNormal[2] < 0)) {
    throw new Error('ConstructionSoftStoneGeometry: back winding reversed.');
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const half = topology.depth / 2;
  const source = ringBounds(topology.sourceRing);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (
    box.min.x < source.minX - BOUNDS_EPSILON
    || box.max.x > source.maxX + BOUNDS_EPSILON
    || box.min.y < source.minY - BOUNDS_EPSILON
    || box.max.y > source.maxY + BOUNDS_EPSILON
    || box.min.z < -half - BOUNDS_EPSILON
    || box.max.z > half + BOUNDS_EPSILON
  ) {
    throw new Error('ConstructionSoftStoneGeometry: geometry exceeds source bounds.');
  }

  return {
    geometry,
    stats: Object.freeze({
      triangleCount,
      vertexCount,
      frontFaceTriangles: faceTris,
      backFaceTriangles: faceTris,
      flattenedCorners: topology.front.flattenedCorners + topology.back.flattenedCorners,
      edgeMidpoints: Boolean(topology.diagnostics?.edgeMidpointsApplied),
      areaRatio: topology.diagnostics.areaRatio,
    }),
  };
}

function buildNearSoftStone(topology) {
  const { front, back } = topology;
  if (!front.relief?.enabled || !back.relief?.enabled) {
    throw new Error('ConstructionSoftStoneGeometry: relief required.');
  }
  const half = topology.depth / 2;
  const columns = front.relief.columns;
  const rows = front.relief.rows;
  const bevelRings = topology.bevelRings ?? 2;
  if (bevelRings !== 2) {
    throw new Error(
      `ConstructionSoftStoneGeometry: near soft stone expects bevelRings=2, got ${bevelRings}.`,
    );
  }
  const loopCount = front.sourceLoop.length;
  if (back.sourceLoop.length !== loopCount) {
    throw new Error('ConstructionSoftStoneGeometry: front/back loop counts differ.');
  }
  const estimate = estimateSoftStoneTopology({
    faceGrid: { columns, rows },
    bevelRings: 2,
    edgeMidpoints: loopCount > 4,
  });
  const buffers = createBuffers(estimate.vertices, estimate.triangles);

  writeFaceGrid(buffers, front.faceCorners, front.relief, 'front', columns, rows, half);
  writeFaceGrid(buffers, back.faceCorners, back.relief, 'back', columns, rows, half);

  const frontFaceEdgeZ = half - front.faceEdgeRecession;
  const backFaceEdgeZ = -half + back.faceEdgeRecession;
  const frontShoulderZ = front.shoulderDepths.map((value) => half - value);
  const frontOuterZ = front.outerDepths.map((value) => half - value);
  const backShoulderZ = back.shoulderDepths.map((value) => -half + value);
  const backOuterZ = back.outerDepths.map((value) => -half + value);

  writeBevelBand(buffers, loopCount, front.faceLoop, front.shoulderLoop, frontFaceEdgeZ, frontShoulderZ, true);
  writeBevelBand(buffers, loopCount, front.shoulderLoop, front.sourceLoop, frontShoulderZ, frontOuterZ, true);
  writeBevelBand(buffers, loopCount, back.faceLoop, back.shoulderLoop, backFaceEdgeZ, backShoulderZ, false);
  writeBevelBand(buffers, loopCount, back.shoulderLoop, back.sourceLoop, backShoulderZ, backOuterZ, false);
  writeSideWalls(buffers, loopCount, front.sourceLoop, back.sourceLoop, frontOuterZ, backOuterZ);

  const faceTris = columns * rows * 2;
  return finalizeGeometry(buffers, topology, estimate.vertices, estimate.triangles, faceTris);
}

function buildCoarseSoftStone(topology) {
  const { front, back } = topology;
  if (!front.relief?.enabled || !back.relief?.enabled) {
    throw new Error('ConstructionSoftStoneGeometry: relief required.');
  }
  const half = topology.depth / 2;
  const loopCount = front.sourceLoop.length;
  if (back.sourceLoop.length !== loopCount) {
    throw new Error('ConstructionSoftStoneGeometry: front/back loop counts differ.');
  }
  const estimate = estimateSoftStoneTopology({
    faceGrid: { columns: 1, rows: 1 },
    bevelRings: 1,
    edgeMidpoints: loopCount > 4,
  });
  const buffers = createBuffers(estimate.vertices, estimate.triangles);

  writeCoarseFace(buffers, front.faceCorners, front.relief, 'front', half);
  writeCoarseFace(buffers, back.faceCorners, back.relief, 'back', half);

  const frontFaceEdgeZ = half - front.faceEdgeRecession;
  const backFaceEdgeZ = -half + back.faceEdgeRecession;
  const frontOuterZ = front.outerDepths.map((value) => half - value);
  const backOuterZ = back.outerDepths.map((value) => -half + value);

  writeBevelBand(buffers, loopCount, front.faceLoop, front.sourceLoop, frontFaceEdgeZ, frontOuterZ, true);
  writeBevelBand(buffers, loopCount, back.faceLoop, back.sourceLoop, backFaceEdgeZ, backOuterZ, false);
  writeSideWalls(buffers, loopCount, front.sourceLoop, back.sourceLoop, frontOuterZ, backOuterZ);

  return finalizeGeometry(buffers, topology, estimate.vertices, estimate.triangles, 4);
}

function flatFallback(stoneShape) {
  return {
    geometry: beveledQuadPrism({
      corners: stoneShape.corners,
      depth: stoneShape.depth,
      position: stoneShape.position,
      rotation: stoneShape.rotation,
      bevelRatio: stoneShape.bevelRatio,
      detail: stoneShape.detail,
    }),
    reliefApplied: false,
    reliefFallback: true,
    edgeWearApplied: false,
    edgeWearFallback: true,
    geometryTier: 'legacy',
    stats: null,
  };
}

/**
 * Soft limestone writer for near and coarse geometry tiers.
 */
export function buildSoftStoneGeometry({
  topology,
  stoneShape,
  geometryTier = 'near',
  position = stoneShape?.position ?? [0, 0, 0],
  rotation = stoneShape?.rotation ?? [0, 0, 0],
}) {
  try {
    if (!topology?.valid) {
      return flatFallback(stoneShape);
    }
    let built;
    switch (geometryTier) {
      case 'near':
        built = buildNearSoftStone(topology);
        break;
      case 'coarse':
        built = buildCoarseSoftStone(topology);
        break;
      default:
        throw new Error(`Unknown soft-stone geometry tier ${geometryTier}.`);
    }
    const nonIndexed = normalizeGeometry(built.geometry);
    transformGeometry(nonIndexed, { position, rotation });
    applyWorkshopProjectedUv(nonIndexed);
    nonIndexed.computeBoundingBox();
    nonIndexed.computeBoundingSphere();
    return {
      geometry: nonIndexed,
      reliefApplied: true,
      reliefFallback: false,
      edgeWearApplied: true,
      edgeWearFallback: false,
      geometryTier,
      stats: Object.freeze({
        ...built.stats,
        variableInsetClamped: Boolean(topology.diagnostics?.variableInsetClamped),
        geometryTier,
      }),
    };
  } catch {
    return flatFallback(stoneShape);
  }
}
