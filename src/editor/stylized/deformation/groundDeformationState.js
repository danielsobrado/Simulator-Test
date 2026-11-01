import * as THREE from 'three/webgpu';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/**
 * Footprints in snow and sand (after grass-test's snow deformation field).
 *
 * A small toroidal texture around the player: 256² texels over a 16 m window,
 * 6.25 cm each, so a print's heel and toe read as shapes. Each footfall stamps an oriented print; the terrain material
 * reads it where the ground is snow or beach sand.
 *
 * Texels are addressed by canonical position modulo the window, so the texture
 * never scrolls. That aliases prints made one window apart, so each texel also
 * records which window it was stamped in, and the shader keeps only prints
 * from the fragment's own window. Everything the shader derives is exact at
 * planet scale: a chunk's origin is a whole number of metres, and modulo a
 * power of two that stays exact in float32 (see groundDeformationNode).
 *
 * Texel (RGBA16F): R depth 0..1, G stamp time (s, mod TIME_PERIOD),
 * B window x (mod WINDOW_ID_PERIOD), A window z (mod WINDOW_ID_PERIOD).
 *
 * Module state, like the wind field, because the terrain materials that read
 * it are built before anything stamps.
 */

export const DEFORMATION_WINDOW_METRES = 16;
export const DEFORMATION_TEXELS = 256;
export const DEFORMATION_TEXEL_METRES = DEFORMATION_WINDOW_METRES / DEFORMATION_TEXELS;
/** Stamp times wrap at this many seconds; half floats hold whole seconds this far. */
export const TIME_PERIOD = 2048;
export const WINDOW_ID_PERIOD = 256;
/** A print is gone this many seconds after it was made. */
export const PRINT_LIFETIME_SECONDS = 90;

const FOOT_LENGTH = 0.28;
const FOOT_WIDTH = 0.11;

function toHalf(value) {
  return THREE.DataUtils.toHalfFloat(value);
}

function wrap(value, period) {
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

const pixels = new Uint16Array(DEFORMATION_TEXELS * DEFORMATION_TEXELS * 4);

export const groundDeformationTexture = new THREE.DataTexture(
  pixels,
  DEFORMATION_TEXELS,
  DEFORMATION_TEXELS,
  THREE.RGBAFormat,
  THREE.HalfFloatType,
);
groundDeformationTexture.name = 'ground-deformation';
// Linear, so print edges are soft; the window check only clips a print where it
// straddles a window line.
groundDeformationTexture.magFilter = THREE.LinearFilter;
groundDeformationTexture.minFilter = THREE.LinearFilter;
groundDeformationTexture.wrapS = THREE.RepeatWrapping;
groundDeformationTexture.wrapT = THREE.RepeatWrapping;
groundDeformationTexture.generateMipmaps = false;
groundDeformationTexture.colorSpace = THREE.NoColorSpace;
groundDeformationTexture.needsUpdate = true;

export const groundDeformationUniforms = Object.freeze({
  /** Seconds, mod TIME_PERIOD, on the clock prints were stamped with. */
  time: uniform(0),
});

/** How often faded prints are wiped, in seconds; far inside TIME_PERIOD − PRINT_LIFETIME_SECONDS. */
const SWEEP_SECONDS = 10;

let clockSeconds = 0;
let lastSweepSeconds = 0;

export function updateGroundDeformation(timeSeconds) {
  if (!Number.isFinite(timeSeconds)) return;
  clockSeconds = timeSeconds;
  groundDeformationUniforms.time.value = wrap(timeSeconds, TIME_PERIOD);
  if (Math.abs(timeSeconds - lastSweepSeconds) >= SWEEP_SECONDS) {
    lastSweepSeconds = timeSeconds;
    clearFadedPrints();
  }
}

/**
 * Stamp times wrap every TIME_PERIOD seconds, so a print nothing has stamped
 * over would come back for PRINT_LIFETIME_SECONDS each time the clock wrapped
 * round to it. Its depth is wiped once it has faded, so it stays gone.
 */
function clearFadedPrints() {
  const now = wrap(clockSeconds, TIME_PERIOD);
  let cleared = false;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] === 0) continue;
    const age = wrap(now - THREE.DataUtils.fromHalfFloat(pixels[index + 1]), TIME_PERIOD);
    if (age < PRINT_LIFETIME_SECONDS) continue;
    pixels[index] = 0;
    cleared = true;
  }
  if (cleared) groundDeformationTexture.needsUpdate = true;
}

