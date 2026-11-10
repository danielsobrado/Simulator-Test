import * as THREE from 'three/webgpu';
import { Rng } from '../../_clod_shims/seed.js';
import { DEFAULT_WEATHER_EFFECTS } from '../WeatherEffectsConfig.js';
import { createSnowfallMaterial, createSnowfallUniforms } from './snowfallFieldMaterial.js';
import { interleaveLayers, layerAllocation, precipitationDensity } from '../storm/precipitationLayers.js';

/** Populations allocated at their densest level; `count` is that allocation. */
export function snowfallPopulations(settings = DEFAULT_WEATHER_EFFECTS.snowfall) {
  const allocation = layerAllocation(settings.layers);
  return settings.layers.map((layer, index) => Object.freeze({ ...layer, count: allocation[index], width: layer.area,
    height: settings.top - settings.bottom, fallSpeed: settings.speed * layer.speedScale }));
}

export const SNOWFALL_POPULATIONS = Object.freeze(snowfallPopulations());
export function snowfallFlakeCount(populations = SNOWFALL_POPULATIONS) {
  return populations.reduce((total, population) => total + population.count, 0);
}

/**
 * Shared four-vertex quad; each flake stores only its seed and population data.
 * Populations are interleaved and `snowSeed.w` is the flake's stratified rank in
 * its population, so a density culls from the end of the buffer (precipitationLayers.js).
 * @returns {THREE.InstancedBufferGeometry} with `userData.slots` (per population, slot of each rank)
 */
export function createSnowfallGeometry(populations = SNOWFALL_POPULATIONS, random = Math.random) {
  const { layer: layerOf, rank, slots } = interleaveLayers(populations.map((population) => population.count));
  const count = layerOf.length;
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry().copy(base);
  base.dispose();
  const seeds = new Float32Array(count * 4);
  const shapes = new Float32Array(count * 4);
  const appearances = new Float32Array(count * 4);
  const layers = new Float32Array(count);
  for (let flake = 0; flake < count; flake += 1) {
    const layer = layerOf[flake];
    const population = populations[layer];
    const at = flake * 4;
    seeds.set([random(), random(), random(), (rank[flake] + random()) / population.count], at);
    const size = THREE.MathUtils.lerp(population.sizeMin, population.sizeMax, random());
    shapes.set([population.width, population.height, size,
      population.fallSpeed * (0.6 + random() * 0.75)], at);
    appearances.set([population.nearFade, population.softness,
      population.brightness, population.opacity * (0.55 + random() * 0.45)], at);
    layers[flake] = layer;
  }
  geometry.setAttribute('snowSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.setAttribute('snowShape', new THREE.InstancedBufferAttribute(shapes, 4));
  geometry.setAttribute('snowAppearance', new THREE.InstancedBufferAttribute(appearances, 4));
  geometry.setAttribute('snowLayer', new THREE.InstancedBufferAttribute(layers, 1));
  geometry.instanceCount = count;
  geometry.userData.slots = slots;
  return geometry;
}

export function createSnowfallField(settings = DEFAULT_WEATHER_EFFECTS.snowfall, seed = 0x51eaf00d) {
  const uniforms = createSnowfallUniforms(settings);
  const material = createSnowfallMaterial(uniforms, settings);
  const rng = new Rng(seed);
  const geometry = createSnowfallGeometry(snowfallPopulations(settings), () => rng.float());
  const wind = uniforms.wind.value.set(-0.62, 0.21);
  const origin = new THREE.Vector2();
  const updatePhases = () => {
    settings.layers.forEach((layer, index) => {
      // Reduce canonical coordinates in double precision on the CPU. A large
      // Azgaar origin never enters the float32 shader, and rebasing preserves flakes.
      uniforms.phases.array[index].set(
        ((uniforms.center.value.x + origin.x - uniforms.drift.value.x) % layer.area) / layer.area,
        ((uniforms.center.value.z + origin.y - uniforms.drift.value.y) % layer.area) / layer.area,
      );
    });
  };
  let lastTime = null;
  let disposed = false;
  let density = precipitationDensity(settings.layers, 0, geometry.userData.slots);
  return {
    material, geometry, uniforms,
    setTime(seconds) {
      // Integrate the wind (which carries the world gust) rather than
      // multiplying it by time, so a gust changes the speed, never the place.
      if (lastTime !== null && seconds > lastTime) {
        uniforms.drift.value.addScaledVector(wind, Math.min(0.25, seconds - lastTime));
      }
      lastTime = seconds;
      uniforms.time.value = seconds;
      updatePhases();
    },
    /**
     * The snow channel (precipitation × snow share, or the regional floor): live
     * flakes per population from the per-level tables. Above 1 (QA intensities)
     * the storm counts stay and only the opacity grows.
     */
    setIntensity(value) {
      const channel = Math.max(0, Number(value) || 0);
      density = precipitationDensity(settings.layers, Math.min(1, channel), geometry.userData.slots);
      density.density.forEach((share, layer) => { uniforms.densities.array[layer] = share; });
      geometry.instanceCount = density.instanceCount;
      uniforms.intensity.value = density.fade * Math.max(1, channel);
    },
    getDensity: () => density,
    setCenter(center) { uniforms.center.value.copy(center); updatePhases(); },
    setOrigin(value) { origin.set(value?.x ?? 0, value?.z ?? 0); updatePhases(); },
    setWind(x, z) { wind.set(x, z); },
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
      geometry.dispose();
    },
  };
}
