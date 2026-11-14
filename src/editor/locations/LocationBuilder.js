import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DensityGrid } from './gen/DensityGrid.js';
import { createBounceField, gatherBounceLight } from './gen/IndirectBounce.js';
import { bakeLighting, SHADE_SIZE } from './gen/LightBake.js';
import { createRng, fbm3 } from './gen/noise.js';
import { excavatedTunnel } from './gen/excavatedTunnel.js';
import { PropOcclusionGrid } from './gen/PropOcclusionGrid.js';
import { chamber, tunnel } from './gen/shapes.js';
import { extractSurface, smoothAttribute, splitByColumns } from './gen/SurfaceNets.js';
import { LocationNav } from './LocationNav.js';

const CULL_COLUMN_METRES = 28;
/** Clearance between a wall and where the walker's centre may go. */
const WALL_MARGIN = 0.45;
/** The surface normal's Y below which ground is a slope to slide off, not a place to stand. */
const MIN_STANDABLE = 0.6;
/** Metres between the stations a winding tube is cut through. */
const TUBE_STEP = 1.5;
/** The most ice a loose piece (an icicle, a fallen block) is taken to have behind its surface, metres. */
const PROP_ICE_THICKNESS = 0.7;
/** How far a parallel light is traced for shadows. */
const SKY_REACH = 90;
/** Directions the sky is sampled from: straight up, and four at 40° above the horizon. */
const SKY_DIRECTIONS = [[0, 1, 0], [0.766, 0.643, 0], [-0.766, 0.643, 0], [0, 0.643, 0.766], [0, 0.643, -0.766]];

/**
 * Runs a site's generator. A place under the sky is lit by its lighting
 * profile's sun and skylight, so the sun that is drawn is the sun that was baked.
 *
 * @param {object} site a resolved site from the catalog
 * @param {{ bounds: object, open?: boolean, generate: Function }} generator
 * @returns {LocationBuilder} ready for `build()`
 */
export function generateLocation(site, generator) {
  const builder = new LocationBuilder({
    seed: site.seed, bounds: generator.bounds, voxel: site.voxel, open: generator.open === true,
  });
  // Before the generator runs, so it can place shafts of that sun through its openings.
  const sky = site.lighting.sky;
  if (sky) {
    builder.sun(sky.sun.direction, sky.sun.color, sky.sun.intensity);
    builder.sky(sky.skylight.color, sky.skylight.intensity);
  }
  generator.generate(builder, site.params);
  return builder;
}

/**
 * What a generator writes a location into: the rock or ice volume, the built
 * props, the lights, and the walkable ground — declared together so the place
 * that is drawn is the place that can be walked.
 *
 * `build()` turns it into meshes with lighting baked in.
 */
export class LocationBuilder {
  #normal;

