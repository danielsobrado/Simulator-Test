import { MeshBVH, CENTER } from 'three-mesh-bvh';
import { createColliderPrototype } from '../colliders/ColliderRecords.js';

const MINIMUM_TRIANGLE_AREA_SQUARED = 1e-16;

function triangleCount(geometry) {
  const index = geometry.getIndex?.();
  const position = geometry.getAttribute?.('position');
  if (!position) throw new Error('Mesh collision proxy requires a position attribute.');
  const count = index ? index.count : position.count;
  if (!Number.isSafeInteger(count) || count < 3 || count % 3 !== 0) {
    throw new Error('Mesh collision proxy must contain complete triangles.');
  }
  return count / 3;
}

function vertex(position, index, out) {
  out.x = position.getX(index);
  out.y = position.getY(index);
  out.z = position.getZ(index);
  if (![out.x, out.y, out.z].every(Number.isFinite)) {
    throw new Error('Mesh collision proxy contains non-finite positions.');
  }
  return out;
}

function validateTriangles(geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const c = { x: 0, y: 0, z: 0 };
  const count = index ? index.count : position.count;
  for (let offset = 0; offset < count; offset += 3) {
    const ia = index ? index.getX(offset) : offset;
    const ib = index ? index.getX(offset + 1) : offset + 1;
    const ic = index ? index.getX(offset + 2) : offset + 2;
    vertex(position, ia, a);
    vertex(position, ib, b);
    vertex(position, ic, c);
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const abZ = b.z - a.z;
    const acX = c.x - a.x;
    const acY = c.y - a.y;
    const acZ = c.z - a.z;
    const crossX = abY * acZ - abZ * acY;
    const crossY = abZ * acX - abX * acZ;
    const crossZ = abX * acY - abY * acX;
    const areaSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
    if (areaSquared <= MINIMUM_TRIANGLE_AREA_SQUARED) {
      throw new Error(`Mesh collision proxy contains a degenerate triangle at ${offset / 3}.`);
    }
  }
}

function canonicalBounds(box) {
  return {
    minX: box.min.x,
    minY: box.min.y,
    minZ: box.min.z,
    maxX: box.max.x,
    maxY: box.max.y,
    maxZ: box.max.z,
  };
}

export function createMeshColliderPrototype({
  id,
  geometry,
  maximumTriangles,
  maxLeafTriangles = 4,
  metadata = {},
}) {
  if (!geometry?.clone) throw new Error('Mesh collision prototype requires BufferGeometry.');
  if (!Number.isSafeInteger(maximumTriangles) || maximumTriangles < 1) {
    throw new Error('Mesh collision maximumTriangles must be a positive integer.');
  }
  if (!Number.isSafeInteger(maxLeafTriangles) || maxLeafTriangles < 1) {
    throw new Error('Mesh collision maxLeafTriangles must be a positive integer.');
  }

  const proxy = geometry.clone();
  proxy.computeBoundingBox();
  const bounds = proxy.boundingBox;
  if (!bounds || bounds.isEmpty()) {
    proxy.dispose();
    throw new Error(`Mesh collision prototype ${id} has empty bounds.`);
  }
  const triangles = triangleCount(proxy);
  if (triangles > maximumTriangles) {
    proxy.dispose();
    throw new Error(
      `Mesh collision prototype ${id} has ${triangles} triangles; maximum is ${maximumTriangles}.`,
    );
  }
  validateTriangles(proxy);

  const bvh = new MeshBVH(proxy, {
    strategy: CENTER,
    targetLeafSize: maxLeafTriangles,
    indirect: true,
  });
  const resource = {
    geometry: proxy,
    bvh,
    triangleCount: triangles,
    disposed: false,
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.bvh?.dispose?.();
      this.geometry?.dispose?.();
    },
  };

  return createColliderPrototype({
    id,
    kind: 'mesh-bvh',
    bounds: canonicalBounds(bounds),
    metadata: { ...metadata, triangleCount: triangles },
    resource,
  });
}
