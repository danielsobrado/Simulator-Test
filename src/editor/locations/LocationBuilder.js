import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DensityGrid } from './gen/DensityGrid.js';
import { bakeLighting } from './gen/LightBake.js';
import { createRng } from './gen/noise.js';
import { chamber, tunnel } from './gen/shapes.js';
import { extractSurface, splitByColumns } from './gen/SurfaceNets.js';
import { LocationNav } from './LocationNav.js';

const CULL_COLUMN_METRES = 28;
/** Clearance between a wall and where the walker's centre may go. */
const WALL_MARGIN = 0.45;

/**
 * What a generator writes a location into: the rock or ice volume, the built
 * props, the lights, and the walkable ground — declared together so the place
 * that is drawn is the place that can be walked.
 *
 * `build()` turns it into meshes with lighting baked in.
 */
export class LocationBuilder {
  /**
   * @param {object} options
   * @param {number} options.seed
   * @param {{ min: object, max: object }} options.bounds metres
   * @param {number} options.voxel metres per cell of the volume
   */
  constructor({ seed, bounds, voxel }) {
    this.seed = seed;
    this.random = createRng(seed);
    this.grid = new DensityGrid({ ...bounds, voxel });
    this.nav = new LocationNav();
    this.lights = [];
    this.halos = [];
    this.flames = [];
    this.shafts = [];
    this.props = new Map();
    this.spawns = {};
    this.anchors = {};
    this.exits = [];
    /**
     * Per-vertex material masks for the volume's surface; returns the ice share (0..1)
     * used by the light bake. Generators replace it.
     * @type {(p: {x:number,y:number,z:number}, n: {x:number,y:number,z:number}, mask: Float32Array, mask2: Float32Array) => number}
     */
    this.classify = () => 0;
  }

  /** `lo + random * (hi - lo)`. */
  range(lo, hi) {
    return lo + this.random() * (hi - lo);
  }

  /** Cuts a passage between two floor points and makes it walkable. */
  passage(a, b, { width, height, arch = 0.5, smooth = 0, walk = true }) {
    this.grid.carve(tunnel(a, b, { halfWidth: width / 2, height, arch }), smooth);
    if (walk) this.nav.addSegment(a, b, Math.max(0.6, width - WALL_MARGIN * 2));
  }

  /** Opens a domed chamber and makes a disc of its floor walkable. */
  room(center, { rx, ry, rz, floorY, smooth = 0, walkRadius = Math.min(rx, rz) - 1.2 }) {
    this.grid.carve(chamber(center, { rx, ry, rz, floorY }), smooth);
    if (walkRadius > 0) this.nav.addDisc({ x: center.x, y: floorY, z: center.z }, walkRadius);
  }

  /**
   * A light source, baked into every surface in range.
   *
   * @param {{x:number,y:number,z:number}} at
   * @param {string|number} tint colour
   * @param {number} intensity
   * @param {number} range metres
   * @param {{ radius?: number, flat?: boolean, halo?: number }} [options] `halo` is the glow sprite's size in metres
   */
  light(at, tint, intensity, range, { radius = 1, flat = false, halo = 0 } = {}) {
    const linear = new THREE.Color(tint);
    const color = [linear.r * intensity, linear.g * intensity, linear.b * intensity];
    this.lights.push({ x: at.x, y: at.y, z: at.z, color, range, radius, flat });
    if (halo > 0) this.halos.push({ x: at.x, y: at.y, z: at.z, color: [linear.r * 0.5, linear.g * 0.5, linear.b * 0.5], size: halo });
  }

  /**
   * Registers an animated procedural billboard flame rendered via one shared instanced draw.
   */
  flame(at, { width = 0.72, height = 1.05, core = '#fff1b4', outer = '#ff5810', speed = 1.0 } = {}) {
    const cCore = new THREE.Color(core);
    const cOuter = new THREE.Color(outer);
    this.flames.push({
      x: at.x,
      y: at.y + height * 0.42,
      z: at.z,
      width,
      height,
      speed,
      core: [cCore.r, cCore.g, cCore.b],
      outer: [cOuter.r, cOuter.g, cOuter.b],
    });
  }

