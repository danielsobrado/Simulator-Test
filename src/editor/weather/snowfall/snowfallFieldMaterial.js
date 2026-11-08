// Adapted from drusniel-gods-end/src/weather/SnowfallSystem.js.
import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraWorldMatrix,
  cos,
  fract,
  mix,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl';
import { DEFAULT_WEATHER_EFFECTS } from '../WeatherEffectsConfig.js';
import { skyLightUniforms } from '../../stylized/sky/skyLight.js';

const TAU = Math.PI * 2;
/** Largest flake diameter on screen, in radians (~20 px across at a 60° 1600 px view). */
export const SNOWFLAKE_MAX_ANGULAR_SIZE = 0.014;
export function createSnowfallUniforms(settings = DEFAULT_WEATHER_EFFECTS.snowfall) {
  return {
    time: uniform(0), center: uniform(new THREE.Vector3()),
    drift: uniform(new THREE.Vector2()), intensity: uniform(1),
    color: uniform(new THREE.Color(settings.color)), opacity: uniform(settings.opacity),
    phases: uniformArray(settings.layers.map(() => new THREE.Vector2())),
  };
}

export function createSnowfallMaterial(uniforms, settings = DEFAULT_WEATHER_EFFECTS.snowfall) {
  const seed = attribute('snowSeed', 'vec4');
  const shape = attribute('snowShape', 'vec4');
  const appearance = attribute('snowAppearance', 'vec4');
  const { time, center, intensity } = uniforms;
  const width = shape.x;
  const height = shape.y;
  const fall = fract(seed.z.sub(time.mul(shape.w).div(height)));
  const y = fall.mul(height).add(settings.bottom);
  const phase = time.mul(settings.swayFrequency).add(seed.z.mul(TAU));
  const eddy = sin(time.mul(0.9).add(y.mul(0.13)).add(seed.z.mul(TAU * 3))).mul(settings.turbulence);
  const swirl = vec2(sin(phase).mul(settings.swayRadius).add(eddy),
    cos(phase.mul(0.83)).mul(settings.swayRadius).sub(eddy.mul(0.7)));
  // World-anchored wrapping lets the camera move through the field. Only its
  // bounded window follows the view; seeded flakes do not travel with it.
  const phaseOffset = uniforms.phases.element(attribute('snowLayer', 'float').toUint());
  const offset = fract(seed.xy.add(swirl.div(width)).sub(phaseOffset)).sub(0.5).mul(width);
  const flake = vec3(center.x.add(offset.x), center.y.add(y), center.z.add(offset.y));
  const fadeStart = appearance.x.max(0.001);
  const distance = cameraPosition.distance(flake);
  const lens = smoothstep(fadeStart, fadeStart.mul(3), distance);
  // Coverage fades the field once in opacity, as in Gods' End. Also thinning
  // instances here would square the effect and erase light regional snowfall.
  // Cap the angular size: a world-sized flake a metre from the eye otherwise
  // fills a fifth of the screen as a white blob, and its quad dominates overdraw.
  const size = shape.z.min(distance.mul(SNOWFLAKE_MAX_ANGULAR_SIZE)).mul(lens);
  const right = cameraWorldMatrix.element(0).xyz;
  const up = cameraWorldMatrix.element(1).xyz;
  const corner = positionGeometry.xy;
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.name = 'weather-gods-end-snowfall';
  material.forceSinglePass = true;
  material.positionNode = flake.add(right.mul(corner.x.mul(size))).add(up.mul(corner.y.mul(size)));
  const edge = corner.length().mul(2);
  const crisp = edge.oneMinus().clamp(0, 1).pow(1.4);
  const defocused = smoothstep(0, 0.65, edge.oneMinus());
  material.opacityNode = mix(crisp, defocused, appearance.y).mul(appearance.w)
    .mul(uniforms.opacity).mul(lens).mul(intensity.clamp(0, 1.4));
  material.colorNode = uniforms.color.mul(skyLightUniforms.reflectionTint)
    .mul(skyLightUniforms.brightness).mul(appearance.z);
  return material;
}
