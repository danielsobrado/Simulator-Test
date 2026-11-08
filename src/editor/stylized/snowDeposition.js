import { dot, float, max, normalize, normalLocal, normalWorld, positionGeometry, varying, vec2, vec3 } from 'three/tsl';
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
 *   scour   the windward foot is scooped out, the skirt sitting lower there;
 *   skirt   a band above the ground line, deepest in the lee, in the terrain's
 *           snow colour so the object's foot runs into the baked snow.
 *
 * The snow amount moves the edges, not the opacity: a light fall leaves only
 * the flattest tops and a low skirt white, rather than a grey film over the
 * whole stone. Edges are narrow and torn by the breakup noise, as settled snow
 * meets rock in a line, not a gradient.
 *
 * Pure normal and object-space arithmetic: no texture, no light.
 */
/** The terrain bake's snow (terrain-material-bake.yaml render.snowColor), for the skirt. */
export const SNOW_GROUND_COLOR = '#e8eef2';
const WIND = vec2(...PREVAILING_WIND).normalize();
/** Up-facing value where a full fall starts to cap a face, and how much higher a trace of snow starts. */
const CAP_START = 0.58;
const CAP_LIGHT = 0.4;
const CAP_WIDTH = 0.1;
/** Skirt height as a share of the object's height above the ground line, under a full fall. */
const SKIRT = 0.13;
/** How much higher the skirt climbs a lee face, and how much lower it sits on the windward one. */
const SKIRT_LEE = 0.08;
const SKIRT_SCOUR = 0.04;
/** Drift up a lee face, as a share of the object's height. */
const LEE_DRIFT = 0.22;
/** Softness of the skirt's top edge, in the same share. */
const SKIRT_EDGE = 0.025;

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
  const facing = dot(normalWorld.xz, WIND);
  const lee = facing.clamp(0, 1);
  const depth = snow.clamp(0, 1);
  // Only a trace switches it off; any real fall is drawn at full white where it lies.
  const present = depth.smoothstep(0.02, 0.12);
  const cavity = centre
    // A convex stone's faces sit well out along their radius; only faces turned in from it are recesses.
    // Per vertex: it varies smoothly over a stone, and the fragment pass is the expensive one.
    ? varying(float(0.35).sub(dot(normalLocal, normalize(positionGeometry.sub(vec3(...centre))))).mul(1.5).clamp(0, 1))
    : float(0);
  const start = float(CAP_START).add(depth.oneMinus().mul(CAP_LIGHT)).sub(cavity.mul(0.25)).sub(lee.mul(0.1));
  const cap = up.add(breakup.mul(0.45)).smoothstep(start, start.add(CAP_WIDTH));
  if (groundY === null) return { cover: cap.mul(present), skirt: float(0) };

  const level = varying(positionGeometry.y.sub(groundY).div(Math.max(1e-3, height)));
  // Deeper snow buries more of the foot; the root keeps a light fall from sitting as high as a heavy one.
  const fill = depth.sqrt();
  // Banked against the lee face, tallest straight downwind and tapering round the
  // sides like a drift tail; not under an overhang. Crisp-topped, like the skirt.
  // WGSL leaves smoothstep undefined for reversed edges, so falling ramps are oneMinus.
  // Gentle in lee: these stones are faceted, and a steep lee term stepped the snow
  // line at every facet edge, drawing it as straight vertical cuts.
  const driftTop = facing.smoothstep(-0.3, 1).mul(fill).mul(LEE_DRIFT).mul(breakup.mul(0.6).add(1)).max(0.01);
  const drift = level.smoothstep(driftTop.sub(SKIRT_EDGE), driftTop).oneMinus().mul(up.smoothstep(-0.45, 0.1));
  const scour = facing.negate().clamp(0, 1);
  const skirtTop = float(SKIRT).add(lee.mul(SKIRT_LEE)).sub(scour.mul(SKIRT_SCOUR))
    .add(breakup.mul(0.22)).mul(fill).max(0.02);
  const skirt = level.smoothstep(skirtTop.sub(SKIRT_EDGE), skirtTop).oneMinus();
  return { cover: max(max(cap, drift), skirt).mul(present), skirt: skirt.mul(present) };
}
