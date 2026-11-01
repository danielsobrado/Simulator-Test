import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  densityFogFactor,
  dot,
  exp,
  fog,
  length,
  max,
  oneMinus,
  positionWorld,
  pow,
  select,
  smoothstep,
} from 'three/tsl';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/**
 * Sun-facing aerial perspective. Air scatters sunlight forward, so haze looking
 * toward the sun is warm and bright, and looking away it is a cooler, slightly
 * deeper blue. A single fog colour flattens every heading into the same pale
 * band; this restores the backlit glow and the layered blue ranges of a real
 * landscape. The same term lights the sky dome's horizon, so terrain still
 * fades into the sky without a seam.
 *
 * `tightStrength`/`tightFalloff` shape the bright halo around the sun,
 * `broadStrength`/`broadFalloff` the wide warm side of the sky, and `awayShade`
 * how much the far side darkens. All of it fades out as the sun sets.
 *
 * Aerial perspective: the view-distance fog is exp², tuned for the 90 km
 * far-terrain horizon, so it leaves everything within a few kilometres
 * untouched and ridges at 2–15 km read as crisp as the foreground. An
 * exponential haze reaches 63 % at `aerialDistance` metres, never more than
 * `aerialMax`, and thins with altitude over `aerialHeightScale` metres: a ray
 * climbing to a peak crosses less air than one sinking into a valley, so ranges
 * layer front to back. The weather's fog scale thickens it with the rest.
 */
export const SUN_HAZE_DEFAULTS = Object.freeze({
  enabled: true,
  tightStrength: 0.55,
  tightFalloff: 10,
  broadStrength: 0.22,
  broadFalloff: 2,
  awayShade: 0.12,
  aerialDistance: 14000,
  aerialMax: 0.8,
  aerialHeightScale: 1500,
});

export function resolveSunHazeConfig(sky = {}) {
  const source = sky.sunHaze ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) throw new TypeError('sky.sunHaze must be an object.');
  const value = { ...SUN_HAZE_DEFAULTS, ...source };
  if (typeof value.enabled !== 'boolean') throw new TypeError('sky.sunHaze.enabled must be a boolean.');
  for (const key of ['tightStrength', 'broadStrength', 'awayShade']) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 2) throw new RangeError(`sky.sunHaze.${key} must be in [0, 2].`);
  }
  for (const key of ['tightFalloff', 'broadFalloff']) {
    if (!Number.isFinite(value[key]) || value[key] < 0.5 || value[key] > 256) throw new RangeError(`sky.sunHaze.${key} must be in [0.5, 256].`);
  }
  if (value.awayShade >= 1) throw new RangeError('sky.sunHaze.awayShade must be below 1.');
  for (const [key, min, max] of [['aerialDistance', 100, 1e6], ['aerialMax', 0, 1], ['aerialHeightScale', 10, 1e5]]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new RangeError(`sky.sunHaze.${key} must be in [${min}, ${max}].`);
  }
  return Object.freeze(value);
}

/**
 * How much sunlit haze a view direction sees: `glow` is the warm light added in
 * the sun colour, `shade` the share the far side loses. Both are 0 at night.
 */
export function sunHazeTerms({ direction, sunDirection, settings, presence }) {
  const alignment = dot(direction, sunDirection);
  const toward = clamp(alignment, 0, 1);
  const daylight = smoothstep(-0.1, 0.06, sunDirection.y).mul(presence);
  const glow = pow(toward, settings.tightFalloff).mul(settings.tightStrength)
    .add(pow(toward, settings.broadFalloff).mul(settings.broadStrength))
    .mul(daylight);
  const shade = clamp(alignment.negate(), 0, 1).mul(settings.awayShade).mul(daylight);
  return { glow, shade };
}

/** Haze colour for a view direction: the base colour shaded away from the sun, plus the glow. */
export function sunHazeColor({ baseColor, glowColor, direction, sunDirection, settings, presence }) {
  const { glow, shade } = sunHazeTerms({ direction, sunDirection, settings, presence });
  return baseColor.mul(oneMinus(shade)).add(glowColor.mul(glow));
}

/**
 * Share of the view hidden by aerial haze over `distance`, along a ray rising
 * `rise` metres. Optical depth through air thinning as exp(-h/H) is
 * distance · (1 − e^−x)/x with x = rise/H; x is clamped so a ray diving far
 * into a valley cannot blow up.
 */
function aerialFactorNode({ distance, rise, settings, densityScale }) {
  const x = clamp(rise.div(settings.aerialHeightScale), -3, 20);
  const safeX = select(abs(x).lessThan(1e-3), 1e-3, x);
  const airColumn = oneMinus(exp(safeX.negate())).div(safeX);
  const depth = distance.mul(airColumn).mul(densityScale).div(settings.aerialDistance);
  return oneMinus(exp(depth.negate())).mul(settings.aerialMax);
}

/**
 * The scene's fog as a node (`scene.fogNode`), replacing the plain FogExp2
 * colour with the sun-facing one. Colour and density are still owned by
 * `scene.fog`: `sync` copies them every frame, so time of day, weather and the
 * underwater swap keep working unchanged. While anything other than the sky's
 * own fog is active (diving), the sun term and the aerial haze are switched off.
 */
export class SunHazeFog {
  constructor({ scene, skyFog, sunDirection, glowColor, settings }) {
    this.scene = scene;
    this.skyFog = skyFog;
    this.settings = settings;
    this.color = uniform(new THREE.Color().copy(skyFog.color));
    this.density = uniform(skyFog.density);
    this.presence = uniform(1);
    /** 1 while the sky's own fog is active, scaled by the weather; 0 underwater. */
    this.aerialScale = uniform(1);
    const toFragment = positionWorld.sub(cameraPosition);
    const distance = length(toFragment);
    const direction = toFragment.div(max(distance, 1e-3));
    const color = sunHazeColor({
      baseColor: this.color,
      glowColor,
      direction,
      sunDirection,
      settings,
      presence: this.presence,
    });
    const aerial = aerialFactorNode({ distance, rise: toFragment.y, settings, densityScale: this.aerialScale });
    this.node = fog(color, max(densityFogFactor(this.density), aerial));
    scene.fogNode = this.node;
  }

  /** Follow `scene.fog` (colour, density, and which fog is active). */
  sync({ sunPresence = 1, densityScale = 1 } = {}) {
    const active = this.scene.fog;
    if (!active) {
      this.density.value = 0;
      this.aerialScale.value = 0;
      return;
    }
    const sky = active === this.skyFog;
    this.color.value.copy(active.color);
    this.density.value = active.density ?? 0;
    this.presence.value = sky ? sunPresence : 0;
    this.aerialScale.value = sky ? densityScale : 0;
  }

  dispose() {
    if (this.scene.fogNode === this.node) this.scene.fogNode = null;
  }
}
