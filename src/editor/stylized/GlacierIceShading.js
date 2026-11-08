import { Color } from 'three/webgpu';
import { float, fwidth, length, max, mix, oneMinus, smoothstep, vec2, vec3 } from 'three/tsl';
import { heightRelief } from '../materials/heightRelief.js';
import { noise2, noised, snowWarp } from './SnowNoiseNodes.js';
import { snowSurfacePoint } from './SnowSurfaceState.js';

const color = (hex) => { const c = new Color(hex); return vec3(c.r, c.g, c.b); };
/** Weathered surface ice: grey-white, never the clean white of snow. */
const ICE_DULL = color('#97a8b1');
const ICE_BRIGHT = color('#c8d6dc');
/** Light through the ice where the surface dips: melt hollows and the floor of every trough. */
const ICE_BLUE = color('#55a9cf');
/** Melt holes and the deepest troughs, where the light has come through metres of ice. */
const ICE_DEEP = color('#1f78ad');
/** Grit, ash and cryoconite drawn out along the flow. */
const GRIT = color('#5d5b55');
/** Height of the melt hummocks, metres: enough to model every ridge in a low sun. */
const HUMMOCK_HEIGHT = 0.6;

/**
 * Glacier ice instead of snowfield where a biome's `glacier` share says so
 * (after the scanned Icelandic glacier reference): grey-white weathered ice
 * worked into hummocks, light coming through blue in every hollow and in the
 * odd deep melt hole, dark grit drawn out in streaks along the flow, and the
 * powder snow left lying only in patches. Coordinates are the snow's bounded
 * ones (SnowSurfaceState), so the pattern holds at planet scale.
 *
 * @param {object} options.tileShare float node: the biome's `glacier` share, filtered between cells
 * @returns {{ share: object, apply(color: object): object, roughness(r: object): object, normal(n: object): object }}
 */
export function createGlacierIceShading({ terrainUv, chunkWorldSize, chunkCenter, tileShare }) {
  const local = vec2(terrainUv.x.sub(0.5), float(0.5).sub(terrainUv.y)).mul(chunkWorldSize);
  const p = snowSurfacePoint(local, chunkCenter);
  const q = snowWarp(p);
  // World size of a pixel. A feature fades once it spans fewer than ~30 pixels:
  // resolved but busy, the chop, holes and mottling read as speckle from the
  // air, where a glacier settles into broad grey ice and long streaks.
  const footprint = length(fwidth(local));
  const near = (wavelength) => oneMinus(smoothstep(wavelength * 0.02, wavelength * 0.06, footprint));
  // Powder survives in patches tens of metres across; the rest is bare ice.
  const powder = smoothstep(0.3, 0.45, noise2(p.div(26).add(vec2(17.3, -4.9))));
  // Not gated by the baked snow weight: it is read per texel, and where rock takes
  // a texel's weight it drops to zero, which switched the ice off in 2 m squares.
  const share = tileShare.mul(oneMinus(powder)).toVar('glacierIce');

  // Hummocks: rounded melt ridges a few metres across over a finer chop.
  const swell = noised(q.div(11)).x;
  const broad = noised(q.div(3.4)).x;
  const fine = noised(q.div(1.15).add(vec2(5.3, 11.7))).x;
  const hummock = swell.mul(0.6).add(broad.mul(0.5).mul(near(3.4))).add(fine.mul(0.25).mul(near(1.15))).toVar();
  const trough = smoothstep(0.1, -0.4, hummock);
  // Melt holes: rare, small and sharp-edged. Warped: thresholded this high, the
  // plain lattice left one blob per noise cell, in rows of blue squares.
  const hole = smoothstep(0.42, 0.5, noise2(q.div(4.2).add(vec2(-21.7, 3.1)))).mul(near(4.2));
  // Grit streaks: noise stretched along a flow that veers slowly over the ice.
  const veer = noise2(p.div(140)).mul(1.4);
  const along = vec2(veer.cos(), veer.sin());
  const across = vec2(along.y.negate(), along.x);
  // Bands metres wide with soft edges, broken along their length: at 1.3 m across
  // under a hard threshold they drew as crisp ruled lines, like tyre tracks.
  const streakField = noise2(vec2(q.dot(along).div(28), q.dot(across).div(4.5)));
  const broken = smoothstep(-0.2, 0.35, noise2(p.div(37).add(vec2(-8.3, 12.9))));
  const grit = smoothstep(0.12, 0.5, streakField).mul(broken).mul(0.42).mul(near(4.5).mul(0.6).add(0.4))
    .add(smoothstep(0.3, 0.55, noise2(q.div(9))).mul(0.15));

  const shade = noise2(q.div(6.5)).mul(near(6.5)).mul(0.5).add(0.5);
  let ice = mix(ICE_DULL, ICE_BRIGHT, shade.mul(0.6).add(hummock.mul(0.5)).clamp(0, 1));
  ice = mix(ice, ICE_BLUE, trough.mul(0.95));
  ice = mix(ice, GRIT, grit.mul(oneMinus(trough.mul(0.6))));
  ice = mix(ice, ICE_DEEP, max(hole, smoothstep(-0.45, -0.62, hummock)).mul(0.9));

  return {
    share,
    apply(base) { return mix(base, ice, share); },
    /** Wet, glazed ice: glossier than snow, glossiest where melt water lies in the hollows. */
    roughness(base) { return mix(base, mix(float(0.38), float(0.14), max(trough, hole)), share); },
    normal(base) { return mix(base, heightRelief(base, hummock.mul(HUMMOCK_HEIGHT)), share).normalize(); },
  };
}
