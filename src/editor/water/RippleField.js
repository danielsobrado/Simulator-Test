import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, exp, float, instanceIndex, int, ivec2, round, smoothstep, textureLoad, textureStore, uniform,
  uniformArray, vec2, vec4,
} from 'three/tsl';
import { frameUniform } from '../../render/FrameUniforms.js';

/**
 * Ripples on the water round the player: a damped 2D wave equation on a height
 * field (after the lake-ripple pass of a WebGPU water demo), driven by the
 * player wading and swimming, ambient drops and spells pressing the surface.
 *
 * The field is a 256² torus over a 32 m window, 12.5 cm a texel, addressed by
 * canonical position modulo the window like the ground deformation field, so
 * it never scrolls and every coordinate a shader derives stays exact at planet
 * scale. Waves are soaked up in a ring 15 m from the player instead of
 * wrapping round, and water past that ring does not read the field at all.
 *
 * Each frame runs two steps, A→B (with that frame's impulses) and B→A, so the
 * water always samples A. Texel (RGBA16F): R height now, G height a step ago.
 * It costs two 64k-texel compute dispatches and no viewport textures.
 */
export const RIPPLE_TEXELS = 256;
export const RIPPLE_WINDOW_METRES = 32;
export const RIPPLE_TEXEL_METRES = RIPPLE_WINDOW_METRES / RIPPLE_TEXELS;
/** Ripples fade out from this far from the player to the next. */
export const RIPPLE_REACH_METRES = Object.freeze([11, 14.5]);
export const RIPPLE_IMPULSE_CAPACITY = 16;
/** Height clamp, metres: keeps a pile of spells from blowing the field up. */
const MAX_HEIGHT = 0.03;
/** c² above this makes the explicit scheme unstable. */
const MAX_COURANT_SQUARED = 0.45;

