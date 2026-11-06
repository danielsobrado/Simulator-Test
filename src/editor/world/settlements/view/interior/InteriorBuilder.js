import { drainJob } from '../../SettlementArrayJobs.js';
/**
 * Gathers a town's rooms into a handful of meshes, one per material, with
 * their light baked in.
 *
 * A room has a fire, a few candles and a window or two. Real lights for every
 * room of a town would not scale, and the sun must not reach indoors at all, so
 * each vertex records what its room's lights give it: `fire` (warm, RGB) and
 * `sky` (daylight through openings, a scalar the material fades at dusk).
 * Large faces are cut into cells so that light falls off across them.
 *
 * Everything is given in the footprint frame of the building last `enter`ed —
 * x along the frontage, z toward the front, y absolute — and stored in
 * settlement-local space (x plan x, z minus plan z). No three.
 */

/** Largest cell, in metres, a lit face is cut into. */
const CELL = 1.1;
/** A face turned away from a light still catches this share of it, as bounce. */
const WRAP = 0.3;

const OUTWARD_ORDER = Object.freeze([0, 1, 2, 0, 2, 3]);
const INWARD_ORDER = Object.freeze([0, 3, 2, 0, 2, 1]);

export const INTERIOR_MATERIALS = Object.freeze(['wood', 'plaster', 'stone', 'plain', 'glow', 'sky', 'exterior']);

/**
 * A float32 list that grows by doubling. A city's rooms run to ~100 million
 * values; held as JS number arrays (8 bytes each, plus growth) until the end,
 * they alone took most of a gigabyte while the town loaded.
 */
class FloatList {
  constructor() { this.array = new Float32Array(1024); this.length = 0; }
  reserve(count) {
    if (this.length + count <= this.array.length) return;
    let size = this.array.length * 2;
    while (size < this.length + count) size *= 2;
    const grown = new Float32Array(size);
    grown.set(this.array.subarray(0, this.length));
    this.array = grown;
  }
  push(a, b, c) {
    const count = c !== undefined ? 3 : b !== undefined ? 2 : 1;
    this.reserve(count);
    const array = this.array;
    array[this.length++] = a;
    if (count > 1) array[this.length++] = b;
    if (count > 2) array[this.length++] = c;
  }
  /** The values, trimmed to their length (a copy, so the doubling slack is freed). */
  toArray() { return this.array.slice(0, this.length); }
}

function emptyGroup() {
  return { positions: new FloatList(), normals: new FloatList(), colors: new FloatList(),
    uvs: new FloatList(), fire: new FloatList(), sky: new FloatList() };
}

export class InteriorBuilder {
  constructor() {
    this.groups = new Map(INTERIOR_MATERIALS.map((key) => [key, emptyGroup()]));
    this.group = this.groups.get('plain');
    this.lights = [];
  }

  /** Aim the builder at one building, and light what follows with `lights`. */
  enter(building, lights = []) {
    // +x is (cos, −sin) and +z is (sin, cos) in plan space, and local z is minus plan z.
    this.sin = Math.sin(building.yaw);
    this.cos = Math.cos(building.yaw);
    this.originX = building.x;
    this.originZ = building.z;
    this.lights = lights;
  }

  /** Which material what follows is made of. */
  use(key) {
    this.group = this.groups.get(key);
    if (!this.group) throw new Error(`Unknown interior material: ${key}.`);
    return this;
  }

  /**
   * What the room's lights give a point with normal `n`: `[fireR, fireG, fireB, sky]`,
   * in one scratch array reused for every vertex. A city's rooms run to tens of
   * millions of vertices, and fresh arrays for each pushed its tab past Chrome's memory limit.
   */
  lightAt(point, n) {
    const light = this.light ??= [0, 0, 0, 0];
    light[0] = 0; light[1] = 0; light[2] = 0; light[3] = 0;
    for (const source of this.lights) {
      const dx = source.at[0] - point[0];
      const dy = source.at[1] - point[1];
      const dz = source.at[2] - point[2];
      const distance = Math.hypot(dx, dy, dz) || 1e-3;
      const facing = Math.max(0, (n[0] * dx + n[1] * dy + n[2] * dz) / distance) * (1 - WRAP) + WRAP;
      const reach = facing * source.strength / (1 + (distance / source.radius) ** 2);
      if (source.sky) light[3] += reach;
      else for (let channel = 0; channel < 3; channel += 1) light[channel] += source.color[channel] * reach;
    }
    return light;
  }

  vertex(point, n, color, u, v) {
    const { group, sin, cos } = this;
    const light = this.lightAt(point, n);
    const [x, y, z] = point;
    group.positions.push(this.originX + cos * x + sin * z, y, -(this.originZ - sin * x + cos * z));
    group.normals.push(cos * n[0] + sin * n[2], n[1], -(-sin * n[0] + cos * n[2]));
    group.colors.push(color[0], color[1], color[2]);
    group.uvs.push(u, v);
    group.fire.push(light[0], light[1], light[2]);
    group.sky.push(light[3]);
  }

