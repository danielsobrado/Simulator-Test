import { frameUniform } from '../../render/FrameUniforms.js';
// Adapted from drusniel-gods-end/src/weather/RainSystem.js.
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, float, fract, hash, instanceIndex, mix,
  positionGeometry, select, uniform, uniformArray, uv, vec2, vec3,
} from 'three/tsl';
import { Rng } from '../_clod_shims/seed.js';
import { DEFAULT_WEATHER_EFFECTS } from './WeatherEffectsConfig.js';
import { evaluateLevels, PRECIP_LEVEL_KEYS } from './storm/stormCurves.js';
import { interleaveLayers, layerAllocation, precipitationDensity } from './storm/precipitationLayers.js';
import { skyLightUniforms } from '../stylized/sky/skyLight.js';

/** Streak width on screen, in radians: ~1–3 px at 1600 px / 60° (storm plan §3.1). */
export const RAIN_MIN_ANGULAR_WIDTH = 0.0008;
export const RAIN_MAX_ANGULAR_WIDTH = 0.002;
/** Longest streak on screen (~125 px), so a drop at the eye is not a bar across the view. */
export const RAIN_MAX_ANGULAR_LENGTH = 0.09;

/** Per-instance layer data: interleaved layers, each drop's stratified rank and its size. */
export function createRainFieldGeometry(settings = DEFAULT_WEATHER_EFFECTS.rain, seed = 0) {
  const allocation = layerAllocation(settings.layers);
  const { layer, rank, slots } = interleaveLayers(allocation);
  const rng = new Rng(seed ^ 0x2a1f0c3d);
  const placement = new Float32Array(layer.length * 4);
  const size = new Float32Array(layer.length * 4);
  for (let slot = 0; slot < layer.length; slot += 1) {
    const config = settings.layers[layer[slot]];
    placement.set([layer[slot], (rank[slot] + rng.float()) / allocation[layer[slot]], config.area, config.bottom], slot * 4);
    size.set([config.top - config.bottom, THREE.MathUtils.lerp(config.lengthMin, config.lengthMax, rng.float()),
      THREE.MathUtils.lerp(config.widthMin, config.widthMax, rng.float()), 0], slot * 4);
  }
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, -0.5, 0);
  const geometry = new THREE.InstancedBufferGeometry().copy(base);
  base.dispose();
  geometry.setAttribute('rainPlacement', new THREE.InstancedBufferAttribute(placement, 4));
  geometry.setAttribute('rainSize', new THREE.InstancedBufferAttribute(size, 4));
  geometry.instanceCount = 0;
  return { geometry, slots };
}

