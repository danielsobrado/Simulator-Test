import { fbm3 } from './noise.js';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * A signed field over a box, in metres: positive is open air, negative is solid.
 * Everything starts solid; generators open air and put solids back, and the
 * mesher, the light bake and the thickness probe all read this one volume, so
 * what is drawn, what is lit and what blocks light cannot disagree.
 *
 * `open` is for places under the sky: openings may reach the edge of the box,
 * where the surface simply ends, and everything beyond the box is air.
 */
export class DensityGrid {
  constructor({ min, max, voxel, open = false }) {
    this.voxel = voxel;
    this.open = open;
    this.min = { ...min };
    this.nx = Math.ceil((max.x - min.x) / voxel) + 1;
    this.ny = Math.ceil((max.y - min.y) / voxel) + 1;
    this.nz = Math.ceil((max.z - min.z) / voxel) + 1;
    this.sy = this.nx;
    this.sz = this.nx * this.ny;
    this.cap = voxel * 6;
    this.data = new Float32Array(this.sz * this.nz).fill(-this.cap);
  }

  #range(box) {
    const { voxel, min } = this;
    // A closed volume keeps a solid shell so every opening is sealed by a wall.
    const edge = this.open ? 0 : 1;
    return [
      clamp(Math.floor((box.min.x - min.x) / voxel), edge, this.nx - 1 - edge),
      clamp(Math.ceil((box.max.x - min.x) / voxel), edge, this.nx - 1 - edge),
      clamp(Math.floor((box.min.y - min.y) / voxel), edge, this.ny - 1 - edge),
      clamp(Math.ceil((box.max.y - min.y) / voxel), edge, this.ny - 1 - edge),
      clamp(Math.floor((box.min.z - min.z) / voxel), edge, this.nz - 1 - edge),
      clamp(Math.ceil((box.max.z - min.z) / voxel), edge, this.nz - 1 - edge),
    ];
  }

  #each(box, visit) {
    const [x0, x1, y0, y1, z0, z1] = this.#range(box);
    const { voxel, min, data } = this;
    for (let k = z0; k <= z1; k += 1) {
      const z = min.z + k * voxel;
      for (let j = y0; j <= y1; j += 1) {
        const y = min.y + j * voxel;
        let index = x0 + j * this.sy + k * this.sz;
        for (let i = x0; i <= x1; i += 1, index += 1) {
          data[index] = clamp(visit(data[index], min.x + i * voxel, y, z), -this.cap, this.cap);
        }
      }
    }
  }

  /**
   * Opens air. `shape.air(x, y, z)` is the distance inside the opening, positive
   * within it. `smooth` (metres) rounds the seam with what is already open.
   */
  carve(shape, smooth = 0) {
    this.#each(shape.box, (current, x, y, z) => {
      const air = shape.air(x, y, z);
      if (smooth <= 0) return air > current ? air : current;
      const h = clamp(0.5 + 0.5 * (air - current) / smooth, 0, 1);
      return current + (air - current) * h + smooth * h * (1 - h);
    });
  }

  /** Puts a solid back. `shape.solid(x, y, z)` is the distance outside it. */
  fill(shape, smooth = 0) {
    this.#each(shape.box, (current, x, y, z) => {
      const outside = shape.solid(x, y, z);
      if (smooth <= 0) return outside < current ? outside : current;
      const h = clamp(0.5 - 0.5 * (outside - current) / smooth, 0, 1);
      return current + (outside - current) * h - smooth * h * (1 - h);
    });
  }

  /**
   * Breaks up the surface with fractal noise. Floors (surfaces facing up) keep
   * `floorAmp` of it so what the player walks on stays where navigation says.
   * `amp(x, y, z)` may scale it locally.
   */
  roughen({ amp, scale, seed = 0, octaves = 3, floorAmp = 0.12, stretchY = 1, ampAt = null }) {
    this.#displace(amp, (x, y, z, up) => {
      let strength = amp * (up > 0.75 ? floorAmp : 1);
      if (ampAt) strength *= ampAt(x, y, z);
      return (fbm3(x * scale, y * scale * stretchY, z * scale, seed, octaves) - 0.5) * 2 * strength;
    });
  }

  /**
   * Cuts ledges along tilted layers into walls, as melt does where clear and
   * bubbly ice alternate. `frequency` is layers per metre; floors and roofs are left alone.
   */
  striate({ amp, frequency, dip = 0, warp = 0, seed = 0, ampAt = null }) {
    this.#displace(amp, (x, y, z, up) => {
      if (Math.abs(up) > 0.6) return 0;
      const phase = y * frequency + x * dip + (fbm3(x * 0.05, y * 0.05, z * 0.05, seed, 2) - 0.5) * warp;
      const ledge = Math.abs(phase - Math.floor(phase) - 0.5) * 4 - 1;
      // Ledges come and go along a wall; ruled from end to end they read as stripes.
      const run = clamp((fbm3(x * 0.04, y * 0.15, z * 0.04, seed + 3, 2) - 0.34) * 3.2, 0, 1.2);
      return ledge * amp * run * (ampAt ? ampAt(x, y, z) : 1);
    });
  }

  /** Adds `offsetAt(x, y, z, up)` to every cell within reach of the surface; `up` is the surface normal's Y. */
  #displace(amp, offsetAt) {
    const { data, sy, sz, voxel, min } = this;
    const band = amp * 1.5 + voxel * 1.5;
    for (let k = 1; k < this.nz - 1; k += 1) {
      for (let j = 1; j < this.ny - 1; j += 1) {
        let index = 1 + j * sy + k * sz;
        for (let i = 1; i < this.nx - 1; i += 1, index += 1) {
          const value = data[index];
          if (value > band || value < -band) continue;
          const gx = data[index + 1] - data[index - 1];
          const gy = data[index + sy] - data[index - sy];
          const gz = data[index + sz] - data[index - sz];
          const up = gy / (Math.hypot(gx, gy, gz) || 1);
          data[index] = value + offsetAt(min.x + i * voxel, min.y + j * voxel, min.z + k * voxel, up);
        }
      }
    }
  }

  /** Trilinear field value at a world point. */
  sample(x, y, z) {
    const { voxel, min, data, sy, sz } = this;
    const gx = clamp((x - min.x) / voxel, 0, this.nx - 1.001);
    const gy = clamp((y - min.y) / voxel, 0, this.ny - 1.001);
    const gz = clamp((z - min.z) / voxel, 0, this.nz - 1.001);
    const ix = gx | 0, iy = gy | 0, iz = gz | 0;
    const fx = gx - ix, fy = gy - iy, fz = gz - iz;
    const index = ix + iy * sy + iz * sz;
    const lerp = (a, b, t) => a + (b - a) * t;
    const near = lerp(lerp(data[index], data[index + 1], fx),
      lerp(data[index + sy], data[index + sy + 1], fx), fy);
    const far = lerp(lerp(data[index + sz], data[index + sz + 1], fx),
      lerp(data[index + sz + sy], data[index + sz + sy + 1], fx), fy);
    return lerp(near, far, fz);
  }

  /** Whether the nearest cell to a world point is solid. Outside the box is solid, or air for an open volume. */
  solidAt(x, y, z) {
    const i = Math.round((x - this.min.x) / this.voxel);
    const j = Math.round((y - this.min.y) / this.voxel);
    const k = Math.round((z - this.min.z) / this.voxel);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return !this.open;
    return this.data[i + j * this.sy + k * this.sz] < 0;
  }

  /** Unit vector toward open air at a world point. */
  gradient(x, y, z, out) {
    const e = this.voxel * 0.75;
    const gx = this.sample(x + e, y, z) - this.sample(x - e, y, z);
    const gy = this.sample(x, y + e, z) - this.sample(x, y - e, z);
    const gz = this.sample(x, y, z + e) - this.sample(x, y, z - e);
    const length = Math.hypot(gx, gy, gz) || 1;
    out.x = gx / length; out.y = gy / length; out.z = gz / length;
    return out;
  }
}
