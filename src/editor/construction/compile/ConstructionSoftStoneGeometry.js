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

function buildFromTopology(topology) {
  const {
    sourceRing,
    depth,
    front,
    back,
  } = topology;
  if (!front.relief?.enabled || !back.relief?.enabled) {
    throw new Error('ConstructionSoftStoneGeometry: relief required.');
  }

  const half = depth / 2;
  const columns = front.relief.columns;
  const rows = front.relief.rows;
  const faceVerts = (columns + 1) * (rows + 1);
  const faceTris = columns * rows * 2;
  const loopCount = front.sourceLoop.length;
  // face×2 + 4 bevel bands + side wall
  const bevelVerts = loopCount * 2 * 4;
  const sideVerts = loopCount * 2;
  const vertexCount = faceVerts * 2 + bevelVerts + sideVerts;
  const triangleCount = faceTris * 2 + loopCount * 2 * 4 + loopCount * 2;

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

  const writeFaceGrid = (faceCorners, relief, side) => {
    const start = positionOffset;
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
        writeVertex(x, y, z);
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
          writeTriangle(bl, br, tr);
          writeTriangle(bl, tr, tl);
        } else {
          writeTriangle(bl, tr, br);
          writeTriangle(bl, tl, tr);
        }
      }
    }
  };

  const writeBevelBand = (innerLoop, outerLoop, innerZ, outerZ, outward) => {
    const start = positionOffset;
    for (let index = 0; index < loopCount; index += 1) {
      const iz = typeof innerZ === 'number' ? innerZ : innerZ[index];
      const oz = typeof outerZ === 'number' ? outerZ : outerZ[index];
      writeVertex(innerLoop[index][0], innerLoop[index][1], iz);
      writeVertex(outerLoop[index][0], outerLoop[index][1], oz);
    }
    for (let index = 0; index < loopCount; index += 1) {
      const next = (index + 1) % loopCount;
      const innerA = start + index * 2;
      const outerA = innerA + 1;
      const innerB = start + next * 2;
      const outerB = innerB + 1;
      if (outward) {
        writeTriangle(innerA, outerA, outerB);
        writeTriangle(innerA, outerB, innerB);
      } else {
        writeTriangle(innerA, innerB, outerB);
        writeTriangle(innerA, outerB, outerA);
      }
    }
  };

  writeFaceGrid(front.faceCorners, front.relief, 'front');
  writeFaceGrid(back.faceCorners, back.relief, 'back');

  const frontFaceEdgeZ = half - front.faceEdgeRecession;
  const backFaceEdgeZ = -half + back.faceEdgeRecession;
  const frontShoulderZ = front.shoulderDepths.map((value) => half - value);
  const frontOuterZ = front.outerDepths.map((value) => half - value);
  const backShoulderZ = back.shoulderDepths.map((value) => -half + value);
  const backOuterZ = back.outerDepths.map((value) => -half + value);

  writeBevelBand(front.faceLoop, front.shoulderLoop, frontFaceEdgeZ, frontShoulderZ, true);
  writeBevelBand(front.shoulderLoop, front.sourceLoop, frontShoulderZ, frontOuterZ, true);
  writeBevelBand(back.faceLoop, back.shoulderLoop, backFaceEdgeZ, backShoulderZ, false);
  writeBevelBand(back.shoulderLoop, back.sourceLoop, backShoulderZ, backOuterZ, false);

  {
    const start = positionOffset;
    for (let index = 0; index < loopCount; index += 1) {
      writeVertex(front.sourceLoop[index][0], front.sourceLoop[index][1], frontOuterZ[index]);
      writeVertex(back.sourceLoop[index][0], back.sourceLoop[index][1], backOuterZ[index]);
    }
    for (let index = 0; index < loopCount; index += 1) {
      const next = (index + 1) % loopCount;
      const frontA = start + index * 2;
      const backA = frontA + 1;
      const frontB = start + next * 2;
      const backB = frontB + 1;
      writeTriangle(frontA, frontB, backB);
      writeTriangle(frontA, backB, backA);
    }
  }

  if (positionOffset !== vertexCount || indexOffset !== triangleCount * 3) {
    throw new Error('ConstructionSoftStoneGeometry: buffer size mismatch.');
  }

  // Spot-check winding on first front / back face triangles.
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

  const source = ringBounds(sourceRing);
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
      flattenedCorners: front.flattenedCorners + back.flattenedCorners,
      areaRatio: topology.diagnostics.areaRatio,
    }),
  };
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
    stats: null,
  };
}

/**
 * Authoritative near-LOD soft limestone writer.
 *
 * Avoids ExtrudeGeometry; builds typed arrays from a resolved topology.
 */
export function buildSoftStoneGeometry({
  topology,
  stoneShape,
  position = stoneShape?.position ?? [0, 0, 0],
  rotation = stoneShape?.rotation ?? [0, 0, 0],
}) {
  try {
    if (!topology?.valid) {
      return flatFallback(stoneShape);
    }
    const built = buildFromTopology(topology);
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
      stats: Object.freeze({
        ...built.stats,
        variableInsetClamped: Boolean(topology.diagnostics?.variableInsetClamped),
      }),
    };
  } catch {
    return flatFallback(stoneShape);
  }
}
