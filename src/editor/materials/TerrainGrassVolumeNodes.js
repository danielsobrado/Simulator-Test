import { Fn, If, float, mix, smoothstep, vec2 } from 'three/tsl';
import { meadowNoise } from '../stylized/meadow/meadowNoise.js';

/** Stand density at a canonical point: plants, with stems that melt out with distance. */
function strandDensity(point, settings, fine) {
  const plants = meadowNoise(point.div(settings.plantMeters));
  const stems = meadowNoise(point.div(settings.stemMeters).add(vec2(17.3, 5.9)));
  return smoothstep(0.28, 0.72, mix(plants, stems, fine.mul(0.55)));
}

/**
 * Grass "inside" the terrain's surface: march the view ray down a layer of
 * `height` metres and stop at the first level the stand reaches. A far field
 * gets depth and parallax with no geometry, instances or viewport textures.
 * Returns vec2(hit, level), level 0 at the root and 1 at the tip.
 *
 * Compiled only with `groundCover.volume.enabled`; `mask` skips the march on
 * every fragment outside the band.
 */
export function terrainGrassVolume({ worldXZ, view, cameraDistance, mask, settings }) {
  const fine = smoothstep(settings.stemFadeStart, settings.stemFadeEnd, cameraDistance).oneMinus();
  return Fn(() => {
    const hit = float(0).toVar();
    const level = float(0).toVar();
    If(mask.greaterThan(0.002), () => {
      const slope = view.xz.div(view.y.abs().max(settings.minGraze)).mul(settings.height);
      for (let step = 0; step < settings.steps; step++) {
        const height = 1 - (step + 0.5) / settings.steps;
        const density = strandDensity(worldXZ.sub(slope.mul(height)), settings, fine);
        If(hit.lessThan(0.5).and(density.greaterThan(height)), () => {
          hit.assign(1);
          level.assign(height);
        });
      }
    });
    return vec2(hit, level);
  })();
}
