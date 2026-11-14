/**
 * Sparse brick occupancy grid built from solid architectural & decorative prop
 * triangles (`timber`, `iron`, `ore`, `masonry`, `carved`, `bronze`, `rock_debris`).
 *
 * Used by `LightBake` so structural timbers, braces, headframes, ore carts, and
 * crates cast shadows onto cave stone and each other, and contribute tight
 * contact occlusion at joints without allocating a dense sub-voxel volume.
 */

const BRICK_SHIFT = 3;
const BRICK_DIM = 1 << BRICK_SHIFT; // 8 cells per axis
const BRICK_MASK = BRICK_DIM - 1;
const BRICK_CELLS = BRICK_DIM * BRICK_DIM * BRICK_DIM;

// Asymmetric offset keeps signed brick coordinates cleanly non-negative up to ±1024 bricks (~1.3 km).
const COORD_BIAS = 1024;
const KEY_Y_MUL = 2048;
const KEY_Z_MUL = 2048 * 2048;

const CONTACT_DISTANCES = [0.20, 0.42, 0.74];

function brickKey(bx, by, bz) {
  return (bx + COORD_BIAS) + (by + COORD_BIAS) * KEY_Y_MUL + (bz + COORD_BIAS) * KEY_Z_MUL;
}

/** Builds two unit tangents orthogonal to `nx, ny, nz`. */
function tangentBasis(nx, ny, nz) {
  const ax = Math.abs(ny) < 0.9 ? 0 : 1;
  const ay = Math.abs(ny) < 0.9 ? 1 : 0;
  let tx = ay * nz - 0 * ny;
  let ty = 0 * nx - ax * nz;
  let tz = ax * ny - ay * nx;
  const tLen = Math.hypot(tx, ty, tz) || 1;
  tx /= tLen; ty /= tLen; tz /= tLen;
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;
  return [tx, ty, tz, bx, by, bz];
}

export class PropOcclusionGrid {
  /**
   * @param {number} [resolution=0.16] voxel cell size in metres
   */
  constructor(resolution = 0.16) {
    this.resolution = Math.max(0.08, resolution);
    this.invResolution = 1 / this.resolution;
    this.brickWorldSize = BRICK_DIM * this.resolution;
    this.bricks = new Map();
    this.cellCount = 0;
  }

