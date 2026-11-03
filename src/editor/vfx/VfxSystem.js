import * as THREE from 'three';
import { bakeParticleAtlas, createParticleAtlasTexture } from './atlas/ParticleAtlasBaker.js';
import { createEffectDirector } from './effects/EffectDirector.js';
import { createParticleSimulator, createSpawnParams } from './particles/ParticleSimulator.js';
import { EFFECT_RECIPES } from './recipes/index.js';
import { createCameraShake } from './render/CameraShake.js';
import { createDecalLayer } from './render/DecalLayer.js';
import { createEffectLightPool } from './render/EffectLightPool.js';
import { createParticleRenderer } from './render/ParticleRenderer.js';
import { createVfxLightingUniforms } from './render/VfxLightingUniforms.js';
import { createWaterBlobLayer } from './render/WaterBlobLayer.js';
import { createSpellParticleTypes } from './types/index.js';

const MAX_STEP_S = 1 / 20;
const LIGHT_SCAN_INTERVAL_S = 2;

function findSceneLights(scene) {
  let directional = null;
  let hemisphere = null;
  scene.traverse((object) => {
    if (!directional && object.isDirectionalLight && object.visible) directional = object;
    if (!hemisphere && object.isHemisphereLight && object.visible) hemisphere = object;
  });
  return { directional, hemisphere };
}

/**
 * The procedural VFX stack: one atlas baked at startup, one CPU particle
 * simulator, one instanced particle draw, one decal draw, a small light pool
 * and camera shake, all driven by effect recipes.
 *
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {(x: number, z: number) => number} deps.groundHeight render-space terrain height
 * @param {() => ({ directional?: THREE.DirectionalLight, hemisphere?: THREE.HemisphereLight })} [deps.getSceneLights]
 * @param {{ play(name: string, origin: object, options?: object): void, setListener?(camera): void }} [deps.sound]
 * @param {number} [deps.capacity]
 * @param {number} [deps.sceneLights] real point lights lighting the world (default 0)
 * @param {(x: number, z: number, radius: number, strength: number, inner: number) => void} [deps.pressGround]
 *   flattens grass over a render-space disc (meadow interaction), so blasts bend it and decals show
 * @param {(x: number, z: number, radius: number, mark: string, strength: number, inner: number) => void} [deps.markGround]
 *   tints the grass over a render-space disc: 'scorch', 'singe', 'wither', 'frost', 'acid', 'moon', 'bloom', 'sickly'
 */
