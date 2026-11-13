/**
 * Naive surface nets over a `DensityGrid`: one vertex per cell the surface
 * crosses, one quad per grid edge it cuts. Shared vertices and gradient normals
 * make junctions between openings seamless, which stitched tubes never are.
 *
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }}
 *   normals point into open air.
 */
export function extractSurface(grid) {
  const { nx, ny, nz, sy, sz, data, voxel, min } = grid;
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const positions = [];
  const indices = [];
  const corner = new Float32Array(8);
  const offsets = [0, 1, sy, sy + 1, sz, sz + 1, sz + sy, sz + sy + 1];
  // Corner pairs joined by a cube edge; bit 0 = x, bit 1 = y, bit 2 = z.
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };

  for (let k = 0; k < nz - 1; k += 1) {
    for (let j = 0; j < ny - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const base = i + j * sy + k * sz;
        let mask = 0;
        for (let c = 0; c < 8; c += 1) {
          corner[c] = data[base + offsets[c]];
          if (corner[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0, py = 0, pz = 0, crossings = 0;
        for (const [a, b] of edges) {
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = corner[a] / (corner[a] - corner[b]);
          px += (a & 1) + ((b & 1) - (a & 1)) * t;
          py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          crossings += 1;
        }
        cellVertex[base] = positions.length / 3;
        positions.push(min.x + (i + px / crossings) * voxel,
          min.y + (j + py / crossings) * voxel, min.z + (k + pz / crossings) * voxel);
        const solid = (mask & 1) === 1;
        // Each cut edge leaving corner 0 is shared by four cells, all already visited.
        if (j > 0 && k > 0 && solid !== (((mask >> 1) & 1) === 1)) {
          quad(cellVertex[base], cellVertex[base - sy], cellVertex[base - sy - sz], cellVertex[base - sz], solid);
        }
        if (i > 0 && k > 0 && solid !== (((mask >> 2) & 1) === 1)) {
          quad(cellVertex[base], cellVertex[base - sz], cellVertex[base - sz - 1], cellVertex[base - 1], solid);
        }
        if (i > 0 && j > 0 && solid !== (((mask >> 4) & 1) === 1)) {
          quad(cellVertex[base], cellVertex[base - 1], cellVertex[base - 1 - sy], cellVertex[base - sy], solid);
        }
      }
    }
  }

  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const normal = { x: 0, y: 0, z: 0 };
  for (let v = 0; v < count; v += 1) {
    grid.gradient(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], normal);
    normals[v * 3] = normal.x; normals[v * 3 + 1] = normal.y; normals[v * 3 + 2] = normal.z;
  }
  const result = { positions: new Float32Array(positions), normals, indices: new Uint32Array(indices) };
  faceTowardNormals(result);
  return result;
}

/** Winds every triangle to agree with its vertices' normals. */
function faceTowardNormals({ positions: p, normals: n, indices }) {
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const facing = (uy * vz - uz * vy) * (n[a] + n[b] + n[c])
      + (uz * vx - ux * vz) * (n[a + 1] + n[b + 1] + n[c + 1])
      + (ux * vy - uy * vx) * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (facing < 0) { const swap = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = swap; }
  }
}

/**
 * Splits an indexed mesh into one mesh per `cell`-metre column, so the renderer
 * can cull the parts of a large cave that are behind the camera.
 *
 * @param {{ indices: Uint32Array, attributes: Record<string, { array: Float32Array, size: number }> }} mesh
 * @returns {Array<{ indices: Uint32Array, attributes: Record<string, { array: Float32Array, size: number }> }>}
 */
export function splitByColumns(mesh, cell) {
  const position = mesh.attributes.position.array;
  const buckets = new Map();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3;
    const key = `${Math.floor(position[a] / cell)},${Math.floor(position[a + 2] / cell)}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = []);
    bucket.push(mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]);
  }
  const names = Object.keys(mesh.attributes);
  return [...buckets.values()].map((triangles) => {
    const remap = new Map();
    const indices = new Uint32Array(triangles.length);
    triangles.forEach((vertex, slot) => {
      if (!remap.has(vertex)) remap.set(vertex, remap.size);
      indices[slot] = remap.get(vertex);
    });
    const attributes = {};
    for (const name of names) {
      const { array, size } = mesh.attributes[name];
      const out = new Float32Array(remap.size * size);
      for (const [from, to] of remap) {
        for (let c = 0; c < size; c += 1) out[to * size + c] = array[from * size + c];
      }
      attributes[name] = { array: out, size };
    }
    return { indices, attributes };
  });
}
