import { frameUniform } from '../../../render/FrameUniforms.js';
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
  select,
  sin,
  smoothstep,
  float,
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
/** Longest streak on screen, in radians (~75 px): a gale's flake a metre away stays a dash, not a line. */
export const SNOWFLAKE_MAX_STREAK = 0.055;
export function createSnowfallUniforms(settings = DEFAULT_WEATHER_EFFECTS.snowfall) {
  return {
    time: frameUniform(0), center: uniform(new THREE.Vector3()),
    drift: frameUniform(new THREE.Vector2()), intensity: frameUniform(1),
    /** Drift velocity (m/s, x and z): flakes streak along it with their fall. */
    wind: frameUniform(new THREE.Vector2()), shutter: frameUniform(settings.streakSeconds ?? 0),
    color: frameUniform(new THREE.Color(settings.color)), opacity: frameUniform(settings.opacity),
    phases: uniformArray(settings.layers.map(() => new THREE.Vector2())),
    /** Live share of each population (count-based density); flakes ranked above it are culled. */
    densities: uniformArray(settings.layers.map(() => 0), 'float'),
    /** How strongly each population gathers into drifting sheets (0 even … 1 banded). */
    sheets: uniformArray(settings.layers.map((layer) => layer.sheets ?? 0), 'float'),
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
  const layer = attribute('snowLayer', 'float').toUint();
  const phaseOffset = uniforms.phases.element(layer);
  const offset = fract(seed.xy.add(swirl.div(width)).sub(phaseOffset)).sub(0.5).mul(width);
  const flake = vec3(center.x.add(offset.x), center.y.add(y), center.z.add(offset.y));
  const fadeStart = appearance.x.max(0.001);
  const distance = cameraPosition.distance(flake);
  const lens = smoothstep(fadeStart, fadeStart.mul(3), distance);
  // Density is count, not opacity: a flake ranked above its population's live
  // share collapses to nothing (four vertices, no fragments).
  const alive = select(seed.w.lessThan(uniforms.densities.element(layer)), float(1), float(0));
  // Cap the angular size: a world-sized flake a metre from the eye otherwise
  // fills a fifth of the screen as a white blob, and its quad dominates overdraw.
  const size = shape.z.min(distance.mul(SNOWFLAKE_MAX_ANGULAR_SIZE));
  // Motion streak: the flake's velocity on the view plane over a short shutter,
  // so a gale draws dashes along the wind and a calm fall stays round.
  const view = flake.sub(cameraPosition).div(distance.max(1e-3));
  const velocity = vec3(uniforms.wind.x, shape.w.negate(), uniforms.wind.y);
  const across = velocity.sub(view.mul(velocity.dot(view)));
  const speed = across.length();
  const up = cameraWorldMatrix.element(1).xyz;
  const axis = select(speed.greaterThan(1e-3), across.div(speed.max(1e-3)), up);
  const side = axis.cross(view).normalize();
  const length = size.max(speed.mul(uniforms.shutter).min(distance.mul(SNOWFLAKE_MAX_STREAK)));
  const scale = lens.mul(alive);
  const corner = positionGeometry.xy;
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.name = 'weather-gods-end-snowfall';
  material.forceSinglePass = true;
  material.positionNode = flake.add(side.mul(corner.x.mul(size).mul(scale))).add(axis.mul(corner.y.mul(length).mul(scale)));
  // Gust sheets: a population's flakes thin and thicken in bands that ride the
  // drift with them (seed space tiles the box, so the bands wrap seamlessly).
  const band = sin(seed.x.mul(3).add(seed.y.mul(2)).mul(TAU).add(time.mul(0.35))).mul(0.5).add(0.5);
  const sheet = mix(float(1), smoothstep(0.15, 0.85, band).mul(1.6), uniforms.sheets.element(layer));
  // A streak spreads the flake's light: thinner, not brighter.
  const thinning = size.div(length.max(1e-5)).sqrt().mul(sheet).toVarying('snowfallThinning');
  const edge = corner.length().mul(2);
  const crisp = edge.oneMinus().clamp(0, 1).pow(1.4);
  const defocused = smoothstep(0, 0.65, edge.oneMinus());
  material.opacityNode = mix(crisp, defocused, appearance.y).mul(appearance.w).mul(thinning)
    .mul(uniforms.opacity).mul(lens).mul(intensity.clamp(0, 1.4));
  material.colorNode = uniforms.color.mul(skyLightUniforms.reflectionTint)
    .mul(skyLightUniforms.brightness).mul(appearance.z);
  return material;
}
