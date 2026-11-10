import { frameUniform } from '../../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import {
  float,
  floor,
  int,
  mix,
  step,
  texture,
  uniformArray,
  uv,
  vec4,
} from 'three/tsl';
import {
  GrassTrampleContacts,
  DEFAULT_TRAMPLE_CONTACT_CAPACITY,
} from './GrassTrampleContacts.js';
import {
  emptyInk,
  encodeAmount,
  inkAdd,
  inkFromContact,
  inkTranslate,
  raisedPeak,
  recoverPeak,
  recoveryFactor,
  scrollShift,
  snapToTexel,
  texelMetres,
  updateDue,
  updatePlan,
} from './trampleMath.js';

/**
 * Where feet have been, as a player-centred texture the grass reads (after
 * grass-test's `InteractionMap`).
 *
 * The donor keeps a CPU byte array and scrolls it by hand each frame. This is
 * the same field with the per-pixel work on the GPU: one small render target
 * holds the state, a fullscreen TSL pass reprojects it when the window moves,
 * applies the recovery decay and presses this frame's contacts, and the result
 * is copied back into the target materials sample. The *decisions* -- when the
 * pass is worth running, how far a texel has recovered, which texels a contact
 * dirties -- are all in `trampleMath`, so they are pinned by tests rather than
 * only visible in a browser, and this file is the plumbing around them.
 *
 * Two things are deliberately not the donor's:
 *
 * - Everything on the wire is *window-local*. A canonical coordinate on an
 *   imported world is millions of metres from the origin, where float32 cannot
 *   resolve a 0.3 m texel; a contact uploaded as `contact - windowCentre` is a
 *   small difference either side of the UV seam, and the same difference is what
 *   the fragment shader computes from its own uv. The donor is a fixed map and
 *   never had to think about this.
 * - The decay is per *second*, not per frame. The donor's 0.94 a frame is 0.94^60
 *   a second at 60 fps; expressing it per second is what lets the pass run on a
 *   capped cadence without the footprints lasting longer when the cap bites.
 *
 * Lifecycle matches the rest of this project: allocation is transactional (a
 * failure disposes every partial resource before it throws), reconfiguration
 * releases the old targets in one place, and `dispose()` is idempotent because
 * the surface view calls it on a teardown path that can also be reached from a
 * failed boot.
 */

export const DEFAULT_TRAMPLE_FIELD = Object.freeze({
  enabled: true,
  /** State texture edge, texels. 256 over 75 m is the donor's 0.29 m. */
  texels: 256,
  /** Metres the state texture spans around the player. */
  windowMetres: 75,
  /**
   * Per second, the donor's 0.94 per frame at 60 fps. A footprint springs back
   * in about a second and a half; any slower and a walked path stays a scar.
   */
  recoveryPerSecond: 0.94 ** 60,
  /**
   * Per second, how the contact freshness channel fades. Slower than the bend on
   * purpose: it is the signal that survives the grass standing back up, so a
   * material can tell ground trodden a moment ago from an old path.
   */
  freshnessPerSecond: 0.62,
  /**
   * The pass cap. The donor repaints every frame; recovery is a slow fade and the
   * window is 256 squared, so 12 Hz is under the threshold where a print reads as
   * stepping rather than pressing. Contacts are never delayed by the cap -- a
   * footfall forces the pass -- and a settled field is skipped entirely.
   */
  updateIntervalSeconds: 1 / 12,
});

/** The donor's layout, so the grass material's decode does not change. */
const NEUTRAL_TEXEL = 0.5;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function resolveParams(config) {
  const merged = { ...DEFAULT_TRAMPLE_FIELD, ...(config ?? {}) };
  return {
    enabled: merged.enabled !== false,
    texels: Number.isFinite(merged.texels)
      ? Math.max(8, Math.round(merged.texels))
      : DEFAULT_TRAMPLE_FIELD.texels,
    windowMetres: merged.windowMetres > 0
      ? merged.windowMetres
      : DEFAULT_TRAMPLE_FIELD.windowMetres,
    recoveryPerSecond: clamp01(merged.recoveryPerSecond),
    freshnessPerSecond: clamp01(merged.freshnessPerSecond),
    updateIntervalSeconds: merged.updateIntervalSeconds > 0
      ? merged.updateIntervalSeconds
      : 0,
  };
}

