import { dot, float, max, normalize, normalLocal, normalWorld, positionGeometry, vec2, vec3 } from 'three/tsl';
import { PREVAILING_WIND } from '../materials/SnowAccumulation.js';

/**
 * Where snow lies on a scattered object (a boulder, a crag, a shrub), 0..1, so
 * it reads as buried in the snowfield rather than set down on it:
 *
 *   cap     faces turned up take it; a heavier fall reaches shallower faces;
 *   faces   vertical faces shed it unless sheltered;
 *   cavity  recesses (a face turned in from the object's centre) hold more;
 *   lee     faces turned downwind of the bake's PREVAILING_WIND carry a drift
 *           banked up their lower half, as the terrain's own lee slopes do;
 *   skirt   a band above the ground line, deepest in the lee, in the terrain's
 *           snow colour so the object's foot runs into the baked snow.
 *
 * Pure normal and object-space arithmetic: no texture, no light.
 */
/** The terrain bake's snow (terrain-material-bake.yaml render.snowColor), for the skirt. */
export const SNOW_GROUND_COLOR = '#e8eef2';
const WIND = vec2(...PREVAILING_WIND).normalize();
/** Up-facing band over which a face goes bare to capped, before snow, cavity and lee lower it. */
const CAP_START = 0.62;
const CAP_WIDTH = 0.26;
/** Skirt height as a share of the object's height above the ground line. */
const SKIRT = 0.16;
/** How much higher the skirt climbs a lee face. */
const SKIRT_LEE = 0.22;
/** Drift up a lee face, as a share of the object's height. */
const LEE_DRIFT = 0.55;

/**
 * @param {object} options
 * @param {object} options.snow per-instance snow amount node, 0..1
 * @param {object} [options.breakup] noise node in about -0.5..0.5 that tears the edges
 * @param {number[]} [options.centre] object-space centre, for cavities; omitted skips them
 * @param {number} [options.groundY] object-space y of the ground line; omitted skips the skirt and drift
 * @param {number} [options.height] object-space height above the ground line
 * @returns {{ cover: object, skirt: object }} cover includes the skirt; skirt alone picks the terrain snow colour
 */
export function snowDeposition({ snow, breakup = float(0), centre = null, groundY = null, height = 1 }) {
  const up = normalWorld.y;
  const lee = dot(normalWorld.xz, WIND).clamp(0, 1);
  const amount = snow.mul(1.3).clamp(0, 1);
  const cavity = centre
    ? float(1).sub(dot(normalLocal, normalize(positionGeometry.sub(vec3(...centre))))).mul(0.5).clamp(0, 1)
    : float(0);
  const start = float(CAP_START).sub(snow.mul(0.28)).sub(cavity.mul(0.3)).sub(lee.mul(0.18));
  const cover = up.add(breakup.mul(0.3)).smoothstep(start, start.add(CAP_WIDTH));
  if (groundY === null) return { cover: cover.mul(amount), skirt: float(0) };

  const level = positionGeometry.y.sub(groundY).div(Math.max(1e-3, height));
  // Banked against the lee face: deep at the foot, thinning up it; not under an overhang.
  // WGSL leaves smoothstep undefined for reversed edges, so falling ramps are oneMinus.
  const drift = level.smoothstep(0, lee.mul(LEE_DRIFT).max(0.02)).oneMinus()
    .mul(lee.smoothstep(0.15, 0.6)).mul(up.smoothstep(-0.45, 0.1));
  const skirtTop = float(SKIRT).add(lee.mul(SKIRT_LEE)).add(breakup.mul(0.12)).max(0.04);
  const skirt = level.smoothstep(skirtTop.mul(0.35), skirtTop).oneMinus();
  return { cover: max(max(cover, drift), skirt).mul(amount), skirt: skirt.mul(amount) };
}