/**
 * Stamp one footprint.
 *
 * @param {number} x canonical metres
 * @param {number} z canonical metres
 * @param {number} facing body heading in radians: `(sin, cos)` is forward, so 0
 *   faces +z (CharacterMotionState.facing, which the rig is turned by)
 * @param {number} [depth] 0..1
 */
export function stampFootprint(x, z, facing, depth = 1) {
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  const time = toHalf(wrap(clockSeconds, TIME_PERIOD));
  // One texel beyond the print: linear filtering blends a print's texels with
  // their neighbours, so those must carry the same window or the print vanishes.
  const reach = Math.ceil(FOOT_LENGTH / DEFORMATION_TEXEL_METRES) + 1;
  const centreX = Math.floor(x / DEFORMATION_TEXEL_METRES);
  const centreZ = Math.floor(z / DEFORMATION_TEXEL_METRES);
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const texelX = centreX + dx;
      const texelZ = centreZ + dz;
      const offsetX = (texelX + 0.5) * DEFORMATION_TEXEL_METRES - x;
      const offsetZ = (texelZ + 0.5) * DEFORMATION_TEXEL_METRES - z;
      const along = offsetX * forwardX + offsetZ * forwardZ;
      const across = -offsetX * forwardZ + offsetZ * forwardX;
      // A heel and a toe, the toe a little wider.
      const halfWidth = FOOT_WIDTH * (along > 0 ? 1 : 0.8);
      const inside = (along / FOOT_LENGTH) ** 2 * 4 + (across / halfWidth) ** 2;
      const index = (wrap(texelZ, DEFORMATION_TEXELS) * DEFORMATION_TEXELS
        + wrap(texelX, DEFORMATION_TEXELS)) * 4;
      const windowX = toHalf(wrap(Math.floor(texelX * DEFORMATION_TEXEL_METRES / DEFORMATION_WINDOW_METRES), WINDOW_ID_PERIOD));
      const windowZ = toHalf(wrap(Math.floor(texelZ * DEFORMATION_TEXEL_METRES / DEFORMATION_WINDOW_METRES), WINDOW_ID_PERIOD));
      const sameWindow = pixels[index + 2] === windowX && pixels[index + 3] === windowZ;
      if (inside > 1) {
        // Margin: claim the texel for this window, keeping a same-window print.
        if (!sameWindow) {
          pixels[index] = 0;
          pixels[index + 1] = time;
          pixels[index + 2] = windowX;
          pixels[index + 3] = windowZ;
        }
        continue;
      }
      const value = depth * (1 - inside * 0.45);
      const existing = sameWindow ? THREE.DataUtils.fromHalfFloat(pixels[index]) : 0;
      pixels[index] = toHalf(Math.max(existing, value));
      pixels[index + 1] = time;
      pixels[index + 2] = windowX;
      pixels[index + 3] = windowZ;
    }
  }
  groundDeformationTexture.needsUpdate = true;
}

/** Test hook: the raw texel at a canonical point. */
export function readDeformationTexel(x, z) {
  const texelX = wrap(Math.floor(x / DEFORMATION_TEXEL_METRES), DEFORMATION_TEXELS);
  const texelZ = wrap(Math.floor(z / DEFORMATION_TEXEL_METRES), DEFORMATION_TEXELS);
  const index = (texelZ * DEFORMATION_TEXELS + texelX) * 4;
  return Array.from(pixels.slice(index, index + 4), (value) => THREE.DataUtils.fromHalfFloat(value));
}
