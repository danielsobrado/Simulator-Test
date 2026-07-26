import crypto from 'node:crypto';

const COMPONENT_BYTES = Object.freeze({
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
});
const TYPE_COMPONENTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});
const IDENTITY_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

export function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function readGlbJson(bytes, filePath = 'GLB') {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67
      || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`${filePath} is not a complete GLB 2.0 file.`);
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length;
  }
  throw new Error(`${filePath} contains no GLB JSON document.`);
}

function primitiveTriangleCount(json, primitive) {
  const count = json.accessors?.[primitive.indices]?.count
    ?? json.accessors?.[primitive.attributes?.POSITION]?.count
    ?? 0;
  const mode = primitive.mode ?? 4;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

export function triangleCount(json) {
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      triangles += primitiveTriangleCount(json, primitive);
    }
  }
  return triangles;
}

export function renderedTriangleCount(json) {
  const meshTriangles = (json.meshes ?? []).map((mesh) => {
    let triangles = 0;
    for (const primitive of mesh.primitives ?? []) {
      triangles += primitiveTriangleCount(json, primitive);
    }
    return triangles;
  });
  const countNode = (nodeIndex, ancestors = new Set()) => {
    if (ancestors.has(nodeIndex)) throw new Error('GLB node graph contains a cycle.');
    const node = json.nodes?.[nodeIndex];
    if (!node) return 0;
    const nextAncestors = new Set(ancestors).add(nodeIndex);
    const instancingAttributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    const firstAccessor = Object.values(instancingAttributes ?? {})[0];
    const instanceCount = Number.isInteger(firstAccessor)
      ? (json.accessors?.[firstAccessor]?.count ?? 1)
      : 1;
    const ownTriangles = Number.isInteger(node.mesh)
      ? (meshTriangles[node.mesh] ?? 0) * instanceCount
      : 0;
    return ownTriangles + (node.children ?? []).reduce(
      (sum, childIndex) => sum + countNode(childIndex, nextAncestors),
      0,
    );
  };
  return (json.scenes ?? []).reduce(
    (sum, scene) => sum + (scene.nodes ?? []).reduce(
      (sceneSum, nodeIndex) => sceneSum + countNode(nodeIndex),
      0,
    ),
    0,
  );
}

function accessorByteLength(accessor) {
  return (accessor.count ?? 0)
    * (TYPE_COMPONENTS[accessor.type] ?? 0)
    * (COMPONENT_BYTES[accessor.componentType] ?? 0);
}

function geometryAccessorIndices(json) {
  const indices = new Set();
  const vertices = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (Number.isInteger(primitive.indices)) indices.add(primitive.indices);
      for (const accessorIndex of Object.values(primitive.attributes ?? {})) {
        if (Number.isInteger(accessorIndex)) vertices.add(accessorIndex);
      }
      for (const target of primitive.targets ?? []) {
        for (const accessorIndex of Object.values(target)) {
          if (Number.isInteger(accessorIndex)) vertices.add(accessorIndex);
        }
      }
    }
  }
  return { indices, vertices };
}

function multiplyMatrices(a, b) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[row + column * 4] += a[row + index * 4] * b[index + column * 4];
      }
    }
  }
  return result;
}

function nodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function expandBounds(bounds, point) {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
}

function normalizeBounds(bounds) {
  if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) return null;
  return {
    min: bounds.min.map((value) => (Object.is(value, -0) ? 0 : value)),
    max: bounds.max.map((value) => (Object.is(value, -0) ? 0 : value)),
  };
}

export function sceneBounds(json) {
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  const visit = (nodeIndex, parentMatrix, ancestors = new Set()) => {
    if (ancestors.has(nodeIndex)) throw new Error('GLB node graph contains a cycle.');
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const worldMatrix = multiplyMatrices(parentMatrix, nodeMatrix(node));
    if (Number.isInteger(node.mesh)) {
      for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
        const position = json.accessors?.[primitive.attributes?.POSITION];
        if (!position?.min || !position?.max) continue;
        for (const x of [position.min[0], position.max[0]]) {
          for (const y of [position.min[1], position.max[1]]) {
            for (const z of [position.min[2], position.max[2]]) {
              expandBounds(bounds, transformPoint(worldMatrix, x, y, z));
            }
          }
        }
      }
    }
    const nextAncestors = new Set(ancestors).add(nodeIndex);
    for (const childIndex of node.children ?? []) {
      visit(childIndex, worldMatrix, nextAncestors);
    }
  };
  for (const scene of json.scenes ?? []) {
    for (const nodeIndex of scene.nodes ?? []) visit(nodeIndex, IDENTITY_MATRIX);
  }
  return normalizeBounds(bounds);
}