  /** Marks world cell containing `(x, y, z)` as occupied. */
  #markWorld(x, y, z) {
    const ix = Math.floor(x * this.invResolution);
    const iy = Math.floor(y * this.invResolution);
    const iz = Math.floor(z * this.invResolution);
    const bx = ix >> BRICK_SHIFT;
    const by = iy >> BRICK_SHIFT;
    const bz = iz >> BRICK_SHIFT;
    const key = brickKey(bx, by, bz);
    let brick = this.bricks.get(key);
    if (!brick) {
      brick = new Uint8Array(BRICK_CELLS);
      this.bricks.set(key, brick);
    }
    const local = (ix & BRICK_MASK)
      + ((iy & BRICK_MASK) << BRICK_SHIFT)
      + ((iz & BRICK_MASK) << (BRICK_SHIFT * 2));
    if (brick[local] === 0) {
      brick[local] = 1;
      this.cellCount += 1;
    }
  }

  /** @returns {boolean} true if any prop geometry occupies the cell at world `(x, y, z)`. */
  solidAt(x, y, z) {
    const ix = Math.floor(x * this.invResolution);
    const iy = Math.floor(y * this.invResolution);
    const iz = Math.floor(z * this.invResolution);
    const bx = ix >> BRICK_SHIFT;
    const by = iy >> BRICK_SHIFT;
    const bz = iz >> BRICK_SHIFT;
    const brick = this.bricks.get(brickKey(bx, by, bz));
    if (!brick) return false;
    const local = (ix & BRICK_MASK)
      + ((iy & BRICK_MASK) << BRICK_SHIFT)
      + ((iz & BRICK_MASK) << (BRICK_SHIFT * 2));
    return brick[local] !== 0;
  }

  /**
   * Rasterizes non-indexed triangle positions into the sparse brick grid.
   * Tiny geometry centered right on practical light sources (such as lantern
   * cages and hanging wires) is skipped so bulbs do not shadow themselves.
   *
   * @param {Float32Array} positions non-indexed XYZ buffer (9 floats per triangle)
   * @param {{ excludeLights?: Array<{x:number,y:number,z:number}>, excludeRadius?: number }} [options]
   */
  addTriangles(positions, { excludeLights = [], excludeRadius = 0.30 } = {}) {
    const step = this.resolution * 0.72;
    const excludeSq = excludeRadius * excludeRadius;
    const count = positions.length;

    for (let i = 0; i + 8 < count; i += 9) {
      const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
      const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];

      const ab = Math.hypot(bx - ax, by - ay, bz - az);
      const ac = Math.hypot(cx - ax, cy - ay, cz - az);
      const bc = Math.hypot(cx - bx, cy - by, cz - bz);
      const maxEdge = Math.max(ab, ac, bc);
      if (maxEdge < 1e-5) continue;

      if (excludeLights.length > 0 && maxEdge < excludeRadius * 2.1) {
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const mz = (az + bz + cz) / 3;
        let skip = false;
        for (const light of excludeLights) {
          const dx = mx - light.x, dy = my - light.y, dz = mz - light.z;
          if (dx * dx + dy * dy + dz * dz <= excludeSq) {
            skip = true;
            break;
          }
        }
        if (skip) continue;
      }

      const stepsU = Math.min(48, Math.max(1, Math.ceil(ab / step)));
      const stepsV = Math.min(48, Math.max(1, Math.ceil(ac / step)));
      const du = 1 / stepsU;
      const dv = 1 / stepsV;
      for (let iu = 0; iu <= stepsU; iu += 1) {
        const u = iu * du;
        const maxV = 1 - u + 1e-4;
        for (let iv = 0; iv <= stepsV; iv += 1) {
          const v = iv * dv;
          if (v > maxV) break;
          const w = Math.max(0, 1 - u - v);
          this.#markWorld(
            ax * w + bx * u + cx * v,
            ay * w + by * u + cy * v,
            az * w + bz * u + cz * v,
          );
        }
      }
    }
  }

  /**
   * Computes light transmittance (0..1) along the segment from `(sx, sy, sz)` toward
   * direction `(ux, uy, uz)` over `distance`, skipping the immediate self-surface
   * and immediate bulb housing intervals.
   */
  transmittanceRay(sx, sy, sz, ux, uy, uz, distance, {
    startOffset = 0.14,
    endMargin = 0.28,
    minTransmit = 0.14,
  } = {}) {
    if (this.cellCount === 0) return 1;
    const tEnd = distance - endMargin;
    if (tEnd <= startOffset) return 1;
    const step = this.resolution * 0.68;
    let hits = 0;
    for (let t = startOffset; t < tEnd; t += step) {
      if (this.solidAt(sx + ux * t, sy + uy * t, sz + uz * t)) {
        hits += 1;
        if (hits >= 4) return minTransmit;
      }
    }
    if (hits === 0) return 1;
    return Math.max(minTransmit, Math.exp(-hits * 0.85));
  }

  /**
   * Computes structural contact ambient occlusion (0..1, 1 = unoccluded) around
   * `(px, py, pz)` with outward normal `(nx, ny, nz)`.
   */
  contactAO(px, py, pz, nx, ny, nz, {
    grid = null,
    selfClearance = 0.16,
    strength = 0.72,
    minAO = 0.26,
  } = {}) {
    const hasProps = this.cellCount > 0;
    if (!hasProps && !grid) return 1;
    const [tx, ty, tz, bx, by, bz] = tangentBasis(nx, ny, nz);
    const dirs = [
      [nx, ny, nz, 1.0],
      [nx * 0.78 + tx * 0.62, ny * 0.78 + ty * 0.62, nz * 0.78 + tz * 0.62, 0.8],
      [nx * 0.78 - tx * 0.62, ny * 0.78 - ty * 0.62, nz * 0.78 - tz * 0.62, 0.8],
      [nx * 0.78 + bx * 0.62, ny * 0.78 + by * 0.62, nz * 0.78 + bz * 0.62, 0.8],
      [nx * 0.78 - bx * 0.62, ny * 0.78 - by * 0.62, nz * 0.78 - bz * 0.62, 0.8],
    ];

    let sumOcc = 0;
    let totalWeight = 0;
    const ox = px + nx * selfClearance;
    const oy = py + ny * selfClearance;
    const oz = pz + nz * selfClearance;

    for (let dIdx = 0; dIdx < dirs.length; dIdx += 1) {
      const dir = dirs[dIdx];
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const ux = dir[0] / len, uy = dir[1] / len, uz = dir[2] / len;
      const w = dir[3];
      for (const reach of CONTACT_DISTANCES) {
        const sx = ox + ux * reach;
        const sy = oy + uy * reach;
        const sz = oz + uz * reach;
        const propHit = hasProps && this.solidAt(sx, sy, sz) ? 1 : 0;
        const terrainHit = grid && grid.sample(sx, sy, sz) < 0 ? 0.85 : 0;
        const hit = Math.max(propHit, terrainHit);
        const distWeight = w * (1 / (0.6 + reach * 1.4));
        sumOcc += hit * distWeight;
        totalWeight += distWeight;
      }
    }

    const avg = totalWeight > 0 ? sumOcc / totalWeight : 0;
    return Math.max(minAO, 1 - strength * avg);
  }
}
