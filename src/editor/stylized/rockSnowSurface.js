import { abs, color, float, mix, select, texture, vec3 } from 'three/tsl';
import { acquireRockTextures } from '../world/FarAlpineSurface.js';
import { acquireSnowTextures } from '../assets/godsEnd/snowTextures.js';
import { repeatMipTextureLoad } from './RepeatMipTextureLoad.js';

/**
 * Surfaces that put a scattered stone in snow country: the crags' cold stone,
 * and the terrain's own Snow007C grain for the snow lying on it, so a cap and
 * a skirt carry the same powder, hollows and blue cavities as the snowfield.
 */
const STONE_METERS = 7;
/** Dark, barely blue: stone in snow reads by contrast, and the old light blue-grey looked like ice. */
const STONE_TINT = '#7c8188';
const STONE_GAIN = 1.35;
/** Snow007C's period, as the terrain draws it (SnowDetailShading): 8 m. */
const SNOW_PER_METRE = 0.125;
/** Snow007C's mean albedo, divided out so the grain only varies the snow colour. */
const SNOW_MEAN = vec3(0.629, 0.737, 0.849);
const SNOW_MEAN_ROUGHNESS = 0.714;

/** Triplanar crag stone at world point `p` (metres) with world normal `n`: blue-grey, ~0..1 albedo. */
export function coldStone(p, n) {
  const maps = acquireRockTextures();
  const blend = n.abs().pow(vec3(4)).toVar();
  const weights = blend.div(blend.x.add(blend.y).add(blend.z)).toVar();
  const scale = float(1 / STONE_METERS);
  return texture(maps.color, p.zy.mul(scale)).rgb.mul(weights.x)
    .add(texture(maps.color, p.xz.mul(scale)).rgb.mul(weights.y))
    .add(texture(maps.color, p.xy.mul(scale)).rgb.mul(weights.z))
    .mul(color(STONE_TINT)).mul(STONE_GAIN);
}

/**
 * Snow grain at point `p` (metres) on a face with normal `n`, projected along
 * the face's dominant axis: `{ tint, roughness }`, where tint multiplies the snow
 * colour (about 1) and roughness is an offset. Sampler-free, like the terrain's.
 * Null without an image decoder.
 */
export function snowGrain(p, n) {
  const maps = acquireSnowTextures();
  if (!maps) return null;
  const q = p.mul(SNOW_PER_METRE);
  const side = select(abs(n.x).greaterThan(abs(n.z)), q.zy, q.xy);
  const point = select(abs(n.y).greaterThan(0.55), q.xz, side).toVar();
  // Derivatives of the continuous projections, so the face-axis switch does not
  // read as a huge footprint and drop a seam to the coarsest mip.
  const dx = select(abs(n.y).greaterThan(0.55), q.xz.dFdx(), select(abs(n.x).greaterThan(abs(n.z)), q.zy.dFdx(), q.xy.dFdx()));
  const dy = select(abs(n.y).greaterThan(0.55), q.xz.dFdy(), select(abs(n.x).greaterThan(abs(n.z)), q.zy.dFdy(), q.xy.dFdy()));
  const pigment = repeatMipTextureLoad(maps.color, point, dx, dy).rgb.div(SNOW_MEAN).clamp(0.8, 1.2);
  const packed = repeatMipTextureLoad(maps.packed, point, dx, dy);
  // AO darkens the hollows and blues them, as skylight fills a snow pit.
  const cavity = mix(float(1), packed.r.div(0.944), 0.7).clamp(0.55, 1);
  const tint = pigment.mul(cavity).mul(mix(vec3(1), vec3(0.62, 0.76, 1), cavity.oneMinus().mul(1.4)));
  const ready = maps.ready;
  return {
    tint: mix(vec3(1), tint, ready),
    roughness: packed.g.sub(SNOW_MEAN_ROUGHNESS).mul(0.3).mul(ready),
  };
}