export class GrassTrampleField {
  /**
   * @param {object} [options]
   * @param {object} [options.config] field overrides (`stylizedSurface.grass.trample`)
   * @param {GrassTrampleContacts} [options.contacts] the shared contact buffer
   */
  constructor({ config = {}, contacts = null } = {}) {
    this.params = resolveParams(config);
    this.enabled = this.params.enabled;
    this.contacts = contacts ?? new GrassTrampleContacts(DEFAULT_TRAMPLE_CONTACT_CAPACITY);
    this.capacity = this.contacts.capacity;
    this.state = null;
    this.scratch = null;
    this.material = null;
    this.quad = null;
    this.#released = false;
    this.placed = false;
    this.centreX = 0;
    this.centreZ = 0;
    this.lastUpdateSeconds = 0;
    this.seconds = 0;
    /** Updates drawn since construction, for the perf counters. */
    this.updates = 0;
    /** High-water mark of the crush byte, the donor's "peak". */
    this.peak = 0;
    this.paintedPeak = 0;
    /** Inclusive texel rectangle containing every non-neutral texel, the donor's "ink". */
    this.ink = emptyInk();
    this.#paintedRect = emptyInk();

    const contactVectors = Array.from({ length: this.capacity }, () => new THREE.Vector4());
    const motionVectors = Array.from({ length: this.capacity }, () => new THREE.Vector4());
    this.uniforms = {
      /**
       * Render-space centre of the window. A material turns its own render
       * position into field uv with this and `windowMetres` -- see
       * `windowUv` in trampleMath for the CPU twin of that expression.
       */
      windowCentreRender: frameUniform(new THREE.Vector2()),
      windowMetres: frameUniform(this.params.windowMetres),
      /** Whole-texel scroll, in uv, applied to the previous state. */
      scrollUv: frameUniform(new THREE.Vector2()),
      recovery: frameUniform(1),
      freshness: frameUniform(1),
      /** Per contact: window-local X, window-local Z, radius, strength. */
      contacts: uniformArray(contactVectors, 'vec4'),
      /** Per contact: push X, push Z, inner radius fraction, directional blend. */
      motions: uniformArray(motionVectors, 'vec4'),
    };

    this.#allocate();
  }

  #released;
  #paintedRect;

  /** The state texture a material samples. Stable for the field's lifetime. */
  get stateTexture() {
    return this.state ? this.state.texture : null;
  }

  get windowMetres() {
    return this.params.windowMetres;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    return this;
  }

  /** Queue a contact for the next update. See `GrassTrampleContacts.submitContact`. */
  submitContact(contact) {
    return this.contacts.submitContact(contact);
  }