  /**
   * Adds built geometry (world space) under a material key from the generator's material set.
   * `tint` multiplies the material; for the `glow` material it is the emitted colour.
   */
  prop(material, geometry, tint = 0xffffff, gain = 1) {
    const parts = Array.isArray(geometry) ? geometry : [geometry];
    const linear = new THREE.Color(tint).multiplyScalar(gain);
    for (const part of parts) {
      const flat = part.index ? part.toNonIndexed() : part;
      flat.deleteAttribute('uv');
      const count = flat.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let v = 0; v < count; v += 1) colors.set([linear.r, linear.g, linear.b], v * 3);
      flat.setAttribute('tint', new THREE.BufferAttribute(colors, 3));
      if (!this.props.has(material)) this.props.set(material, []);
      this.props.get(material).push(flat);
    }
  }

  /** A named point effects can gather around (a cave mouth for spindrift). */
  anchor(name, at) {
    this.anchors[name] = { x: at.x, y: at.y, z: at.z };
  }

  /** A shaft of light through the air from `from` to `to`. */
  shaft(from, to, width, tint, strength) {
    this.shafts.push({ from, to, width, tint, strength });
  }

  /** The first solid above (`direction` 1) or below (-1) a point in open air, or null within `reach` metres. */
  probe(x, y, z, direction, reach = 40) {
    const step = this.grid.voxel * 0.5;
    for (let d = 0; d < reach; d += step) {
      if (this.grid.sample(x, y + d * direction, z) < 0) return y + d * direction;
    }
    return null;
  }

  spawn(id, at, yaw = 0) {
    this.spawns[id] = { x: at.x, y: at.y, z: at.z, yaw };
  }

  /** A way out: within `radius` of `at` the walker is offered `label`. */
  exit(id, at, { radius = 2.5, label = 'Leave', spawnId = 'entry' } = {}) {
    this.exits.push({ id, x: at.x, y: at.y, z: at.z, radius, label, spawnId });
  }

  /**
   * Meshes the volume and the props and bakes the lights into both.
   *
   * @param {object} options
   * @param {Record<string, { material: Material, ice?: number }>} options.materials `terrain` plus one per prop key
   * @param {{ rock: number[], ice: number[] }} options.absorption
   * @returns {THREE.Group}
   */
  build({ materials, absorption }) {
    const group = new THREE.Group();
    const surface = extractSurface(this.grid);
    const count = surface.positions.length / 3;
    const mask = new Float32Array(count * 4), mask2 = new Float32Array(count * 4), ice = new Float32Array(count);
    const p = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
    const m = new Float32Array(4), m2 = new Float32Array(4);
    for (let v = 0; v < count; v += 1) {
      p.x = surface.positions[v * 3]; p.y = surface.positions[v * 3 + 1]; p.z = surface.positions[v * 3 + 2];
      n.x = surface.normals[v * 3]; n.y = surface.normals[v * 3 + 1]; n.z = surface.normals[v * 3 + 2];
      m.fill(0); m2.fill(0);
      ice[v] = this.classify(p, n, m, m2);
      mask.set(m, v * 4); mask2.set(m2, v * 4);
    }
    const baked = bakeLighting({
      grid: this.grid, positions: surface.positions, normals: surface.normals, lights: this.lights,
      iceAt: (v) => ice[v], absorption,
    });
    const chunks = splitByColumns({
      indices: surface.indices,
      attributes: {
        position: { array: surface.positions, size: 3 }, normal: { array: surface.normals, size: 3 },
        bakeLight: { array: baked.light, size: 3 }, bakeDir: { array: baked.dir, size: 3 },
        bakeShade: { array: baked.shade, size: 2 },
        surfMask: { array: mask, size: 4 }, surfMask2: { array: mask2, size: 4 },
      },
    }, CULL_COLUMN_METRES);
    for (const chunk of chunks) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, { array, size }] of Object.entries(chunk.attributes)) {
        geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
      }
      geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      geometry.computeBoundingSphere();
      group.add(new THREE.Mesh(geometry, materials.terrain.material));
    }

    for (const [key, parts] of this.props) {
      const entry = materials[key];
      if (!entry) throw new Error(`Location prop material "${key}" is not in the generator's material set.`);
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      const lit = bakeLighting({
        grid: this.grid, positions: geometry.attributes.position.array, normals: geometry.attributes.normal.array,
        lights: this.lights, iceAt: () => entry.ice ?? 0, absorption,
      });
      geometry.setAttribute('bakeLight', new THREE.BufferAttribute(lit.light, 3));
      geometry.setAttribute('bakeDir', new THREE.BufferAttribute(lit.dir, 3));
      geometry.setAttribute('bakeShade', new THREE.BufferAttribute(lit.shade, 2));
      geometry.computeBoundingSphere();
      group.add(new THREE.Mesh(geometry, entry.material));
    }
    group.traverse((object) => { object.matrixAutoUpdate = false; });
    return group;
  }
}