function renderedMaterialStats(json) {
  const triangleCounts = new Map();
  let drawParts = 0;
  const visit = (nodeIndex, ancestors = new Set()) => {
    if (ancestors.has(nodeIndex)) throw new Error('GLB node graph contains a cycle.');
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const instancingAttributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    const firstAccessor = Object.values(instancingAttributes ?? {})[0];
    const instanceCount = Number.isInteger(firstAccessor)
      ? (json.accessors?.[firstAccessor]?.count ?? 1)
      : 1;
    if (Number.isInteger(node.mesh)) {
      for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
        const materialIndex = primitive.material;
        const materialName = Number.isInteger(materialIndex)
          ? (json.materials?.[materialIndex]?.name ?? `#${materialIndex}`)
          : '(unassigned)';
        triangleCounts.set(
          materialName,
          (triangleCounts.get(materialName) ?? 0)
            + primitiveTriangleCount(json, primitive) * instanceCount,
        );
        drawParts += instanceCount;
      }
    }
    const nextAncestors = new Set(ancestors).add(nodeIndex);
    for (const childIndex of node.children ?? []) visit(childIndex, nextAncestors);
  };
  for (const scene of json.scenes ?? []) {
    for (const nodeIndex of scene.nodes ?? []) visit(nodeIndex);
  }
  return {
    drawParts,
    materialTriangleCounts: Object.fromEntries(
      [...triangleCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function byteLengthForViews(json, viewIndices) {
  return [...viewIndices].reduce(
    (sum, index) => sum + (json.bufferViews?.[index]?.byteLength ?? 0),
    0,
  );
}

export function inspectGlbJson(json) {
  const logicalGeometryAccessors = geometryAccessorIndices(json);
  const imageViews = new Set(
    (json.images ?? []).map((image) => image.bufferView).filter(Number.isInteger),
  );
  const geometryViews = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessorIndices = [
        primitive.indices,
        ...Object.values(primitive.attributes ?? {}),
        ...Object.values(primitive.targets ?? {}).flatMap((target) => Object.values(target)),
      ].filter(Number.isInteger);
      for (const accessorIndex of accessorIndices) {
        const bufferView = json.accessors?.[accessorIndex]?.bufferView;
        if (Number.isInteger(bufferView)) geometryViews.add(bufferView);
      }
    }
  }
  const materialStats = renderedMaterialStats(json);
  return {
    scenes: json.scenes?.length ?? 0,
    nodes: json.nodes?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    images: json.images?.length ?? 0,
    skins: json.skins?.length ?? 0,
    animations: json.animations?.length ?? 0,
    triangles: triangleCount(json),
    renderedTriangles: renderedTriangleCount(json),
    drawParts: materialStats.drawParts,
    materialTriangleCounts: materialStats.materialTriangleCounts,
    sceneBounds: sceneBounds(json),
    bufferBytes: (json.buffers ?? []).reduce(
      (sum, buffer) => sum + (buffer.byteLength ?? 0),
      0,
    ),
    logicalAccessorBytes: (json.accessors ?? []).reduce(
      (sum, accessor) => sum + accessorByteLength(accessor),
      0,
    ),
    logicalVertexBytes: [...logicalGeometryAccessors.vertices].reduce(
      (sum, index) => sum + accessorByteLength(json.accessors[index]),
      0,
    ),
    logicalIndexBytes: [...logicalGeometryAccessors.indices].reduce(
      (sum, index) => sum + accessorByteLength(json.accessors[index]),
      0,
    ),
    geometryBufferBytes: byteLengthForViews(json, geometryViews),
    imageBufferBytes: byteLengthForViews(json, imageViews),
    nodeNames: (json.nodes ?? []).map((node) => node.name).filter(Boolean).sort(),
    materialNames: (json.materials ?? [])
      .map((material) => material.name)
      .filter(Boolean)
      .sort(),
    animationNames: (json.animations ?? [])
      .map((animation) => animation.name)
      .filter(Boolean)
      .sort(),
    extensionsUsed: [...(json.extensionsUsed ?? [])].sort(),
    extensionsRequired: [...(json.extensionsRequired ?? [])].sort(),
  };
}
