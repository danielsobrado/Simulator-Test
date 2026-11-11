import * as THREE from 'three/webgpu';
import { frameUniform } from '../../../render/FrameUniforms.js';

/**
 * How the finish's grade leans with the sky look (docs/look-bible.md, rule 6).
 * Multipliers on the configured `cinematicFinish`, neutral at clear noon, so
 * hour and weather move the grade and not only the exposure.
 */
export const lookGrade = Object.freeze({
  saturation: frameUniform(1),
  contrast: frameUniform(1),
  gain: frameUniform(new THREE.Vector3(1, 1, 1)),
  lift: frameUniform(1),
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * Night and storm drain colour, a storm gains contrast, a low clear sun warms
 * the highlights, and night deepens the blue lift.
 *
 * @param {{ nightness?: number, night?: boolean, overcastAmount?: number, stormAmount?: number, sunElevation?: number }} look
 */
export function resolveLookGrade(look) {
  const night = clamp01(look?.nightness ?? (look?.night ? 1 : 0));
  const cover = clamp01(look?.overcastAmount ?? 0);
  const storm = clamp01(look?.stormAmount ?? 0);
  const low = clamp01((20 - (look?.sunElevation ?? 90)) / 14);
  const golden = low * low * (3 - 2 * low) * (1 - night) * (1 - cover);
  return {
    saturation: (1 - 0.18 * night) * (1 - 0.06 * cover) * (1 - 0.1 * storm),
    contrast: 1 + 0.06 * storm,
    gain: [1 + 0.05 * golden, 1, 1 - 0.06 * golden],
    lift: 1 + 1.5 * night,
  };
}

/** Called when the sky look changes. */
export function writeLookGrade(look) {
  const grade = resolveLookGrade(look);
  lookGrade.saturation.value = grade.saturation;
  lookGrade.contrast.value = grade.contrast;
  lookGrade.gain.value.set(...grade.gain);
  lookGrade.lift.value = grade.lift;
}
