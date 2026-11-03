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
/** A print is gone this many seconds after it was made, unless the biome says otherwise. */
export const PRINT_LIFETIME_SECONDS = 90;
/** The longest lifetime a biome may ask for (BiomeSurfaceLooks): well inside TIME_PERIOD. */
const MAX_PRINT_LIFETIME_SECONDS = 600;

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
  /** The region's print lifetime, seconds (biome-looks `prints.lifetime`). */
  lifetime: uniform(PRINT_LIFETIME_SECONDS),
  /** Share of bare ground that takes prints besides snow and beach (`prints.ground`). */
  ground: uniform(0),
  /** What pressed bare ground is multiplied by (`prints.tint`). */
  tint: uniform(new THREE.Color(0.72, 0.68, 0.64)),
});

/**
 * The region's print settings (biomes/BiomeSurfaceResponse.js).
 * shortcut: one lifetime for the whole window, so a print left in the last
 * biome fades on the new one's clock; per-texel lifetimes if that ever shows.
 */
export function setGroundDeformationRegion({ ground, lifetime, tint }) {
  groundDeformationUniforms.ground.value = Math.min(1, Math.max(0, ground));
  groundDeformationUniforms.lifetime.value = Math.min(MAX_PRINT_LIFETIME_SECONDS, Math.max(1, lifetime));
  groundDeformationUniforms.tint.value.setRGB(tint[0], tint[1], tint[2]);
}

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
    if (age < groundDeformationUniforms.lifetime.value) continue;
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

/** Discs wider than this are clipped: the window is only 16 m across. */
const MAX_DISC_RADIUS = 6;

/**
 * Press a disc into the ground: a spell's blast or crater in snow and sand.
 * Full depth inside `inner` of the radius, easing to nothing at the rim.
 *
 * @param {number} x canonical metres
 * @param {number} z canonical metres
 * @param {number} radius metres
 * @param {number} [depth] 0..1
 * @param {number} [inner] 0..1 share of the radius pressed to full depth
 */
export function stampDisc(x, z, radius, depth = 1, inner = 0.5) {
  const reachMetres = Math.min(radius, MAX_DISC_RADIUS);
  if (!(reachMetres > 0) || !(depth > 0)) return;
  const time = toHalf(wrap(clockSeconds, TIME_PERIOD));
  const reach = Math.ceil(reachMetres / DEFORMATION_TEXEL_METRES) + 1;
  const centreX = Math.floor(x / DEFORMATION_TEXEL_METRES);
  const centreZ = Math.floor(z / DEFORMATION_TEXEL_METRES);
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const texelX = centreX + dx;
      const texelZ = centreZ + dz;
      const distance = Math.hypot((texelX + 0.5) * DEFORMATION_TEXEL_METRES - x, (texelZ + 0.5) * DEFORMATION_TEXEL_METRES - z);
      const t = (distance / reachMetres - inner) / Math.max(1 - inner, 1e-3);
      const index = (wrap(texelZ, DEFORMATION_TEXELS) * DEFORMATION_TEXELS + wrap(texelX, DEFORMATION_TEXELS)) * 4;
      const windowX = toHalf(wrap(Math.floor(texelX * DEFORMATION_TEXEL_METRES / DEFORMATION_WINDOW_METRES), WINDOW_ID_PERIOD));
      const windowZ = toHalf(wrap(Math.floor(texelZ * DEFORMATION_TEXEL_METRES / DEFORMATION_WINDOW_METRES), WINDOW_ID_PERIOD));
      const sameWindow = pixels[index + 2] === windowX && pixels[index + 3] === windowZ;
      if (t >= 1) {
        // The margin texel joins this window (see stampFootprint).
        if (!sameWindow && distance <= reachMetres + DEFORMATION_TEXEL_METRES * 1.5) {
          pixels[index] = 0;
          pixels[index + 1] = time;
          pixels[index + 2] = windowX;
          pixels[index + 3] = windowZ;
        }
        continue;
      }
      const value = depth * (t <= 0 ? 1 : 1 - t * t * (3 - 2 * t));
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
