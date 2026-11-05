import { Fn, If, float, mix, smoothstep, vec4 } from 'three/tsl';
import { PatternOrigins } from '../stylized/PatternOrigins.js';
import { periodicFbm2 } from '../stylized/PeriodicNoiseNodes.js';
import { terrainFeaturePatternFrames } from './TerrainMaterialFeatureNodes.js';

/** Gods' End surfaceDetailNodes.heightBlend; exact endpoint-preserving blend. */
export function heightBlend(mask, baseHeight, layerHeight, { contrast, width, strength, noise = null }) {
  const transition = mask.mul(mask.oneMinus()).mul(4);
  const relief = noise ? layerHeight.add(noise.mul(0.35)) : layerHeight;
  const shifted = mask.add(relief.sub(baseHeight).mul(contrast).mul(transition));
  const halfWidth = float(width);
  const sharp = smoothstep(float(0.5).sub(halfWidth), float(0.5).add(halfWidth), shifted)
    .mul(smoothstep(0, 0.08, mask)).max(smoothstep(0.92, 1, mask));
  return mix(mask, sharp, strength).clamp(0, 1);
}

/**
 * The slot's terrain pattern origins: the transition relief lattices, plus the
 * surface features' (`materialBake.families.features`) when configured.
 */
export function createTerrainTransitionPatterns(features = null) {
  return new PatternOrigins({
    broad: { scale: 0.35 },
    fine: { scale: 1.3 },
    ...(features?.enabled ? terrainFeaturePatternFrames(features) : {}),
  });
}

/**
 * Relief breaks rock/soil/snow and wet-bank edges using the existing bake masks.
 * No new textures, terrain IDs, CPU page work or scene objects. PatternOrigins
 * keeps the shared field continuous across chunks and floating-origin snaps.
 */
export function createTerrainTransitionState({ weights, shoreline, path, cameraDistance, patterns, localXZ, settings }) {
  if (!settings?.enabled || !patterns || settings.strength === 0) return { weights, shoreline };
  const reach = smoothstep(settings.fadeStartDistance, settings.fadeEndDistance, cameraDistance).oneMinus();
  return (() => {
    const result = Fn(() => {
      const layers = weights.toVar();
      const mixed = weights.r.max(weights.g).max(weights.b).max(weights.a).lessThan(0.999);
      const present = weights.r.add(weights.g).add(weights.b).add(weights.a).greaterThan(1e-4);
      If(reach.greaterThan(0).and(mixed).and(present), () => {
        const broad = periodicFbm2(patterns.latticePoint('broad', localXZ)).toVar();
        const fine = periodicFbm2(patterns.latticePoint('fine', localXZ)).toVar();
        const edgeNoise = broad.sub(0.5).mul(1.4).add(fine.sub(0.5).mul(0.7));
        const options = { ...settings, strength: reach.mul(settings.strength).mul(path.oneMinus()), noise: edgeNoise };
        const groundHeight = fine.mul(0.35).add(0.3);
        const rockHeight = broad.mul(0.6).add(fine.mul(0.25));
        // Recover rock's mask before the snow layer covers it, then apply the
        // same ordering as the donor: rock through turf, snow into rock's cracks.
        const rawRock = weights.b.div(weights.a.oneMinus().max(1e-4)).clamp(0, 1);
        const rock = heightBlend(rawRock, groundHeight, rockHeight, options).toVar();
        const snowOnRock = heightBlend(weights.a, rockHeight, float(0.55), options);
        // Thin snow on soil settles into its hollows too: blended raw, a half-snowed
        // field read as litter under a white veil (docs/qa/biome-surface, tundra).
        const snowOnGround = heightBlend(weights.a, groundHeight, float(0.5), options);
        const snow = mix(snowOnGround, snowOnRock, rock).toVar();
        const dirt = weights.g.div(weights.r.add(weights.g).max(1e-4)).clamp(0, 1);
        const soil = heightBlend(dirt, groundHeight, broad.mul(0.3).add(0.35), options).toVar();
        const ground = rock.oneMinus().mul(snow.oneMinus());
        layers.assign(vec4(ground.mul(soil.oneMinus()), ground.mul(soil), rock.mul(snow.oneMinus()), snow));
      });
      return vec4(layers.xyz, layers.a);
    })().toVar();
    // Bank uses the same cheap relief field, evaluated only at its own edge.
    const bank = Fn(() => {
      const result = shoreline.toVar();
      If(reach.greaterThan(0).and(shoreline.greaterThan(0)).and(shoreline.lessThan(1)), () => {
        const broad = periodicFbm2(patterns.latticePoint('broad', localXZ)).toVar();
        const fine = periodicFbm2(patterns.latticePoint('fine', localXZ)).toVar();
        result.assign(heightBlend(shoreline, fine.mul(0.35).add(0.3), float(0.45), {
          ...settings, strength: reach.mul(settings.strength).mul(path.oneMinus()).mul(weights.a.oneMinus()),
          noise: broad.sub(0.5).mul(1.4).add(fine.sub(0.5).mul(0.7)),
        }));
      });
      return result;
    })();
    return { weights: result, shoreline: bank };
  })();
}