  /**
   * Advance the window and, on the capped cadence, redraw the field.
   *
   * @param {object} renderer a WebGPU renderer
   * @param {object} focus where the window is centred
   * @param {number} focus.canonicalX canonical metres
   * @param {number} focus.canonicalZ canonical metres
   * @param {number} focus.renderX the same point in render space
   * @param {number} focus.renderZ the same point in render space
   * @param {number} seconds a monotonic clock, for the capped cadence
   * @returns {boolean} whether a pass was drawn
   */
  update(renderer, focus, seconds) {
    if (!this.enabled || this.#released || !this.state) return false;
    const time = Number.isFinite(seconds) ? seconds : this.seconds;
    const texel = texelMetres(this.params.windowMetres, this.params.texels);
    const canonicalX = Number.isFinite(focus?.canonicalX) ? focus.canonicalX : 0;
    const canonicalZ = Number.isFinite(focus?.canonicalZ) ? focus.canonicalZ : 0;
    // The window only moves in whole texels, so the world point under a texel is
    // the same one before and after a scroll and the field cannot swim.
    const centreX = snapToTexel(canonicalX, texel);
    const centreZ = snapToTexel(canonicalZ, texel);
    if (!this.placed) {
      this.centreX = centreX;
      this.centreZ = centreZ;
      this.lastUpdateSeconds = time;
      this.placed = true;
    }
    const shift = scrollShift(centreX - this.centreX, centreZ - this.centreZ, texel);
    const hasContacts = this.contacts.count > 0;
    const plan = updatePlan({
      peak: this.peak,
      shiftX: shift.shiftX,
      shiftY: shift.shiftY,
      hasContacts,
    });
    const elapsed = time - this.lastUpdateSeconds;
    const due = updateDue({
      plan,
      hasContacts,
      elapsedSeconds: elapsed,
      intervalSeconds: this.params.updateIntervalSeconds,
    });

    // The sampling centre is published every frame, not only when the pass runs.
    // It is what turns a blade's render position into the field's uv, and a
    // centre that only moved with the pass would swim between updates. Anchored
    // to the snapped centre so it agrees with the content exactly.
    this.uniforms.windowCentreRender.value.set(
      (Number.isFinite(focus?.renderX) ? focus.renderX : 0) + (centreX - canonicalX),
      (Number.isFinite(focus?.renderZ) ? focus.renderZ : 0) + (centreZ - canonicalZ),
    );
    this.seconds = time;
    if (!due) return false;

    this.#upload(centreX, centreZ);
    const factor = recoveryFactor(this.params.recoveryPerSecond, Math.max(0, elapsed));
    this.uniforms.recovery.value = factor;
    this.uniforms.freshness.value = recoveryFactor(this.params.freshnessPerSecond, Math.max(0, elapsed));
    this.uniforms.scrollUv.value.set(shift.shiftX / this.params.texels, shift.shiftY / this.params.texels);
    this.render(renderer);

    // Bookkeeping after the pass, so the skip logic above reads what was drawn.
    // `ink` is reported rather than used to bound the draw: the pass covers the
    // whole 256-squared window, which is cheaper than a scissor that would also
    // have to wipe the band the scroll vacates, and at 12 Hz the difference is
    // not measurable. It stays because it is the field's answer to "is anything
    // dirty, and where", and the CPU twin and the tests both need it.
    this.peak = recoverPeak(this.peak, factor);
    this.peak = raisedPeak(this.peak, this.paintedPeak);
    this.ink = inkAdd(
      inkTranslate(this.ink, shift.shiftX, shift.shiftY, this.params.texels),
      this.#paintedRect,
      this.params.texels,
    );
    // Once the high-water mark is zero the whole field is byte-exactly neutral,
    // so there is nothing left to recover and the ink goes with it.
    if (this.peak === 0) this.ink = emptyInk();
    this.centreX = centreX;
    this.centreZ = centreZ;
    this.lastUpdateSeconds = time;
    this.contacts.clear();
    this.updates += 1;
    return true;
  }

  /** Draw this update's pass. Call between the scene passes, before the grass draws. */
  render(renderer) {
    const previousTarget = renderer.getRenderTarget();
    const previousMrt = renderer.getMRT?.() ?? null;
    renderer.setMRT?.(null);
    // Read the state, write the scratch: a single target cannot be both, and the
    // state's texture identity is what materials hold.
    renderer.setRenderTarget(this.scratch);
    try {
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT?.(previousMrt);
    }
    renderer.copyTextureToTexture(this.scratch.texture, this.state.texture);
  }

  /**
   * Re-tune in place, rebuilding only what the change requires.
   *
   * A change of resolution cannot be applied to a live mapping, so the old state
   * and scratch targets are released together and a fresh pair is built; every
   * other setting is a uniform and costs nothing.
   */
  configure(overrides = {}) {
    if (this.#released) {
      throw new Error('GrassTrampleField cannot be reconfigured after dispose().');
    }
    const next = resolveParams({ ...this.params, ...overrides });
    const remap = next.texels !== this.params.texels;
    this.params = next;
    this.enabled = next.enabled;
    this.uniforms.windowMetres.value = next.windowMetres;
    if (!remap) return this;
    this.#releaseTargets();
    this.peak = 0;
    this.paintedPeak = 0;
    this.ink = emptyInk();
    this.#paintedRect = emptyInk();
    this.placed = false;
    this.#allocate();
    return this;
  }

  /** Forget everything painted; the next update draws an empty field. */
  reset() {
    this.peak = 0;
    this.paintedPeak = 0;
    this.ink = emptyInk();
    this.#paintedRect = emptyInk();
    this.placed = false;
    this.contacts.clear();
    return this;
  }

  /** Idempotent: a second call after a teardown, or after a failed boot, is a no-op. */
  dispose() {
    if (this.#released) return;
    this.#released = true;
    this.#releaseTargets();
  }

  /**
   * Build the targets and the update pass, disposing every partial resource if
   * any step throws. A field that leaked its state target would keep a 256 KiB
   * GPU allocation alive across a teardown, and the teardown is exactly the path
   * that runs when something else has already failed.
   */
  #allocate() {
    const created = [];
    try {
      const options = {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        generateMipmaps: false,
      };
      this.state = new THREE.RenderTarget(this.params.texels, this.params.texels, options);
      this.state.texture.name = 'grass-trample-state';
      created.push(this.state);
      this.scratch = new THREE.RenderTarget(this.params.texels, this.params.texels, options);
      this.scratch.texture.name = 'grass-trample-scratch';
      created.push(this.scratch);
      this.material = new THREE.NodeMaterial();
      this.material.name = 'grass-trample-update';
      this.material.toneMapped = false;
      this.material.depthTest = false;
      this.material.depthWrite = false;
      created.push(this.material);
      this.material.fragmentNode = this.#buildFragment();
      this.quad = new THREE.QuadMesh(this.material);
      this.#released = false;
    } catch (error) {
      for (const resource of created) resource.dispose?.();
      this.state = null;
      this.scratch = null;
      this.material = null;
      this.quad = null;
      this.#released = true;
      throw error;
    }
  }

  /** The one place a target is released. Reconfiguration and disposal both come here. */
  #releaseTargets() {
    this.state?.dispose();
    this.scratch?.dispose();
    this.material?.dispose();
    this.state = null;
    this.scratch = null;
    this.material = null;
    this.quad = null;
  }