  /**
   * @param {object} options
   * @param {number} options.seed
   * @param {{ min: object, max: object }} options.bounds metres
   * @param {number} options.voxel metres per cell of the volume
   * @param {boolean} [options.open] the place is under the sky rather than sealed in rock or ice
   */
  constructor({ seed, bounds, voxel, open = false }) {
    this.seed = seed;
    this.random = createRng(seed);
    this.grid = new DensityGrid({ ...bounds, voxel, open });
    this.emitters = {};
    /** The sun, once a place has one: `{ direction, tint }`. */
    this.sunward = null;
    this.#normal = { x: 0, y: 0, z: 0 };
    this.nav = new LocationNav();
    this.lights = [];
    this.dynamicLights = [];
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

  /**
   * Cuts a geologically varied excavated mine passage along 2+ floor points
   * and registers walkable segments along its smoothed spine.
   */
  minePassage(points, {
    width,
    height,
    seedOffset = 0,
    tunnelGeometry,
    clearance,
    blendEnds,
    smooth = 0.35,
    walk = true,
  }) {
    const shape = excavatedTunnel(points, {
      width,
      height,
      seed: this.seed + seedOffset,
      tunnelGeometry,
      clearance,
      blendEnds,
    });
    this.grid.carve(shape, smooth);
    if (walk) {
      const clearMin = Math.min(
        clearance?.left ?? shape.config.minNavigationClearance,
        clearance?.right ?? shape.config.minNavigationClearance,
      );
      const navWidth = Math.max(0.6, Math.min(width - WALL_MARGIN * 2, clearMin * 1.85));
      const { stations } = shape.spine;
      for (let i = 0; i < stations.length - 1; i += 1) {
        this.nav.addSegment(stations[i], stations[i + 1], navWidth);
      }
    }
    return shape;
  }

  /**
   * A meltwater tube through floor `points`: a smooth curve whose bore swells
   * and pinches by `pinch` (0..1) along the way, as running water leaves it.
   */
  tube(points, { width, height, arch = 0.85, smooth = 1, pinch = 0.25 }) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'centripetal');
    const count = Math.max(2, Math.round(curve.getLength() / TUBE_STEP));
    const stations = curve.getSpacedPoints(count);
    for (let index = 0; index < count; index += 1) {
      // Sampled by distance, so the bore changes over metres however finely the tube is cut.
      const bore = 1 + (fbm3(index * TUBE_STEP * 0.11, 0.5, 0.5, this.seed + 71, 2) - 0.5) * 2 * pinch;
      this.passage(stations[index], stations[index + 1],
        { width: width * bore, height: height * (1 + (bore - 1) * 0.6), arch, smooth });
    }
  }

  /** Opens a domed chamber and makes a disc of its floor walkable. */
  room(center, { rx, ry, rz, floorY, smooth = 0, walkRadius = Math.min(rx, rz) - 1.2 }) {
    this.grid.carve(chamber(center, { rx, ry, rz, floorY }), smooth);
    if (walkRadius > 0) this.nav.addDisc({ x: center.x, y: floorY, z: center.z }, walkRadius);
  }

  /**
   * A light source, baked into every surface in range and optionally pooled for runtime flicker & highlights.
   *
   * @param {{x:number,y:number,z:number}} at
   * @param {string|number} tint colour
   * @param {number} intensity
   * @param {number} range metres
   * @param {{
   *   radius?: number,
   *   flat?: boolean,
   *   halo?: number,
   *   haloGain?: number,
   *   dynamic?: boolean,
   *   importance?: number,
   *   flicker?: number,
   *   section?: string,
   * }} [options] `halo` is the glow sprite's size in metres
   */
  light(at, tint, intensity, range, {
    radius = 1,
    flat = false,
    halo = 0,
    haloGain = 0.5,
    dynamic = !flat,
    importance = 1,
    flicker = 0.08,
    section = 'default',
  } = {}) {
    const linear = new THREE.Color(tint);
    const color = [linear.r * intensity, linear.g * intensity, linear.b * intensity];
    this.lights.push({ x: at.x, y: at.y, z: at.z, color, range, radius, flat });
    if (halo > 0) {
      this.halos.push({
        x: at.x, y: at.y, z: at.z,
        color: [linear.r * haloGain, linear.g * haloGain, linear.b * haloGain],
        size: halo,
      });
    }
    if (dynamic && !flat && range > 0) {
      this.dynamicLights.push({
        x: at.x,
        y: at.y,
        z: at.z,
        color: [linear.r, linear.g, linear.b],
        intensity,
        range,
        radius,
        importance,
        flicker,
        section,
      });
    }
  }

  /** Sunlight (or moonlight) from `direction`, shadowed by the volume and filtered by any ice it crosses. */
  sun(direction, tint, intensity) {
    this.sunward = { direction: this.#parallel(direction, tint, intensity), tint };
  }

  /** Adds a parallel light and returns its unit direction. */
  #parallel(direction, tint, intensity) {
    const linear = new THREE.Color(tint);
    const length = Math.hypot(...direction);
    const toward = direction.map((axis) => axis / length);
    this.lights.push({
      direction: toward, range: SKY_REACH, color: [linear.r * intensity, linear.g * intensity, linear.b * intensity],
    });
    return toward;
  }

  /**
   * A shaft of sunlight through an opening at `through`, from just sunward of
   * it to wherever the light lands. Does nothing in a place without a sun.
   */
  sunShaft(through, width, strength) {
    if (!this.sunward) return;
    const [dx, dy, dz] = this.sunward.direction;
    const along = (reach) => ({ x: through.x - dx * reach, y: through.y - dy * reach, z: through.z - dz * reach });
    let reach = 3;
    while (reach < SKY_REACH / 2 && this.grid.sample(along(reach).x, along(reach).y, along(reach).z) > 0) reach += 1;
    this.shaft(along(-3), along(reach), width, this.sunward.tint, strength);
  }

  /** Skylight: `intensity` in total, spread over the dome so hollows and crevasses darken. */
  sky(tint, intensity) {
    for (const direction of SKY_DIRECTIONS) this.#parallel(direction, tint, intensity / SKY_DIRECTIONS.length);
  }

  /** A point that sheds particles of `kind` (an `emitters` entry of the atmosphere profile): smoke, drips. */
  emit(kind, at) {
    (this.emitters[kind] ??= []).push({ x: at.x, y: at.y, z: at.z });
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

  /**
   * Standable ground under `y` at a plan point: its height, read between cells
   * so a walker does not ride the voxel steps. Null if `y` is inside something,
   * nothing lies within `reach` below it, or what does is too steep to stand on.
   */
  terrainAt(x, y, z, reach = 7) {
    const step = this.grid.voxel * 0.5;
    let above = this.grid.sample(x, y, z);
    if (above < 0) return null;
    for (let drop = step; drop <= reach; drop += step) {
      const below = this.grid.sample(x, y - drop, z);
      if (below < 0) {
        const height = y - drop + step * (below / (below - above));
        return this.grid.gradient(x, height, z, this.#normal).y > MIN_STANDABLE ? height : null;
      }
      above = below;
    }
    return null;
  }

  /** Whether nothing stands between a point and the sky. Always false in a closed volume. */
  skyAbove(x, y, z) {
    const { grid } = this;
    if (!grid.open) return false;
    for (let up = y; up < grid.min.y + grid.ny * grid.voxel; up += grid.voxel) {
      if (grid.solidAt(x, up, z)) return false;
    }
    return true;
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
   * Meshes the volume and the props and bakes direct lighting, structural prop shadows,
   * contact AO, and optional multi-bounce indirect irradiance into both.
   *
   * @param {object} options
   * @param {Record<string, { material: Material, ice?: number }>} options.materials `terrain` plus one per prop key
   * @param {{ rock: number[], ice: number[] }} options.absorption
   * @param {number} [options.bakeGain] scales every baked light: the lighting profile's overall lamp strength
   * @param {{ strength?: number, cellSize?: number, radius?: number, wrap?: number, maxEnergy?: number }|null} [options.indirectBounce]
   * @param {{ resolution?: number, minTransmit?: number, contactStrength?: number }|null} [options.propShadows]
   * @returns {THREE.Group}
   */
  build({ materials, absorption, bakeGain = 1, indirectBounce = null, propShadows = null }) {
    const group = new THREE.Group();
    const preparedProps = [];
    const propGrid = new PropOcclusionGrid(propShadows?.resolution ?? 0.16);
    const pointLights = this.lights.filter((light) => !light.direction && !light.flat);

    for (const [key, parts] of this.props) {
      const entry = materials[key];
      if (!entry) throw new Error(`Location prop material "${key}" is not in the generator's material set.`);
      const needWood = Boolean(entry.woodGrain) || parts.some((part) => part.attributes.woodMask);
      const needUv = needWood || parts.some((part) => part.attributes.uv);
      for (const part of parts) {
        const vCount = part.attributes.position.count;
        if (needUv && !part.attributes.uv) {
          part.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vCount * 2), 2));
        } else if (!needUv && part.attributes.uv) {
          part.deleteAttribute('uv');
        }
        if (needWood && !part.attributes.woodMask) {
          part.setAttribute('woodMask', new THREE.BufferAttribute(new Float32Array(vCount * 4), 4));
        }
      }
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      if (key !== 'glow' && key !== 'water') {
        propGrid.addTriangles(geometry.attributes.position.array, {
          excludeLights: pointLights,
          excludeRadius: propShadows?.excludeRadius ?? 0.3,
        });
      }
      preparedProps.push({ key, entry, geometry });
    }

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
      grid: this.grid,
      propGrid,
      propShadows,
      positions: surface.positions,
      normals: surface.normals,
      lights: this.lights,
      iceAt: (v) => ice[v],
      absorption,
    });
    for (let i = 0; i < baked.light.length; i += 1) baked.light[i] *= bakeGain;

    let bounceField = null;
    if (indirectBounce && indirectBounce.strength > 0) {
      bounceField = createBounceField({
        grid: this.grid,
        positions: surface.positions,
        normals: surface.normals,
        directLight: baked.light,
        cellSize: indirectBounce.cellSize ?? 1.25,
        radius: indirectBounce.radius ?? 9.5,
        maxEnergy: indirectBounce.maxEnergy ?? 2.2,
      });
      gatherBounceLight(bounceField, {
        positions: surface.positions,
        normals: surface.normals,
        light: baked.light,
        dir: baked.dir,
        shade: baked.shade,
        shadeSize: SHADE_SIZE,
        strength: indirectBounce.strength,
        wrap: indirectBounce.wrap ?? 0.52,
      });
    }

    smoothAttribute(surface.indices, baked.light, 3, 1);
    const rawAO = new Float32Array(count);
    for (let v = 0; v < count; v += 1) rawAO[v] = baked.shade[v * SHADE_SIZE];
    smoothAttribute(surface.indices, baked.shade, SHADE_SIZE, 1);
    for (let v = 0; v < count; v += 1) {
      const smoothed = baked.shade[v * SHADE_SIZE];
      // Preserve crisp dark timber/rock contact AO while gently damping isolated voxel spikes.
      baked.shade[v * SHADE_SIZE] = rawAO[v] < smoothed
        ? rawAO[v] * 0.82 + smoothed * 0.18
        : rawAO[v] * 0.55 + smoothed * 0.45;
    }
    const chunks = splitByColumns({
      indices: surface.indices,
      attributes: {
        position: { array: surface.positions, size: 3 }, normal: { array: surface.normals, size: 3 },
        bakeLight: { array: baked.light, size: 3 }, bakeDir: { array: baked.dir, size: 3 },
        bakeShade: { array: baked.shade, size: SHADE_SIZE },
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

    for (const { key, entry, geometry } of preparedProps) {
      const at = geometry.attributes.position.array, facing = geometry.attributes.normal.array;
      // A prop stands in whatever the place is made of there: a barrel in an ice store is lit through ice.
      const medium = (v) => {
        p.x = at[v * 3]; p.y = at[v * 3 + 1]; p.z = at[v * 3 + 2];
        n.x = facing[v * 3]; n.y = facing[v * 3 + 1]; n.z = facing[v * 3 + 2];
        return this.classify(p, n, m, m2);
      };
      const lit = bakeLighting({
        grid: this.grid,
        propGrid: key === 'glow' ? null : propGrid,
        propShadows: { ...(propShadows ?? {}), isProp: true },
        positions: at,
        normals: facing,
        lights: this.lights,
        iceAt: medium,
        wrapAt: () => entry.ice ?? 0,
        absorption,
      });
      for (let i = 0; i < lit.light.length; i += 1) lit.light[i] *= bakeGain;
      if (bounceField && key !== 'glow') {
        gatherBounceLight(bounceField, {
          positions: at,
          normals: facing,
          light: lit.light,
          dir: lit.dir,
          shade: lit.shade,
          shadeSize: SHADE_SIZE,
          strength: indirectBounce.strength,
          wrap: indirectBounce.wrap ?? 0.52,
        });
      }
      // An icicle is as thick as itself, not as the roof it hangs from.
      if (entry.ice) {
        for (let v = 1; v < lit.shade.length; v += SHADE_SIZE) lit.shade[v] = Math.min(lit.shade[v], PROP_ICE_THICKNESS);
      }
      geometry.setAttribute('bakeLight', new THREE.BufferAttribute(lit.light, 3));
      geometry.setAttribute('bakeDir', new THREE.BufferAttribute(lit.dir, 3));
      geometry.setAttribute('bakeShade', new THREE.BufferAttribute(lit.shade, SHADE_SIZE));
      geometry.computeBoundingSphere();
      group.add(new THREE.Mesh(geometry, entry.material));
    }
    group.traverse((object) => { object.matrixAutoUpdate = false; });
    return group;
  }
}