export function createVfxSystem(deps) {
  const { scene } = deps;
  const groundHeight = (x, z) => {
    const height = deps.groundHeight(x, z);
    return Number.isFinite(height) ? height : -1e5;
  };
  const baked = bakeParticleAtlas();
  const atlas = createParticleAtlasTexture(baked);
  const lighting = createVfxLightingUniforms();
  const types = createSpellParticleTypes();
  const capacity = deps.capacity ?? 12288;
  const simulator = createParticleSimulator({ types, groundHeight, capacity });
  const renderer = createParticleRenderer({ scene, atlas, lighting, capacity });
  const decals = createDecalLayer({ scene, atlas, lighting, groundHeight });
  const blobs = createWaterBlobLayer({ scene, lighting });
  // No real scene lights by default: one costs every lit pixel every frame,
  // even dimmed (see EffectLightPool). Light pools on the ground stand in.
  const lights = createEffectLightPool({ scene, lighting, sceneLights: deps.sceneLights ?? 0 });
  const poolParams = createSpawnParams();
  const poolType = types.indexOf('light.pool');
  const shake = createCameraShake();
  const listener = new THREE.Vector3();
  const sunDirection = new THREE.Vector3(0.3, 0.8, 0.2).normalize();
  const sky = new THREE.Color();
  const groundColour = new THREE.Color();
  let sceneLights = deps.getSceneLights?.() ?? null;
  let lightScanTimer = 0;
  let time = 0;
  let disposed = false;
  let cpuMs = 0;

  const director = createEffectDirector({
    simulator,
    types,
    lights,
    decals,
    blobs,
    shake,
    sound: deps.sound,
    groundHeight,
    pressGround: deps.pressGround,
    markGround: deps.markGround,
    getListener: () => listener,
    play: (recipeId, context) => play(recipeId, context),
  });

  let lastPlayed = null;
  function play(recipeId, context) {
    const recipe = EFFECT_RECIPES[recipeId];
    if (!recipe || disposed) return false;
    lastPlayed = { recipeId, context };
    director.play(recipe, { sunDirection: { x: sunDirection.x, y: sunDirection.y, z: sunDirection.z }, ...context });
    return true;
  }

  /**
   * Each lit effect light paints a pool of its colour on the ground just above
   * grass height, sized by its range and as bright as the light reaching it.
   */
  const emitLightPools = () => {
    lights.forEachLit((x, y, z, power, range, r, g, b) => {
      const ground = groundHeight(x, z);
      const height = Math.max(0.5, y - ground);
      const reach = power / (height * height + 4);
      if (reach < 0.05) return;
      poolParams.x = x; poolParams.y = ground + 0.45; poolParams.z = z;
      poolParams.reset();
      poolParams.sizeScale = Math.min(range * 1.4, 3 + height * 2.2);
      // The terrain and grass are lit by the world light now; the pool is the haze over them.
      poolParams.emissiveScale = Math.min(2, reach * 0.03);
      poolParams.opacityScale = 1;
      poolParams.tintR = r; poolParams.tintG = g; poolParams.tintB = b;
      poolParams.rotation = 0;
      simulator.emit(poolType, poolParams);
    });
  };

  const updateSceneLighting = (dt) => {
    lightScanTimer -= dt;
    if (!deps.getSceneLights && (!sceneLights?.directional || lightScanTimer <= 0)) {
      sceneLights = findSceneLights(scene);
      lightScanTimer = LIGHT_SCAN_INTERVAL_S;
    } else if (deps.getSceneLights) {
      sceneLights = deps.getSceneLights();
    }
    const directional = sceneLights?.directional;
    if (directional) {
      sunDirection.copy(directional.position);
      if (directional.target) sunDirection.sub(directional.target.position);
      if (sunDirection.lengthSq() < 1e-8) sunDirection.set(0, 1, 0);
      sunDirection.normalize();
      lighting.sunDirection.value.copy(sunDirection);
      // Lambert's 1/π, as three's own lit materials apply it.
      lighting.sunColor.value.copy(directional.color).multiplyScalar(directional.intensity / Math.PI * Math.max(0, Math.min(1, sunDirection.y * 3 + 0.2)));
    }
    const hemisphere = sceneLights?.hemisphere;
    if (hemisphere) {
      sky.copy(hemisphere.color);
      groundColour.copy(hemisphere.groundColor);
      lighting.ambientSky.value.copy(sky).multiplyScalar(hemisphere.intensity / Math.PI);
      lighting.ambientGround.value.copy(groundColour).lerp(sky, 0.25).multiplyScalar(hemisphere.intensity / Math.PI);
    }
  };

  return {
    play,
    has: (recipeId) => Boolean(EFFECT_RECIPES[recipeId]),
    get recipes() {
      return Object.keys(EFFECT_RECIPES);
    },
    /**
     * @param {number} deltaSeconds
     * @param {THREE.Camera} camera
     */
    update(deltaSeconds, camera) {
      if (disposed) return;
      const started = performance.now();
      const dt = Math.min(MAX_STEP_S, Math.max(0, deltaSeconds));
      time += dt;
      lighting.time.value = time % 1000;
      camera.getWorldPosition(listener);
      updateSceneLighting(dt);
      director.update(dt);
      simulator.update(dt);
      lights.update(dt, time);
      emitLightPools();
      decals.update(dt);
      blobs.update(dt);
      shake.update(dt, camera);
      renderer.update(simulator, camera);
      deps.sound?.setListener?.(camera);
      cpuMs += (performance.now() - started - cpuMs) * 0.1;
    },
    /** Stops every running effect and drops its particles; decals and lights fade out. */
    clear() {
      director.clear();
      simulator.clear();
    },
    shiftOrigin(shiftX, shiftZ) {
      simulator.shiftOrigin(shiftX, shiftZ);
      decals.shiftOrigin(shiftX, shiftZ);
      blobs.shiftOrigin(shiftX, shiftZ);
      lights.shiftOrigin(shiftX, shiftZ);
    },
    /** Compiles the particle and decal pipelines so the first cast never hitches. */
    async precompile(webgpuRenderer, camera) {
      const compile = webgpuRenderer?.compileAsync;
      if (typeof compile !== 'function') return false;
      const compileScene = new THREE.Scene();
      const restoreParticles = renderer.prepareForCompile();
      const restoreDecals = decals.prepareForCompile();
      const restoreBlobs = blobs.prepareForCompile();
      const particleProxy = new THREE.Mesh(renderer.mesh.geometry, renderer.mesh.material);
      const decalProxy = new THREE.Mesh(decals.mesh.geometry, decals.mesh.material);
      const blobProxy = new THREE.Mesh(blobs.mesh.geometry, blobs.mesh.material);
      particleProxy.frustumCulled = false;
      decalProxy.frustumCulled = false;
      blobProxy.frustumCulled = false;
      compileScene.add(particleProxy, decalProxy, blobProxy);
      try {
        await compile.call(webgpuRenderer, compileScene, camera);
        return true;
      } catch (error) {
        console.warn('[vfx] Particle pipeline precompile failed; first cast may hitch.', error);
        return false;
      } finally {
        restoreParticles();
        restoreDecals();
        restoreBlobs();
      }
    },
    stats() {
      return {
        particles: simulator.count,
        dropped: simulator.dropped,
        effects: director.activeCount,
        decals: decals.activeCount,
        lights: lights.activeCount,
        atlasBakeMs: Math.round(baked.milliseconds),
        trauma: shake.trauma,
        cpuMs: Math.round(cpuMs * 100) / 100,
      };
    },
    /** For QA: the raw atlas texture and subsystems. */
    internals: { atlas, simulator, renderer, decals, blobs, lights, lighting, types, get lastPlayed() { return lastPlayed; } },
    dispose() {
      if (disposed) return;
      disposed = true;
      director.clear();
      simulator.clear();
      renderer.dispose();
      decals.dispose();
      blobs.dispose();
      lights.dispose();
      atlas.dispose();
    },
  };
}
