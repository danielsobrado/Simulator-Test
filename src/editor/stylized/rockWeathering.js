import { frameUniform } from '../../render/FrameUniforms.js';
import {
  attribute,
  color,
  dot,
  float,
  mx_noise_float,
  mix,
  normalLocal,
  normalWorld,
  positionGeometry,
  positionWorld,
  sin,
  varying,
  vec3,
} from 'three/tsl';
import { stylizedFbm2 } from './StylizedNoiseNodes.js';
import { LOOK_SNOW_STEPS } from '../biomes/BiomeLooks.js';
import { authoredTexture } from './AuthoredTextureNode.js';
import { coldStone, snowGrain } from './rockSnowSurface.js';
import { SNOW_GROUND_COLOR, snowDeposition } from './snowDeposition.js';
import { stormSnowCoverUniform } from '../weather/storm/stormGroundUniforms.js';

/**
 * Weathering for the authored rock pack — after grass-test's `rockWeathering`.
 *
 * Broken moss, dust and local wetness integrate authored stones with the ground.
 * Toning is configurable because source packs have different painted values;
 * contact darkening stays modest alongside Lambert lighting and scene AO.
 *
 * The streamed rock view resolves each stone's nearest water body once during
 * placement. Its packed instance attribute supplies level and eligibility, so
 * rivers and raised lakes carry their own splash lines without a GPU water field.
 *
 * The donor also dithered rocks away in front of the character. This project's
 * `CharacterOcclusion` deliberately cuts foliage only — rocks are solid obstacles
 * and cutting them reads as a hole in the world — so the mask is left alone.
 */

/**
 * The donor's tone and moss frequencies are per unit of its world, 2.8 to the
 * metre. Read per metre they gave a 2.5 m stone one flat tone and either no moss
 * or a solid cap; converted, a stone carries the donor's broken patches again.
 */
const DONOR_UNITS_PER_METRE = 2.8;
/** Per-placement shift of the pattern, per unit of the instance seed (0..1). */
const SEED_SPREAD = Object.freeze([131.7, 71.3, 97.9]);

/**
 * Where a fragment sits in the weathering pattern: the stone's own (object-space)
 * position, shifted by its placement's stable seed. Render-space position moved
 * with every floating-origin rebase, so each stone's tone and moss jumped when the
 * player walked far enough; object space does not move, and the seed keeps
 * stones sharing one template from reading as copies. The rock view draws only
 * instanced meshes, which always carry `instanceDither` (y is the seed).
 */
function patternPosition() {
  const seed = attribute('instanceDither', 'vec3').y;
  return positionGeometry.add(vec3(...SEED_SPREAD).mul(seed));
}

const MOSS_LIGHT = '#7d9a3a';
const MOSS_DARK = '#4d6424';
const DUST = '#a89a80';
const ALGAE = '#4a5a2a';
const ROCK_SNOW = '#eef2f6';
/** Snow-edge noise frequency: a few tears across a metre-scale boulder. */
const SNOW_TEAR_PER_METRE = 1.4;
/** How far snow country turns a boulder to the crags' stone, and how much of its own shading it keeps. */
const FROST_STONE = 0.85;
const FROST_SHADING = 2.2;
/** Snow on a face tipping away from the sky: a cooler, deeper white. */
const ROCK_SNOW_SHADE = '#c3cfdc';
/** Soil-line noise frequency: a few lobes round a metre-scale boulder. */
const SOIL_EDGE_PER_METRE = 1.1;

export const DEFAULT_ROCK_WEATHERING = Object.freeze({
  enabled: true,
  // Multiplies source albedo; the current mid-value pack overrides this to .92.
  toning: 0.72,
  moss: 0.85,
  dust: 0.35,
  undersideShade: 0.2,
  waterline: 0.7,
  // Metres above the water the splash line reaches, ragged by the noise.
  waterlineHeight: 1.2,
  wetDarkening: 0.5,
  /** Green in the upper half of the splash band, where a tide mark grows. */
  algae: 0.45,
  algaeColor: ALGAE,
  /** Ground duff carried up the stone's foot; 0 leaves the foot bare. */
  soil: 0.7,
  /** How far up it reaches, as a share of the stone's height above the ground line. */
  soilHeight: 0.16,
  // The linear value of terrainMaterial's contact-shade earth, so foot and floor agree.
  soilColor: '#7b653d',
});

/**
 * @param {object} [configured] `stylizedSurface.rocks.weathering`
 */
