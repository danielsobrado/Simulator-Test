import { evaluateAquaticPlacement } from '../water/AquaticPlacement.js';
import { evaluateStrandPlacement } from './strandPlacement.js';
import { evaluateShoreHabitat } from './shoreHabitat.js';
import { staticWaterContactAt } from '../water/StaticWaterSample.js';
import { lakeWavePhases } from '../water/LakeSurfaceWaves.js';
import { resolveWaterQualityFeatures } from '../water/WaterQuality.js';
import { CANDIDATE_PENDING } from './StableScatterManifest.js';

/** Surface ecology and anchoring, separate from instance rendering. */
export function evaluateDetailSurfacePlacement(view, candidate, heightAt, shouldYield = null) {
  let metadata = null;
  if (view.layerName === 'aquaticPlant') {
    // Most candidates are on dry land. Establish identity before paying for
    // bed interpolation and shore distance; wet plants still use the complete
    // canonical sample below, including flow, edits and animated surface rise.
    if (typeof view.terrainView.worldStore?.generator?.sampleWaterSurface === 'function'
        && !staticWaterContactAt(view.terrainView, candidate.x, candidate.z)?.kind) return null;
    // A shoreline distance block costs tens of milliseconds; build it across frames.
    const tileSize = view.terrainView.worldStore?.tileSize;
    if (view.terrainView.worldStore?.generator?.prepareWaterSample?.(
      candidate.x / tileSize, -candidate.z / tileSize, shouldYield) === false) return CANDIDATE_PENDING;
    const waterSample = view.terrainView.getCanonicalWater?.(candidate.x, candidate.z);
    metadata = evaluateAquaticPlacement({
      waterSample,
      layerRule: view.layerConfig.water,
      prototypeRule: view.prototypeWaterRules[candidate.prototypeIndex],
    });
    if (!metadata) return null;
    if (metadata.waterPlacement === 'surface') {
      const fraction = Math.min(1, metadata.waterDepth / (view.config.water?.optics?.shorelineFadeDepth ?? 0.35));
      const fade = fraction * fraction * (3 - 2 * fraction);
      const waves = view.config.water?.riverSurface?.enabled && resolveWaterQualityFeatures(view.config.water).flow;
      metadata = { ...metadata,
        waterPlacementHeight: metadata.waterPlacementHeight + (fade - 1) * (view.config.water?.heightOffset ?? 0.12),
        surfaceData: [...lakeWavePhases(candidate.x, candidate.z),
          waves ? fade * (1 - Math.min(1, Math.hypot(metadata.waterFlowX ?? 0, metadata.waterFlowZ ?? 0) * 4)) : 0] };
    }
  } else if (view.prototypeStrandRules[candidate.prototypeIndex]) {
    // The band either side of the waterline, which has no water sample to
    // read because the field reports no kind on dry ground.
    const strand = evaluateStrandPlacement({
      height: candidate.height,
      seaLevel: view.terrainView.worldStore?.generator?.seaLevel,
      layerRule: view.layerConfig.strand,
      prototypeRule: view.prototypeStrandRules[candidate.prototypeIndex],
    });
    if (!strand) return null;
    const shoreRule = view.prototypeShoreRules[candidate.prototypeIndex];
    if (shoreRule) {
      const habitat = evaluateShoreHabitat(candidate, shoreRule, {
        distanceAt: (x, z) => view.oceanDistance.worldDistanceAt(x, z),
        heightAt: heightAt,
        waterAt: (x, z) => staticWaterContactAt(view.terrainView, x, z),
        seaLevel: view.terrainView.worldStore.generator.seaLevel,
      });
      if (!habitat) return null;
      metadata = { ...strand, ...habitat };
    }
    metadata ??= strand;
  }
  return metadata ?? true;
}