/** One GPU-animated instanced field; existing terrain/water impacts stay separate. */
export function createCinematicRainField(settings = DEFAULT_WEATHER_EFFECTS.rain, seed = 0) {
  const { geometry, slots } = createRainFieldGeometry(settings, seed);
  const center = uniform(new THREE.Vector3());
  const clock = frameUniform(0);
  const intensity = frameUniform(0);
  const wind = frameUniform(new THREE.Vector2());
  // Wind × the shared camera gust (worldWindCamera), and its integral: travel
  // must integrate the gust, or every drop jumps when the gust changes. The fall
  // is integrated the same way, because its speed changes with the level.
  const vector = frameUniform(new THREE.Vector2());
  const drift = frameUniform(new THREE.Vector2());
  const fallSpeed = frameUniform(settings.levels.fallSpeed[1]);
  const fall = frameUniform(0);
  const densities = uniformArray(settings.layers.map(() => 0), 'float');
  const placement = attribute('rainPlacement', 'vec4');
  const shape = attribute('rainSize', 'vec4');
  const index = instanceIndex.toFloat().add((seed >>> 0) % 65536);
  const random = offset => hash(index.add(offset));
  // Culled drops collapse to zero area: four vertices, no fragments.
  const alive = select(placement.y.lessThan(densities.element(placement.x.toUint())), float(1), float(0));
  const area = placement.z;
  const range = shape.x;
  const speedScale = mix(0.7, 1.35, random(71.91));
  const y = fract(random(41.27).sub(fall.mul(speedScale).div(range))).mul(range).add(placement.w);
  const variation = mix(1 - settings.windVariation, 1 + settings.windVariation, random(121.43));
  const offset = fract(vec2(random(17.13), random(93.71)).add(drift.mul(variation).div(area)))
    .sub(0.5).mul(area);
  const phase = clock.mul(0.7).add(random(211.17).mul(Math.PI * 2));
  const turbulence = settings.turbulence;
  const dropX = center.x.add(offset.x).add(phase.sin().mul(turbulence));
  const dropZ = center.z.add(offset.y).add(phase.cos().mul(turbulence));
  const toCamera = cameraPosition.sub(vec3(dropX, center.y.add(y), dropZ));
  const horizontal = toCamera.xz.length().max(0.001);
  const distance = toCamera.length().max(0.001);
  const right = vec3(toCamera.z.div(horizontal), 0, toCamera.x.div(horizontal).negate());
  const width = shape.z.clamp(distance.mul(RAIN_MIN_ANGULAR_WIDTH), distance.mul(RAIN_MAX_ANGULAR_WIDTH)).mul(alive);
  const length = shape.y.min(distance.mul(RAIN_MAX_ANGULAR_LENGTH)).mul(alive);
  const across = positionGeometry.x.mul(width);
  const along = positionGeometry.y.mul(length);
  const tilt = positionGeometry.y.add(0.5).mul(length).div(fallSpeed.mul(speedScale).max(0.001));
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.name = 'weather-gods-end-rain';
  material.forceSinglePass = true;
  material.positionNode = vec3(dropX, center.y.add(y).add(along), dropZ)
    .add(right.mul(across)).sub(vec3(vector.x, 0, vector.y).mul(variation).mul(tilt));
  const profile = uv().y.mul(float(1).sub(uv().y)).mul(4).clamp(0, 1);
  material.opacityNode = profile.mul(0.1).mul(mix(0.5, 1, random(551.91)))
    .mul(settings.opacity).clamp(0.05, 1).mul(intensity);
  material.colorNode = vec3(...settings.colorLinear).mul(skyLightUniforms.brightness);
  let disposed = false;
  let gust = 1;
  let lastTime = null;
  let density = precipitationDensity(settings.layers, 0, slots);
  return {
    material, geometry, uniforms: { center, time: clock, intensity, wind, vector, drift, fall, fallSpeed, densities },
    setTime: value => {
      vector.value.copy(wind.value).multiplyScalar(Math.min(4, Math.max(0.4, gust)));
      if (lastTime !== null && value > lastTime) {
        const dt = Math.min(0.25, value - lastTime);
        drift.value.addScaledVector(vector.value, dt);
        // Not wrapped: drops fall at their own speed multiples, so no period fits
        // them all (it grows like the former clock × speed did).
        fall.value += fallSpeed.value * dt;
      }
      lastTime = value;
      clock.value = value;
    },
    /** The world wind envelope at the camera (worldWindCamera.envelope). */
    setGust: value => { gust = value; },
    /**
     * The rain channel (precipitation × rain share × gain): live drops per
     * layer, fall speed and opacity from the per-level tables. Above 1 (QA
     * intensities) the storm counts stay and only the opacity grows.
     */
    setIntensity: value => {
      const channel = Math.max(0, Number(value) || 0);
      density = precipitationDensity(settings.layers, Math.min(1, channel), slots);
      density.density.forEach((share, layer) => { densities.array[layer] = share; });
      geometry.instanceCount = density.instanceCount;
      const level = Math.min(1, channel);
      fallSpeed.value = evaluateLevels(settings.levels.fallSpeed, level, PRECIP_LEVEL_KEYS);
      intensity.value = evaluateLevels(settings.levels.opacity, level, PRECIP_LEVEL_KEYS)
        * density.fade * Math.max(1, channel);
    },
    getDensity: () => density,
    setCenter: value => { center.value.copy(value); },
    setWind: (x, z) => { wind.value.set(x, z); },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
