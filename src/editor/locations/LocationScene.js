import * as THREE from 'three/webgpu';
import { LocationBuilder } from './LocationBuilder.js';
import { createFlames, createHalos, createLightShaft, createParticles } from './LocationEffects.js';
import { locationLight } from './materials/LocationShading.js';
import { LocationMaterials } from './materials/LocationMaterials.js';

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
      const builder = new LocationBuilder({ seed: site.seed, bounds: generator.bounds, voxel: site.voxel });
      generator.generate(builder, site.params);
      if (!builder.spawns.entry) throw new Error(`Location "${site.id}" generated no entry spawn.`);
      if (builder.exits.length === 0) throw new Error(`Location "${site.id}" generated no exit.`);

      await progress('bake-lighting');
      location.scene.add(builder.build({ materials, absorption: site.lighting.absorption, bakeGain: site.lighting.bakeGain ?? 1 }));
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
      location.nav = builder.nav;
      location.spawns = builder.spawns;
      location.exits = builder.exits;

      await progress('prepare-shaders');
      location.applyLighting();
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
  }

  /** The carried lamp sits just below the eye so it lights what is looked at without flattening it. */
  update(camera) {
    locationLight.carriedPosition.value.copy(camera.position);
    locationLight.carriedPosition.value.y -= 0.35;
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
