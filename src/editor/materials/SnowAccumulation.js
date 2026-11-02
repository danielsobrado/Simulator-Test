/**
 * Where snow lies (after grass-test's snow slope patches), 0..1 per point.
 *
 *   altitude   snow from `snowLine`, full `snowFade` metres above it;
 *   biome      glacier and tundra carry snow at any height (`snowBiomeCover`,
 *              by terrain tile id, which is the Azgaar biome id), blurred over
 *              ±`SNOW_BIOME_BLUR_CELLS` so the snow fades across a biome border
 *              instead of starting at a cell edge;
 *   slope      steep faces shed it (`snowSlopeMax`);
 *   wind       faces turned into the prevailing wind are scoured and lee faces
 *              loaded (`snowWindShift`);
 *   hollows    concave ground holds more (`snowConcavity`);
 *   patches    low-frequency noise breaks the edge into drifts
 *              (`snowPatchScale`, `snowPatchStrength`).
 *
 * The altitude band is in world metres, tuned for Eldara's relief (land median
 * ~75 m, tundra ~400–650 m, glacier ~650–1,550 m): the old 26 m line turned
 * most of the continent white.
 */

import { terrainBakeValueNoise } from './TerrainBakeNoise.js';
import { BIOME_BLUR_CELLS, blurTileField, blurTileValueAt } from '../world/BiomeFieldBlur.js';

const PREVAILING_WIND = Object.freeze([0.8, 0.6]);
/** Offset of the snow drift noise from the bake's macro seed. */
const SNOW_PATCH_SEED = 53;
const SLOPE_BREAKUP = 0.8;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Cells either side of a biome border over which its snow cover ramps. */
export const SNOW_BIOME_BLUR_CELLS = BIOME_BLUR_CELLS;

/**
 * Blurred biome snow cover over a halo of tile ids (BiomeFieldBlur.js), or null
 * when no biome carries snow.
 */
export function snowBiomeCoverField(halo, size, coverByTile) {
  if (!coverByTile || Object.keys(coverByTile).length === 0) return null;
  return blurTileField(halo, size, (tileId) => coverByTile[tileId] ?? 0);
}

/** The same blurred cover at one cell, for point queries (a footstep, a town). */
export function snowBiomeCoverAt(tileAt, cellX, cellZ, coverByTile) {
  if (!coverByTile) return 0;
  return blurTileValueAt(tileAt, cellX, cellZ, (tileId) => coverByTile[tileId] ?? 0);
}

/**
 * @param {object} sample
 * @param {number} sample.height world metres
 * @param {number} sample.slope rise over run
 * @param {number} sample.dx height gradient along x
 * @param {number} sample.dz height gradient along z
 * @param {number} sample.curvature Laplacian per square metre (positive in hollows)
 * @param {number} sample.tileId terrain tile id (Azgaar biome id)
 * @param {number} [sample.biomeCover] blurred biome cover, read instead of the
 *   tile id's own step when given (snowBiomeCoverField / snowBiomeCoverAt)
 * @param {number} sample.patch 0..1 low-frequency noise at the point
 * @param {object} classification `terrainMaterialBake.classification`
 */
export function snowAccumulation({ height, slope, dx, dz, curvature, tileId, biomeCover, patch }, classification) {
  const altitude = smoothstep(classification.snowLine, classification.snowLine + classification.snowFade, height);
  const biome = biomeCover ?? classification.snowBiomeCover?.[tileId] ?? 0;
  const base = Math.max(altitude, biome);
  if (base <= 0) return 0;

  const slopeLength = Math.hypot(dx, dz);
  // A face turned into the wind has its downhill side, (-dx, -dz), pointing
  // against the direction the wind blows toward: positive here, negative in the lee.
  const facingWind = slopeLength > 1e-6
    ? (dx * PREVAILING_WIND[0] + dz * PREVAILING_WIND[1]) / slopeLength
    : 0;
  const exposure = facingWind * Math.min(1, slope * 2);
  const wind = exposure * classification.snowWindShift;
  const hollow = Math.max(-0.25, Math.min(0.25, curvature * classification.snowConcavity));
  const patches = (patch - 0.5) * classification.snowPatchStrength;
  // The same drifts decide how steep snow clings, so it runs in tongues down the rock.
  const hold = 1 - smoothstep(classification.snowSlopeMax * 0.7, classification.snowSlopeMax, slope - patches * SLOPE_BREAKUP);
  return clamp01(base - wind + hollow + patches * (1 - Math.abs(base * 2 - 1) * 0.5)) * hold;
}

/**
 * Snow at a canonical point, drifts included: the one evaluation the terrain
 * bake draws and the grass gate follows, so blades stop at the drawn edge.
 *
 * @param {object} sample as snowAccumulation, with `worldX`, `worldZ` instead of `patch`
 * @param {object} classification
 * @param {number} macroSeed terrainBakeMacroSeed(macro.seedOffset, worldSeed)
 */
export function snowAtPoint(sample, classification, macroSeed) {
  const patch = terrainBakeValueNoise(
    sample.worldX,
    sample.worldZ,
    classification.snowPatchScale,
    macroSeed + SNOW_PATCH_SEED,
  );
  return snowAccumulation({ ...sample, patch }, classification);
}
