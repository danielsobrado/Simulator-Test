// Adapted from drusniel-gods-end/src/weather/RainSystem.js.
import * as THREE from 'three/webgpu';
import {
  cameraPosition, float, fract, hash, instanceIndex, mix,
  positionGeometry, uniform, uv, vec2, vec3,
} from 'three/tsl';
import { DEFAULT_WEATHER_EFFECTS } from './WeatherEffectsConfig.js';
import { skyLightUniforms } from '../stylized/sky/skyLight.js';

/** One GPU-animated instanced field; existing terrain/water impacts stay separate. */
export function createCinematicRainField(settings = DEFAULT_WEATHER_EFFECTS.rain, seed = 0) {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, -0.5, 0);
  const geometry = new THREE.InstancedBufferGeometry().copy(base);
  geometry.instanceCount = settings.count;
  const center = uniform(new THREE.Vector3());
  const clock = uniform(0);
  const intensity = uniform(0);
  const wind = uniform(new THREE.Vector2());
  // Wind × the shared camera gust (worldWindCamera), and its integral: travel
  // must integrate the gust, or every drop jumps when the gust changes.
  const vector = uniform(new THREE.Vector2());
  const drift = uniform(new THREE.Vector2());
  const index = instanceIndex.toFloat().add((seed >>> 0) % 65536);
  const random = offset => hash(index.add(offset));
  const length = mix(settings.dropLength * 0.45, settings.dropLength * 1.35, random(331.71));
  const width = mix(settings.dropWidth * 0.55, settings.dropWidth * 1.25, random(441.31));
  const speed = mix(settings.speed * 0.7, settings.speed * 1.35, random(71.91));
  const range = settings.top - settings.bottom;
  const y = fract(random(41.27).add(clock.mul(speed).div(range))).mul(range).add(settings.bottom);
  const variation = mix(1 - settings.windVariation, 1 + settings.windVariation, random(121.43));
  const travel = drift.mul(variation);
  const offset = fract(vec2(random(17.13), random(93.71)).add(travel.div(settings.area)))
    .sub(0.5).mul(settings.area);
  const phase = clock.mul(0.7).add(random(211.17).mul(Math.PI * 2));
  const turbulence = settings.turbulence;
  const dropX = center.x.add(offset.x).add(phase.sin().mul(turbulence));
  const dropZ = center.z.add(offset.y).add(phase.cos().mul(turbulence));
  const toCamera = cameraPosition.sub(vec3(dropX, center.y.add(y), dropZ));
  const distance = toCamera.xz.length().max(0.001);
  const right = vec3(toCamera.z.div(distance), 0, toCamera.x.div(distance).negate());
  const across = positionGeometry.x.mul(width);
  const along = positionGeometry.y.mul(length);
  const tilt = positionGeometry.y.add(0.5).mul(length).div(speed.abs().max(0.001));
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
  return {
    material, geometry, uniforms: { center, time: clock, intensity, wind, vector, drift },
    setTime: value => {
      vector.value.copy(wind.value).multiplyScalar(Math.min(4, Math.max(0.4, gust)));
      if (lastTime !== null && value > lastTime) drift.value.addScaledVector(vector.value, Math.min(0.25, value - lastTime));
      lastTime = value;
      clock.value = value;
    },
    /** The world wind envelope at the camera (worldWindCamera.envelope). */
    setGust: value => { gust = value; },
    setIntensity: value => { intensity.value = value; },
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