  /**
   * A flat quad a→b→c→d (frame points), facing along `n`. Cut into cells when
   * it is large, so baked light varies across it. UVs follow the face in metres.
   */
  quad(a, b, c, d, n, color, density = 0.6) {
    const length = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const columns = Math.max(1, Math.ceil(length(a, b) / CELL));
    const rows = Math.max(1, Math.ceil(length(a, d) / CELL));
    const cross = [
      (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]),
      (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]),
      (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]),
    ];
    // The footprint frame is a mirror image of settlement-local space (its z is
    // negated), so a face wound to look along `n` here looks the other way there.
    const outward = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0;
    const point = this.point ??= [0, 0, 0];
    const at = (s, t) => {
      for (let axis = 0; axis < 3; axis += 1) {
        const near = a[axis] + (b[axis] - a[axis]) * s;
        const far = d[axis] + (c[axis] - d[axis]) * s;
        point[axis] = near + (far - near) * t;
      }
      return point;
    };
    const width = length(a, b) * density;
    const height = length(a, d) * density;
    const order = outward ? OUTWARD_ORDER : INWARD_ORDER;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        for (const index of order) {
          // Corners 0..3 run (s0,t0) (s1,t0) (s1,t1) (s0,t1).
          const s = (column + (index === 1 || index === 2 ? 1 : 0)) / columns;
          const t = (row + (index >= 2 ? 1 : 0)) / rows;
          this.vertex(at(s, t), n, color, s * width, t * height);
        }
      }
    }
  }

  /** One triangle (frame points), wound to face along `n`. */
  tri(a, b, c, n, color) {
    const cross = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const outward = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0;
    for (const point of outward ? [a, b, c] : [a, c, b]) this.vertex(point, n, color, point[0] * 0.6, point[2] * 0.6);
  }

  /** An upright rectangle from (ax, az) to (bx, bz) between two heights, facing `[fx, fz]`. */
  wall(ax, az, bx, bz, bottom, top, facing, color, density) {
    this.quad([ax, bottom, az], [bx, bottom, bz], [bx, top, bz], [ax, top, az], [facing[0], 0, facing[1]], color, density);
  }

  /** A level rectangle at height `y`, facing up or down. */
  slab(x0, x1, z0, z1, y, up, color, density) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, up ? 1 : -1, 0], color, density);
  }

  /** A box seen from outside: four sides, a top, and a bottom when it hangs in the air. */
  box(x0, x1, z0, z1, bottom, top, color, { underside = false, density } = {}) {
    this.wall(x0, z1, x1, z1, bottom, top, [0, 1], color, density);
    this.wall(x0, z0, x1, z0, bottom, top, [0, -1], color, density);
    this.wall(x1, z0, x1, z1, bottom, top, [1, 0], color, density);
    this.wall(x0, z0, x0, z1, bottom, top, [-1, 0], color, density);
    this.slab(x0, x1, z0, z1, top, true, color, density);
    if (underside) this.slab(x0, x1, z0, z1, bottom, false, color, density);
  }

  /** An upright prism — a cask, a pot, a candle — optionally wider in the belly, or drawn in toward its top. */
  prism(x, z, radius, bottom, top, color, { sides = 10, belly = 0, taper = 0, cap = true } = {}) {
    const rings = belly > 0 ? 3 : 1;
    const ringRadius = (ring) => radius * (1 + belly * Math.sin(Math.PI * ring / rings)) * (1 - taper * ring / rings);
    for (let ring = 0; ring < rings; ring += 1) {
      const [y0, y1] = [bottom + (top - bottom) * ring / rings, bottom + (top - bottom) * (ring + 1) / rings];
      const [r0, r1] = [ringRadius(ring), ringRadius(ring + 1)];
      for (let side = 0; side < sides; side += 1) {
        const [a0, a1] = [Math.PI * 2 * side / sides, Math.PI * 2 * (side + 1) / sides];
        const middle = (a0 + a1) / 2;
        this.quad(
          [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0],
          [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1],
          [Math.cos(middle), 0, Math.sin(middle)], color);
      }
    }
    if (!cap) return;
    for (let side = 0; side < sides; side += 1) {
      const [a0, a1] = [Math.PI * 2 * side / sides, Math.PI * 2 * (side + 1) / sides];
      this.tri([x, top, z], [x + Math.cos(a0) * radius, top, z + Math.sin(a0) * radius],
        [x + Math.cos(a1) * radius, top, z + Math.sin(a1) * radius], [0, 1, 0], color);
    }
  }

  /** A disc hung flat on a wall — a shield, a trencher — facing `[fx, fz]`. */
  disc(x, y, z, radius, facing, color, sides = 12) {
    const across = [facing[1], -facing[0]];
    const rim = (angle) => [x + across[0] * Math.cos(angle) * radius, y + Math.sin(angle) * radius, z + across[1] * Math.cos(angle) * radius];
    for (let side = 0; side < sides; side += 1) {
      const [a0, a1] = [Math.PI * 2 * side / sides, Math.PI * 2 * (side + 1) / sides];
      this.tri([x, y, z], rim(a0), rim(a1), [facing[0], 0, facing[1]], color);
    }
  }

  /** The gathered meshes, by material, as typed arrays; materials with nothing in them are left out. */
  *arraysJob() {
    const result = {};
    for (const [key, group] of this.groups) {
      if (group.positions.length === 0) continue;
      result[key] = {};
      for (const [name, values] of Object.entries(group)) { result[key][name] = values.toArray(); yield; }
    }
    return result;
  }
  arrays() { return drainJob(this.arraysJob()); }
}
