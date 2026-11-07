import {
  attribute, clamp, materialColor, materialRoughness, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, vec3,
} from 'three/tsl';

/** Families that hold snow: everything solid. Glass and the dark recesses behind openings do not. */
const SNOWY_SLOTS = Object.freeze(new Set(['roof', 'stone', 'wood', 'mortar', 'metal']));
const SNOW = vec3(0.95, 0.96, 0.98);
/** Snow in a crease or on a narrow ledge settles a little bluer and darker. */
const SNOW_SHADE = vec3(0.8, 0.85, 0.93);
/**
 * Where snow takes hold, by how far a face turns up. Roofs hold it far steeper
 * than ledges do: at the ledge band a 45-50 degree roof only caught a grey film
 * through which every slate still showed.
 */
const HOLD = Object.freeze({ roof: [0.18, 0.42], other: [0.42, 0.68] });

/**
 * Snow lying on a town in snow country: every face turned up — roofs, ledges,
 * beams, rails, sills — carries a soft-edged cap, as Community Shaders' snow
 * cover lays it over Skyrim's towns. How much snow is the instance's own
 * (`instanceBiomeLook.w`, the biome's ground snow at the town), so one pooled
 * variant stands bare in a meadow town and snowed-in on the tundra.
 *
 * Faces turned down get none, so eaves, porch roofs and overhangs shelter what
 * is under them for free; vertical walls keep only a dusting in their relief.
 *
 * @param {object} material a graded workshop material
 * @param {string} slot its material family
 */
export function snowSettlementMaterial(material, slot) {
  if (!SNOWY_SLOTS.has(slot)) return;
  const amount = clamp(attribute('instanceBiomeLook', 'vec4').w.mul(1.4), 0, 1);
  // Broken edge: snow thins first where a face tips toward vertical, in drifts.
  const drift = mx_noise_float(positionWorld.mul(0.9)).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionWorld.mul(5.3)).mul(0.5).add(0.5);
  const up = normalWorld.y.add(drift.sub(0.5).mul(0.35)).add(fine.sub(0.5).mul(0.12));
  const [from, to] = HOLD[slot] ?? HOLD.other;
  const cover = smoothstep(from, to, up).mul(amount).toVar('settlementSnow');
  const base = material.colorNode ?? materialColor;
  const snow = mix(SNOW_SHADE, SNOW, smoothstep(from, to + 0.3, normalWorld.y).mul(fine.mul(0.25).add(0.75)));
  material.colorNode = mix(base, snow, cover);
  material.roughnessNode = mix(material.roughnessNode ?? materialRoughness, 0.62, cover);
  if (material.metalnessNode || material.metalness > 0) material.metalnessNode = mix(material.metalnessNode ?? material.metalness, 0, cover);
}
