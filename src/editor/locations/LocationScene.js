import * as THREE from 'three/webgpu';
import { generateLocation } from './LocationBuilder.js';
import { createFlames, createHalos, createLightShaft, createParticles } from './LocationEffects.js';
import { createEmitters } from './LocationEmitters.js';
import { createSky } from './LocationSky.js';
import { locationLight } from './materials/LocationShading.js';
import { LocationMaterials } from './materials/LocationMaterials.js';
import { LocationLightPool } from './LocationLightPool.js';

/** Share of the gap to the target that the indoor/outdoor weather fade closes each frame. */
const WEATHER_EASE = 0.06;

/**
 * One prepared location: its own `THREE.Scene`, walkable ground and every GPU
 * resource it brought into existence. Nothing here touches the world scene, so
 * a failed `prepare` can be thrown away without the world noticing, and
 * `dispose` returns the renderer to exactly what it held before.
 */
export class LocationScene {
  /**
   * Builds a site, yielding between stages so the loading screen keeps painting.
   *
   * @param {object} options
   * @param {object} options.site a resolved site from the catalog
   * @param {{ bounds: object, generate: Function }} options.generator
   * @param {object} options.quality the active quality tier
   * @param {string} options.baseUrl
   * @param {THREE.WebGPURenderer} options.renderer
   * @param {THREE.Camera} options.camera for shader warm-up
   * @param {(stepId: string) => Promise<void>} options.progress marks a loading step and yields a frame
   */
  static async prepare({ site, generator, quality, baseUrl, renderer, camera, progress }) {
    const location = new LocationScene(site);
    try {
      await progress('load-assets');
      location.materials = new LocationMaterials({ baseUrl, anisotropy: renderer.getMaxAnisotropy?.() ?? 8 });
      const materials = await location.materials.create(site.materials, quality);

      await progress('build-geometry');
      const builder = generateLocation(site, generator);
      if (!builder.spawns.entry) throw new Error(`Location "${site.id}" generated no entry spawn.`);
      if (builder.exits.length === 0) throw new Error(`Location "${site.id}" generated no exit.`);

      await progress('bake-lighting');
      location.scene.add(builder.build({
        materials,
        absorption: site.lighting.absorption,
        bakeGain: site.lighting.bakeGain ?? 1,
        indirectBounce: site.lighting.indirectBounce ?? null,
        propShadows: site.lighting.propShadows ?? null,
      }));
      location.lightPool = new LocationLightPool(builder.dynamicLights, {
        gain: site.lighting.dynamicGain ?? (site.lighting.indirectBounce ? 0.28 : 0.14),
      });
      if (builder.halos.length > 0) location.scene.add(createHalos(builder.halos));
      if (builder.flames.length > 0) location.scene.add(createFlames(builder.flames));
      for (const shaft of builder.shafts) location.scene.add(createLightShaft(shaft));
      for (const profile of site.atmosphere.particles ?? []) {
        const anchor = profile.anchor ? builder.anchors[profile.anchor] : null;
        if (profile.anchor && !anchor) throw new Error(`Location "${site.id}" has no "${profile.anchor}" anchor for its particles.`);
        location.scene.add(createParticles({
          ...profile, count: Math.max(1, Math.round(profile.count * quality.particleScale)), anchorPoint: anchor,
        }));
      }
      for (const [kind, points] of Object.entries(builder.emitters)) {
        const profile = site.atmosphere.emitters?.[kind];
        if (!profile) throw new Error(`Location "${site.id}" sheds "${kind}" but its atmosphere profile has no such emitter.`);
        location.scene.add(createEmitters(profile, points, quality.particleScale));
      }
      if (site.lighting.sky) {
        location.sky = createSky(site.lighting.sky);
        location.scene.add(location.sky.group);
      }
      location.skyAbove = (point) => builder.skyAbove(point.x, point.y, point.z);
      location.nav = builder.nav;
      location.spawns = builder.spawns;
      location.exits = builder.exits;

      await progress('prepare-shaders');
      location.applyLighting();
      location.lightPool?.update(builder.spawns.entry, 0);
      await renderer.compileAsync(location.scene, camera);
      return location;
    } catch (error) {
      location.dispose();
      throw error;
    }
  }

  constructor(site) {
    this.site = site;
    this.scene = new THREE.Scene();
    this.scene.name = `location:${site.id}`;
    this.scene.background = new THREE.Color(site.lighting.background);
    this.scene.fog = new THREE.FogExp2(site.lighting.fog.color, site.lighting.fog.density);
    this.materials = null;
    this.lightPool = null;
    this.sky = null;
    this.clockStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.skyAbove = () => false;
    this.nav = null;
    this.spawns = {};
    this.exits = [];
    this.disposed = false;
  }

  /** Points the shared lighting uniforms at this location's profile. */
  applyLighting() {
    const { ambientUp, ambientDown, carried } = this.site.lighting;
    locationLight.ambientUp.value.set(ambientUp);
    locationLight.ambientDown.value.set(ambientDown);
    locationLight.carriedColor.value.set(carried.color).multiplyScalar(carried.intensity);
    locationLight.carriedRange.value = carried.range;
    locationLight.outdoors.value = 1;
    this.lightPool?.update(locationLight.carriedPosition.value, 0);
  }

  /** The carried lamp sits just below the eye so it lights what is looked at without flattening it. */
  update(camera) {
    locationLight.carriedPosition.value.copy(camera.position);
    locationLight.carriedPosition.value.y -= 0.35;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.lightPool?.update(camera.position, (nowMs - this.clockStartMs) * 0.001);
    this.sky?.follow(camera);
    // Eased, so snowfall thins out over a few steps through a doorway instead of switching off.
    const outdoors = locationLight.outdoors;
    outdoors.value += ((this.skyAbove(camera.position) ? 1 : 0) - outdoors.value) * WEATHER_EASE;
  }

  /** The exit within reach of a foot position, or null. */
  exitNear(x, y, z) {
    for (const exit of this.exits) {
      if (Math.abs(y - exit.y) < 3 && Math.hypot(x - exit.x, z - exit.z) <= exit.radius) return exit;
    }
    return null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lightPool?.dispose();
    const owned = new Set();
    this.scene.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) owned.add(object.material);
    });
    for (const material of owned) material.dispose();
    this.materials?.dispose();
    this.scene.clear();
  }
}