function wrap(value, period) {
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

/** A canonical coordinate's texel position in the window, fractional. */
export function rippleWindowTexel(canonical) {
  return wrap(canonical, RIPPLE_WINDOW_METRES) / RIPPLE_TEXEL_METRES;
}

/**
 * Per-step wave coefficients for a frame of `seconds` split into two steps:
 * `c2` the squared Courant number, `damping` the per-step decay that brings a
 * ring to 5 % over `fade` seconds.
 */
export function rippleStepCoefficients(speed, fade, seconds) {
  const step = Math.min(Math.max(seconds, 1 / 240), 1 / 20) / 2;
  const courant = speed * step / RIPPLE_TEXEL_METRES;
  return {
    c2: Math.min(courant * courant, MAX_COURANT_SQUARED),
    damping: Math.exp(Math.log(0.05) * step / Math.max(fade, 0.05)),
  };
}

function storageTexture(name) {
  const texture = new THREE.StorageTexture(RIPPLE_TEXELS, RIPPLE_TEXELS);
  texture.name = name;
  texture.type = THREE.HalfFloatType;
  texture.format = THREE.RGBAFormat;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** The field the water samples (state after the B→A step); module state, like the deformation field. */
export const rippleFieldTexture = storageTexture('ripple-field-a');
const scratchTexture = storageTexture('ripple-field-b');

/** Read by the water material once per frame. */
export const rippleFieldUniforms = Object.freeze({
  /** The player in render space, for the reach fade. */
  player: frameUniform(new THREE.Vector2()),
  /** 0 hides the field (disabled, WebGL, low tier). */
  strength: frameUniform(0),
});

const step = Object.freeze({
  c2: uniform(0),
  damping: uniform(0.99),
  /** The player's texel in the window. */
  player: uniform(new THREE.Vector2()),
  count: uniform(0, 'int'),
  /** Per impulse: texel x, texel z, amplitude (m), ring radius (texels). */
  impulses: uniformArray(Array.from({ length: RIPPLE_IMPULSE_CAPACITY }, () => new THREE.Vector4()), 'vec4'),
  /** Per impulse: ring width (texels). */
  widths: uniformArray(new Array(RIPPLE_IMPULSE_CAPACITY).fill(1), 'float'),
});

/** The nearest copy of a texel offset on the torus. */
const torus = (offset) => offset.sub(round(offset.div(RIPPLE_TEXELS)).mul(RIPPLE_TEXELS));

function waveStep(source, target, inject) {
  return Fn(() => {
    const n = int(RIPPLE_TEXELS);
    const x = int(instanceIndex).mod(n);
    const z = int(instanceIndex).div(n);
    const at = (dx, dz) => textureLoad(source, ivec2(x.add(dx + RIPPLE_TEXELS).mod(n), z.add(dz + RIPPLE_TEXELS).mod(n))).r;
    const here = textureLoad(source, ivec2(x, z));
    const laplacian = at(-1, 0).add(at(1, 0)).add(at(0, -1)).add(at(0, 1)).sub(here.r.mul(4));
    const height = here.r.mul(2).sub(here.g).add(laplacian.mul(step.c2)).mul(step.damping).toVar();
    const texel = vec2(float(x).add(0.5), float(z).add(0.5));
    if (inject) {
      Loop(step.count, ({ i }) => {
        const impulse = step.impulses.element(i);
        const distance = torus(texel.sub(impulse.xy)).length();
        const band = distance.sub(impulse.w).div(step.widths.element(i));
        height.addAssign(impulse.z.mul(exp(band.mul(band).negate())));
      });
    }
    // Soak waves up before they reach the far side of the torus.
    const fromPlayer = torus(texel.sub(step.player)).length().mul(RIPPLE_TEXEL_METRES);
    height.mulAssign(float(1).sub(smoothstep(RIPPLE_REACH_METRES[1], RIPPLE_WINDOW_METRES * 0.49, fromPlayer)));
    textureStore(target, ivec2(x, z), vec4(height.clamp(-MAX_HEIGHT, MAX_HEIGHT), here.r, 0, 1));
  })().compute(RIPPLE_TEXELS * RIPPLE_TEXELS, [64]);
}

export class RippleField {
  /**
   * @param {object} options
   * @param {object} options.renderer a WebGPU-backed THREE.WebGPURenderer
   */
  constructor({ renderer }) {
    this.renderer = renderer;
    this.supported = Boolean(renderer?.backend?.isWebGPUBackend);
    this.queue = [];
    this.forward = this.supported ? waveStep(rippleFieldTexture, scratchTexture, true) : null;
    this.back = this.supported ? waveStep(scratchTexture, rippleFieldTexture, false) : null;
    this.quiet = Infinity;
  }

  /**
   * Disturb the surface. A ring `ring` metres out spreads as a ring wave; 0
   * drops a single bump `width` metres across.
   *
   * @param {number} x canonical metres
   * @param {number} z canonical metres
   * @param {number} amplitude metres, negative pushes the surface down
   */
  splash(x, z, amplitude, { ring = 0, width = 0.25 } = {}) {
    if (!this.supported || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(amplitude)) return;
    // shortcut: impulses past capacity in one frame are dropped; fine for a handful of spells and wakes.
    if (this.queue.length >= RIPPLE_IMPULSE_CAPACITY) return;
    this.queue.push({ x, z, amplitude, ring, width });
  }

  /**
   * @param {number} seconds frame delta
   * @param {{ x: number, z: number }} canonical player position
   * @param {{ x: number, z: number }} render player position
   * @param {{ speed: number, fade: number, enabled: boolean }} settings
   */
  update(seconds, canonical, render, { speed, fade, enabled }) {
    rippleFieldUniforms.strength.value = this.supported && enabled ? 1 : 0;
    if (!this.supported || !enabled) { this.queue.length = 0; return; }
    rippleFieldUniforms.player.value.set(render.x, render.z);
    // A settled field needs no steps: skip the dispatches until something lands.
    this.quiet = this.queue.length ? 0 : this.quiet + seconds;
    if (this.quiet > fade * 2 + 1) return;
    const { c2, damping } = rippleStepCoefficients(speed, fade, seconds);
    step.c2.value = c2;
    step.damping.value = damping;
    step.player.value.set(rippleWindowTexel(canonical.x), rippleWindowTexel(canonical.z));
    step.count.value = this.queue.length;
    this.queue.forEach((impulse, index) => {
      step.impulses.array[index].set(rippleWindowTexel(impulse.x), rippleWindowTexel(impulse.z),
        impulse.amplitude, impulse.ring / RIPPLE_TEXEL_METRES);
      step.widths.array[index] = Math.max(impulse.width / RIPPLE_TEXEL_METRES, 1);
    });
    this.queue.length = 0;
    this.renderer.compute(this.forward);
    this.renderer.compute(this.back);
  }

  dispose() {
    this.forward?.dispose?.();
    this.back?.dispose?.();
    this.queue.length = 0;
    rippleFieldUniforms.strength.value = 0;
  }
}
