/**
 * The drow's art direction, as data.
 *
 * Three `vec4` arrays, one entry per material slot, uploaded as uniforms so every
 * value stays live-tunable and nothing is baked into the shader graph.
 *
 * Two properties of these numbers are deliberate and were reasoned from the
 * renderer rather than picked as colours.
 *
 * **They are very dark, but not black.** The scene tone-maps with ACES at 1.12
 * exposure ("InfiniteTerrainView"), which compresses the bottom of the range
 * hard. A drow reads as obsidian, and the temptation is to author obsidian as
 * near-zero albedo — but ACES then crushes the whole figure to a silhouette with
 * no form in it at all, and the careful bevel lighting and baked cavity occlusion
 * stop being visible. Every albedo here is floored around 0.015 linear, which is
 * about four stops under the grass and still lands on the part of the curve that
 * has gradient in it.
 *
 * **The violet is in the hue, not the saturation.** Direct sun in this scene is
 * warm ("#fff1cf"), so a strongly violet albedo comes back out of the multiply as
 * warm grey and the drow just looks dusty. What survives the warm multiply is a
 * small blue-over-red bias in the albedo plus a genuinely violet *sheen*, which
 * is a separate additive lobe and is not multiplied by the sun's colour in the
 * same way. That is why the piwafwi's read comes from `sheenTint` and not from
 * its albedo.
 */

import { MATERIAL_SLOT_COUNT } from '../materialSlots.js';

/** rgb albedo, then base roughness. */
const ALBEDO = [
  [0.022, 0.016, 0.038, 0.86], // 0 robe — black wool, violet undertone
  [0.016, 0.012, 0.032, 0.78], // 1 piwafwi — deeper still; the sheen carries it
  [0.170, 0.160, 0.185, 0.82], // 2 under-layer at the collar
  [0.030, 0.026, 0.030, 0.55], // 3 leather — belt, boots, gloves
  [0.055, 0.046, 0.068, 0.42], // 4 skin — obsidian; low roughness for a cheekbone
  [0.240, 0.200, 0.330, 0.68], // 5 trim — pale violet-silver, carries the sigil
  [0.720, 0.730, 0.780, 0.80], // 6 fur and hair — silver-white
  [0.020, 0.020, 0.030, 0.50], // 7 eyes — almost all emission, barely any albedo
];

/**
 * (sheen, streak, transmission, weaveDepth) per slot.
 *
 * `streak` is the anisotropic hair highlight — see `drowFabricNodes`. It is a
 * separate channel rather than three.js's own `anisotropy` because that input
 * needs a tangent frame the cloth mesh does not carry: `position` on the garment
 * mesh is a parameter triple, not a location, and there is nothing to compute
 * tangents from at load time.
 *
 * Transmission is the number to be careful with. Sunlight through a *black* robe
 * multiplied by a *warm* sun comes back grey, so a generous transmission term
 * does not make the garment glow, it desaturates it until the albedo stops
 * mattering. Heavy wool is close to opaque; only the thin under-layer and the
 * hair get a real value.
 */
const PARAMS = [
  [0.26, 0.00, 0.05, 1.00],
  [0.42, 0.00, 0.06, 0.90],
  [0.35, 0.00, 0.22, 1.10],
  [0.06, 0.00, 0.01, 0.35],
  [0.05, 0.00, 0.10, 0.00],
  [0.30, 0.00, 0.12, 1.00],
  [0.85, 1.00, 0.55, 0.00],
  [0.00, 0.00, 0.00, 0.00],
];

/**
 * Sheen colour, then emissive strength.
 *
 * Slot 7 has no sheen — it is the eyes — so its rgb carries the *glow* colour
 * instead and `.w` is what multiplies it. Reusing the lane rather than adding a
 * fourth palette array keeps the whole palette at three uniform uploads.
 */
const SHEEN_TINT = [
  [0.42, 0.30, 0.72, 0.0], // 0 robe — a violet rim on black wool
  [0.58, 0.34, 1.00, 0.0], // 1 piwafwi — the loudest sheen on the figure
  [0.90, 0.88, 0.92, 0.0],
  [0.50, 0.46, 0.44, 0.0],
  [0.55, 0.48, 0.80, 0.0], // 4 skin — a cool violet sheen at grazing angles
  [0.80, 0.70, 1.00, 0.0],
  [0.95, 0.96, 1.00, 0.0], // 6 hair — near-white; the streak does the colouring
  [0.62, 0.42, 1.00, 6.5], // 7 eyes — violet-white; the only emissive surface
];

function flatten(rows) {
  const out = new Float32Array(MATERIAL_SLOT_COUNT * 4);
  for (let i = 0; i < MATERIAL_SLOT_COUNT; i++) {
    for (let k = 0; k < 4; k++) out[i * 4 + k] = rows[i][k];
  }
  return out;
}

/**
 * @param {object} [overrides] partial rows keyed by slot, for config and tests
 */
export function createDrowPalette(overrides = null) {
  const albedo = ALBEDO.map((row) => row.slice());
  const params = PARAMS.map((row) => row.slice());
  const sheenTint = SHEEN_TINT.map((row) => row.slice());

  if (overrides) {
    for (const [slot, patch] of Object.entries(overrides)) {
      const i = Number(slot);
      if (!Number.isInteger(i) || i < 0 || i >= MATERIAL_SLOT_COUNT) {
        throw new Error(`Unknown drow palette slot "${slot}".`);
      }
      if (patch.albedo) albedo[i].splice(0, 3, ...patch.albedo);
      if (Number.isFinite(patch.roughness)) albedo[i][3] = patch.roughness;
      if (patch.params) params[i].splice(0, patch.params.length, ...patch.params);
      if (patch.sheenColor) sheenTint[i].splice(0, 3, ...patch.sheenColor);
      if (Number.isFinite(patch.emissive)) sheenTint[i][3] = patch.emissive;
    }
  }

  return {
    albedo: flatten(albedo),
    params: flatten(params),
    sheenTint: flatten(sheenTint),
  };
}

/**
 * The floor the palette must stay above so ACES does not crush the figure into a
 * flat silhouette. Asserted by `test/drow-appearance-contract.test.js`.
 */
export const BLACK_CRUSH_FLOOR = 0.012;