export function resolveRockWeathering(configured) {
  if (configured?.enabled === false) return null;
  const settings = { ...DEFAULT_ROCK_WEATHERING, ...(configured ?? {}) };
  for (const key of ['toning', 'moss', 'dust', 'waterline', 'algae', 'undersideShade', 'soil']) {
    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Invalid editor configuration: rocks.weathering.${key} must be within [0, 1].`);
    }
  }
  for (const key of ['waterlineHeight', 'soilHeight']) {
    if (!(Number(settings[key]) > 0)) {
      throw new Error(`Invalid editor configuration: rocks.weathering.${key} must be positive.`);
    }
  }
  return settings;
}

/**
 * Rewrites a cloned rock material's albedo and roughness in place.
 *
 * @param {object} material a cloned MeshStandardNodeMaterial
 * @param {object} options
 * @param {object} options.settings resolved weathering settings
 * @param {number|null} [options.seaLevel] world sea level, for the splash line
 * @param {boolean} [options.biomeLook] read the per-instance `instanceBiomeLook`
 *   (rgb albedo multiplier, moss scale) the rock view writes from each stone's biome
 * @param {{ groundY: number, height: number, centre: number[] }} [options.ground]
 *   the stone's object-space ground line, height above it and centre, for the
 *   snow skirt, lee drift and cavities (snowDeposition)
 */
export function applyRockWeathering(material, { settings, seaLevel = null, localWater = false, biomeLook = false, ground = null }) {
  if (!settings?.enabled) return material;
  const sourceMap = material.map ?? null;
  const world = positionWorld;
  const pattern = patternPosition();
  const look = biomeLook ? attribute('instanceBiomeLook', 'vec4') : null;
  // w = moss + 4 * snow steps (BiomeLooks LOOK_SNOW_STEPS).
  const snowSteps = look ? look.w.div(4).floor() : null;
  const moss = look ? look.w.sub(snowSteps.mul(4)) : null;
  const snowGround = look ? snowSteps.div(LOOK_SNOW_STEPS) : null;
  const donor = pattern.mul(DONOR_UNITS_PER_METRE);
  const donorXZ = donor.xz;

  // Broad tonal breakup from sine products over the stone, so stones sharing one
  // template stop reading as copies of each other.
  const tone = sin(donor.x.mul(0.83).add(sin(donor.y.mul(1.31)).mul(1.6)))
    .mul(sin(donor.z.mul(0.97).add(sin(donor.x.mul(0.61)).mul(1.2))))
    .mul(sin(donor.y.mul(0.71).add(donor.z.mul(0.37))))
    .mul(0.5).add(0.5);
  const albedo = (sourceMap ? authoredTexture(sourceMap).rgb : vec3(1))
    .mul(color(material.color.getHex()))
    .mul(settings.toning)
    .mul(mix(0.74, 1.06, tone));
  const biomeAlbedo = look ? albedo.mul(look.rgb) : albedo;

  // Moss in broken patches on whatever faces up.
  const patches = sin(donorXZ.x.mul(0.9).add(sin(donorXZ.y.mul(0.7)).mul(1.8)))
    .mul(sin(donorXZ.y.mul(1.1).add(sin(donorXZ.x.mul(0.5)).mul(1.4))))
    .mul(0.5).add(0.5);
  const up = normalWorld.y;
  const mossMask = up.smoothstep(0.35, 0.85)
    .mul(patches.smoothstep(0.25, 0.7))
    .mul(settings.moss)
    .mul(look ? moss : float(1))
    .clamp(0, 1);
  const shade = dot(biomeAlbedo, vec3(0.3, 0.59, 0.11)).mul(0.9).add(0.55);
  const mossColor = mix(color(MOSS_DARK), color(MOSS_LIGHT), patches).mul(shade);
  // Keep a modest contact cue; Lambert lighting and scene AO supply the shade.
  const underside = mix(float(1 - settings.undersideShade), float(1), up.smoothstep(-0.7, 0.15));
  let weathered = mix(biomeAlbedo, mossColor, mossMask).mul(underside);
  let roughness = material.roughnessMap
    ? authoredTexture(material.roughnessMap).g.mul(material.roughness ?? 1).max(mossMask.mul(0.95))
    : float(material.roughness ?? 0.85).max(mossMask.mul(0.95));

  // Dust settles on the bare tops the moss has not claimed.
  const dust = up.smoothstep(0.55, 0.95)
    .mul(mossMask.oneMinus())
    .mul(patches.oneMinus())
    .mul(settings.dust);
  weathered = mix(weathered, color(DUST).mul(shade), dust);

  // The floor's duff carried up the foot. The terrain paints the same duff under a
  // stone (terrainMaterial's contact shade), so the two meet in one colour and
  // the stone grows out of the ground. No scene depth: a `viewportDepthTexture`
  // blend would cost a whole-frame copy (CLAUDE.md), and the ground line is known.
  if (ground && settings.soil > 0) {
    const level = varying(positionGeometry.y.sub(ground.groundY).div(Math.max(1e-3, ground.height)));
    const top = stylizedFbm2(pattern.xz.mul(SOIL_EDGE_PER_METRE)).mul(0.7).add(0.3).max(0.15).mul(settings.soilHeight);
    const soil = level.smoothstep(top.mul(0.35), top).oneMinus().mul(settings.soil);
    // The terrain's own duff recipe: half the surface dulled and darkened, half earth.
    const dull = mix(vec3(dot(weathered, vec3(0.3, 0.59, 0.11))), weathered, 0.5).mul(vec3(1, 0.94, 0.76));
    // shortcut: earth leans to the biome through the rock tint, not the tile's soil colour;
    // upgrade to a per-instance soil colour if a biome's foot reads off against its ground.
    const earth = color(settings.soilColor).mul(look ? look.rgb : vec3(1));
    weathered = mix(weathered, mix(dull.mul(0.45), earth, 0.5), soil);
    roughness = roughness.max(soil.mul(0.95));
  }

  // Wet, dark and glossy up to a ragged local splash line, with the green
  // that grows just above it. The donor darkens the band; the tint is the half of
  // a waterline that makes it read as a tide mark rather than as shadow.
  if ((localWater || Number.isFinite(seaLevel)) && settings.waterline > 0) {
    const contact = localWater ? attribute('instanceSurface', 'vec3') : null;
    const level = contact ? contact.x : frameUniform(seaLevel);
    const eligible = contact ? contact.y : float(1);
    const splash = stylizedFbm2(pattern.xz.mul(0.7)).mul(0.5).add(0.5)
      .mul(settings.waterlineHeight).mul(contact ? contact.z.mul(0.5).add(1) : float(1));
    const above = world.y.sub(level);
    const wet = above.smoothstep(splash.mul(0.6), splash.add(0.15)).oneMinus()
      .mul(eligible)
      .mul(settings.waterline);
    weathered = weathered.mul(wet.mul(settings.wetDarkening).oneMinus());
    roughness = mix(roughness, float(0.25), wet);
    // Algae sits in the upper, drier half of the band — it needs the water but
    // does not live under it — so it fades in above the wet line rather than with
    // it, and is broken up by the same noise the splash line is.
    if (settings.algae > 0) {
      const band = above.smoothstep(splash.mul(0.35), splash.mul(1.1));
      const growth = band.mul(above.smoothstep(-0.2, 0.7)).oneMinus()
        .mul(splash)
        .mul(settings.algae);
      weathered = mix(weathered, color(settings.algaeColor ?? ALGAE), growth.mul(eligible).clamp(0, 1));
    }
  }

  // Snow country: capped on top, drifted into the lee and the recesses, and
  // buried at the foot in the terrain's own snow (snowDeposition).
  if (look) {
    // Snow country wears the crags' cold stone (rockSnowSurface), lit by the authored
    // stone's own light and dark so its facets and cracks still read; a tint alone
    // left warm painted boulders beside blue-grey crags. Object space, so it holds still.
    const frost = snowGround.smoothstep(0.3, 0.9).mul(FROST_STONE);
    const shading = dot(weathered, vec3(0.3, 0.59, 0.11)).mul(FROST_SHADING).clamp(0.5, 1.2);
    weathered = mix(weathered, coldStone(pattern, normalLocal).mul(shading), frost);
    // The sine patches are too smooth to tear an edge: alone, whole facets went white
    // at once and the skirt ran in straight lines across a face.
    const tear = mx_noise_float(pattern.mul(SNOW_TEAR_PER_METRE)).mul(0.6).add(patches.sub(0.5).mul(0.3));
    const { cover, skirt } = snowDeposition({
      // A storm's snow settles on any stone; the cold stone stays the biome's.
      snow: snowGround.max(stormSnowCoverUniform), breakup: tear, ...(ground ?? {}),
    });
    const grain = snowGrain(pattern, normalLocal);
    const snowColor = mix(mix(color(ROCK_SNOW_SHADE), color(ROCK_SNOW), up.smoothstep(0.6, 0.95)), color(SNOW_GROUND_COLOR), skirt)
      .mul(grain?.tint ?? vec3(1));
    weathered = mix(weathered, snowColor, cover);
    roughness = mix(roughness, float(0.6).add(grain?.roughness ?? 0), cover);
  }

  material.colorNode = weathered;
  material.roughnessNode = roughness;
  material.needsUpdate = true;
  return material;
}
