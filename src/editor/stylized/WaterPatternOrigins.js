import { PatternOrigins } from './PatternOrigins.js';
import { LAKE_WAVE_FRAMES } from '../water/LakeSurfaceWaves.js';
import { RIVER_DETAIL_PATTERN_PERIOD_METERS } from './RiverSurfaceShading.js';
import { resolveSeaSurf, seaSurfPatternFrames } from '../water/SeaSurf.js';
import { resolveSeaDetail, seaDetailPatternFrames } from '../water/SeaDetailPolicy.js';
import { COAST_SWASH_PATTERN_FRAMES } from './CoastSwashShading.js';
import { FROZEN_WATER_PATTERN_FRAMES } from './FrozenWaterNodes.js';

/**
 * Metres between the reference points that the river foam bands are measured
 * from, and the share of that spacing over which neighbouring references
 * cross-fade. Far enough apart that a transition is rare on any one reach,
 * near enough that a band's spacing is still set by the current rather than
 * by distance × the current's gradient.
 */
export const WATER_FLOW_REFERENCE_METERS = 128;
export const WATER_FLOW_REFERENCE_BLEND = 0.08;

/**
 * The per-chunk pattern origins a water material reads instead of canonical
 * world coordinates (see PatternOrigins).
 *
 * @param {object} water `stylizedSurface.water`
 */
export function createWaterPatternOrigins(water) {
  return new PatternOrigins({
    ...LAKE_WAVE_FRAMES,
    ...COAST_SWASH_PATTERN_FRAMES,
    ...FROZEN_WATER_PATTERN_FRAMES,
    ...seaSurfPatternFrames(resolveSeaSurf(water.sea?.surf)),
    ...seaDetailPatternFrames(resolveSeaDetail(water.sea?.detail)),
    surfaceNoise: { scale: water.noiseScale },
    cells: { scale: water.scale },
    refractionCoarse: { scale: water.refraction?.coarseScale ?? 1 },
    refractionFine: { scale: water.refraction?.fineScale ?? 1 },
    caustics: { scale: water.caustics?.scale ?? 1 },
    flowReference: { scale: 1, period: WATER_FLOW_REFERENCE_METERS },
    // Metres, wrapped by a whole number of every river detail tile.
    riverDetail: { scale: 1, period: RIVER_DETAIL_PATTERN_PERIOD_METERS },
    riverMacro: { scale: 1 / 32 },
  });
}
