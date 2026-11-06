import { Box3, Vector3, InterleavedBuffer, InterleavedBufferAttribute } from 'three/webgpu';
import { resolveCanopyBakeSettings } from './treeSurfaceSettings.js';

const SKY_RAYS = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]];
const TRIANGLE_SAMPLES = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]];

/** One bounded density grid per prototype, never per instance or per frame.
 * Triangle area avoids weighting dense tessellation more heavily than sparse cards.
 * Alpha-card coverage is an estimate; this is sky visibility, not a shadow map.
 */
export function bakeCanopyVisibility(parts, trees = {}) {
  const leaves = parts.filter(part => part.kind === 'leaf');
  if (!leaves.length) return;
  const { resolution: n, density: extinction } = resolveCanopyBakeSettings(trees);
  const bounds = new Box3();
  for (const { geometry } of leaves) {
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
  }
  const size = bounds.getSize(new Vector3()).max(new Vector3(0.01, 0.01, 0.01));
  const cell = size.clone().divideScalar(n);
  const areaScale = (cell.x * cell.y + cell.x * cell.z + cell.y * cell.z) / 3;
  const grid = new Float32Array(n ** 3);
  const index = (x, y, z) => x + n * (y + n * z);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), cross = new Vector3(), point = new Vector3();
  for (const { geometry } of leaves) {
    const positions = geometry.getAttribute('position'), indices = geometry.index;
    const count = indices?.count ?? positions.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(positions, indices ? indices.getX(i) : i);
      b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1);
      c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2);
      const area = cross.subVectors(b, a).cross(point.subVectors(c, a)).length() * 0.5;
      // Four interior samples avoid filling the empty AABB of a large leaf card.
      for (const weights of TRIANGLE_SAMPLES) {
        point.copy(a).multiplyScalar(weights[0]).addScaledVector(b, weights[1]).addScaledVector(c, weights[2]);
        point.sub(bounds.min).divide(cell);
        const x = Math.min(n - 1, Math.max(0, Math.floor(point.x)));
        const y = Math.min(n - 1, Math.max(0, Math.floor(point.y)));
        const z = Math.min(n - 1, Math.max(0, Math.floor(point.z)));
        grid[index(x, y, z)] += area * 0.25 / areaScale;
      }
    }
  }
  const visibility = new Float32Array(grid.length);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let sky = 0;
    for (const ray of SKY_RAYS) {
      let depth = 0;
      for (let step = 1; step < n * 2; step++) {
        const sx = Math.floor(x + 0.5 + ray[0] * step), sy = Math.floor(y + 0.5 + ray[1] * step), sz = Math.floor(z + 0.5 + ray[2] * step);
        if (sx < 0 || sx >= n || sy >= n || sz < 0 || sz >= n) break;
        depth += Math.min(1, grid[index(sx, sy, sz)]);
      }
      sky += Math.exp(-depth * extinction);
    }
    visibility[index(x, y, z)] = sky / SKY_RAYS.length;
  }
  for (const { geometry } of leaves) {
    const positions = geometry.getAttribute('position');
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal');
    // Share the normal's vertex buffer: another stream can exceed WebGPU's
    // eight-buffer limit on coloured, instanced leaf meshes. RGB normals survive.
    const data = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).sub(bounds.min).divide(cell).addScalar(-0.5);
      point.clampScalar(0, n - 1);
      const x = Math.floor(point.x), y = Math.floor(point.y), z = Math.floor(point.z);
      const fx = point.x - x, fy = point.y - y, fz = point.z - z;
      let sky = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        sky += visibility[index(Math.min(n - 1, x + dx), Math.min(n - 1, y + dy), Math.min(n - 1, z + dz))]
          * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      }
      data.set([normals.getX(i), normals.getY(i), normals.getZ(i), sky], i * 4);
    }
    const buffer = new InterleavedBuffer(data, 4);
    geometry.setAttribute('normal', new InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('canopyVisibility', new InterleavedBufferAttribute(buffer, 1, 3));
  }
}