  /**
   * Copy the contacts into the uniform array, window-local.
   *
   * A fresh target reads all-zero, and that is already neutral: with the crush
   * byte at 0 every direction term the material builds is multiplied by zero, so
   * the field needs no clear pass at allocation. Only the direction bias differs
   * from the donor's neutral, and nothing reads it while the crush is zero.
   */
  #upload(centreX, centreZ) {
    const contactVectors = this.uniforms.contacts.array;
    const motionVectors = this.uniforms.motions.array;
    let paintedPeak = 0;
    let rect = emptyInk();
    let index = 0;
    this.contacts.forEach((contact) => {
      if (index >= this.capacity) return;
      contactVectors[index].set(
        contact.x - centreX,
        contact.z - centreZ,
        contact.radius,
        contact.strength,
      );
      motionVectors[index].set(
        contact.directionX,
        contact.directionZ,
        contact.innerRadiusFraction,
        contact.directionalBlend,
      );
      paintedPeak = Math.max(paintedPeak, encodeAmount(contact.strength));
      rect = inkAdd(
        rect,
        inkFromContact(contact, centreX, centreZ, this.params.windowMetres, this.params.texels),
        this.params.texels,
      );
      index += 1;
    });
    // Unused slots press nothing: a zero radius and strength give the falloff
    // zero, so the shader loop needs no count uniform and no branch per slot.
    for (let slot = index; slot < this.capacity; slot += 1) {
      contactVectors[slot].set(0, 0, 0, 0);
      motionVectors[slot].set(0, 0, 0, 0);
    }
    this.paintedPeak = paintedPeak;
    this.#paintedRect = rect;
  }

  /**
   * The update pass: reproject, recover, press.
   *
   * The loop over contacts is unrolled in JavaScript rather than written as a
   * TSL `Loop`, because TSL nodes are immutable: accumulating "the strongest
   * contact wins the direction" is a chain of nodes, and a chain is what the
   * unroll produces. The channel length is the contact capacity, which is small
   * by construction.
   */
  #buildFragment() {
    const { uniforms, state } = this;
    const source = uv().add(uniforms.scrollUv);
    // Off the window there is no history; the donor's clamp-to-edge plus a full
    // clear-and-copy leaves the vacated band neutral, and here the same band has
    // to be said explicitly or the edge texel would smear across it.
    const inside = step(0, source.x)
      .mul(step(source.x, 1))
      .mul(step(0, source.y))
      .mul(step(source.y, 1));
    const previous = texture(state.texture, source.clamp(0, 1));
    const neutral = vec4(NEUTRAL_TEXEL, NEUTRAL_TEXEL, 0, 0);
    const base = mix(neutral, previous, inside);

    // Bytes, so the pass is the same floor(value * factor) the CPU twin tests.
    const crush = floor(base.b.mul(255).mul(uniforms.recovery)).div(255);
    const freshness = floor(base.a.mul(255).mul(uniforms.freshness)).div(255);
    // Window-local fragment position, in metres, matching the uploaded contacts.
    const local = uv().sub(0.5).mul(uniforms.windowMetres);

    let amount = crush;
    let directionX = base.r;
    let directionZ = base.g;
    let fresh = freshness;

    for (let index = 0; index < this.capacity; index += 1) {
      const contact = uniforms.contacts.element(int(index));
      const motion = uniforms.motions.element(int(index));
      const dx = contact.x.sub(local.x);
      const dz = contact.y.sub(local.y);
      const distance = dx.mul(dx).add(dz.mul(dz)).sqrt();
      const radius = contact.z;
      const inner = motion.z.mul(radius);
      const span = radius.sub(inner).max(1e-4);
      const t = distance.sub(inner).div(span).clamp(0, 1);
      // The quadratic falloff of `contactFalloff`, written once here and once
      // there; a drift between them is grass that stays bent on neutral ground.
      const falloff = float(1).sub(t.mul(t));
      const pressed = contact.w.mul(falloff);
      // The stronger contact owns the direction. `takes` is read before `amount`
      // is raised, and is gated on the contact pressing at all, or an empty slot
      // would overwrite the recovered direction with a normalised zero.
      const takes = step(amount, pressed).mul(step(1e-4, pressed));
      const inverse = float(1).div(distance.max(1e-3));
      const pushX = mix(dx.mul(inverse), motion.x, motion.w).mul(0.5).add(0.5);
      const pushZ = mix(dz.mul(inverse), motion.y, motion.w).mul(0.5).add(0.5);
      amount = amount.max(pressed);
      directionX = mix(directionX, pushX, takes);
      directionZ = mix(directionZ, pushZ, takes);
      fresh = fresh.max(step(1e-4, pressed));
    }

    return vec4(directionX, directionZ, amount, fresh);
  }
}
