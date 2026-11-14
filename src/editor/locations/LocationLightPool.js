import { MAX_DYNAMIC_LIGHTS, locationLight } from './materials/LocationShading.js';

const DEFAULT_EASE = 0.11;
const HYSTERESIS_BONUS = 1.28;
const MAX_CULL_MARGIN = 9;
const SLOT_RELEASE_THRESHOLD = 0.015;

function computeLampPulse(light, elapsedSeconds) {
  const t = elapsedSeconds;
  const p = light.phase;
  if (light.isAbandoned) {
    const draft = Math.sin(t * 2.1 + p) * 0.42 + Math.sin(t * 4.7 + p * 1.63) * 0.35;
    const gate = Math.max(0, Math.sin(t * 8.4 + p * 2.17) * Math.sin(t * 3.1 + p * 0.71));
    const sputterDip = gate * gate * gate * 1.45;
    return Math.max(0.52, Math.min(1.16, 1 + (draft * 0.6 - sputterDip) * light.flicker));
  }
  const draft = Math.sin(t * 2.3 + p) * 0.45 + Math.sin(t * 5.9 + p * 1.37) * 0.35;
  const wick = Math.sin(t * 13.2 + p * 2.09) * 0.2;
  return Math.max(0.72, Math.min(1.14, 1 + (draft + wick - 0.12) * light.flicker));
}

/**
 * Pooled dynamic practical light controller for instanced locations.
 *
 * Updates the fixed `MAX_DYNAMIC_LIGHTS` TSL uniform slots in `locationLight`
 * with distance + importance selection, hysteresis against boundary thrashing,
 * smooth slot handoff & weight transitions, and section-aware oil-lamp flicker —
 * with zero shader recompilations and zero per-frame heap allocations.
 */
export class LocationLightPool {
  #selected;
  #selectedAssigned;

  /**
   * @param {Array<{
   *   x: number, y: number, z: number,
   *   color: number[],
   *   intensity: number,
   *   range: number,
   *   radius?: number,
   *   importance?: number,
   *   flicker?: number,
   *   section?: string,
   * }>} candidates
   * @param {{ gain?: number, hysteresis?: number, ease?: number }} [options]
   */
  constructor(candidates = [], { gain = 0.28, hysteresis = HYSTERESIS_BONUS, ease = DEFAULT_EASE } = {}) {
    this.gain = gain;
    this.hysteresis = hysteresis;
    this.ease = ease;
    this.candidates = candidates.map((light, index) => {
      const flicker = light.flicker ?? 0.08;
      return {
        ...light,
        index,
        radius: light.radius ?? 1.2,
        importance: light.importance ?? 1,
        flicker,
        isAbandoned: light.section === 'abandoned' || flicker >= 0.16,
        phase: (index + 1) * 1.61803398875 * Math.PI,
        active: false,
        slotted: false,
        weight: 0,
        score: 0,
      };
    });
    this.slots = new Array(MAX_DYNAMIC_LIGHTS).fill(null);
    this.#selected = new Array(MAX_DYNAMIC_LIGHTS).fill(null);
    this.#selectedAssigned = new Uint8Array(MAX_DYNAMIC_LIGHTS);
    this.#clearUniforms();
  }

  #clearUniforms() {
    for (let i = 0; i < MAX_DYNAMIC_LIGHTS; i += 1) {
      const slot = locationLight.dynamicLights[i];
      slot.position.value.set(0, 0, 0);
      slot.color.value.setRGB(0, 0, 0);
      slot.params.value.set(1, 1, 0);
    }
  }

  /**
   * Selects up to `MAX_DYNAMIC_LIGHTS` active practical lights around `focus`
   * and updates the shared GPU uniforms.
   *
   * @param {{ x: number, y: number, z: number }} focus camera / player position
   * @param {number} [elapsedSeconds=0]
   */
  update(focus, elapsedSeconds = 0) {
    if (this.candidates.length === 0) {
      this.#clearUniforms();
      return;
    }

    // Rank top candidates using distance, importance, and hysteresis for active ones.
    let selectedCount = 0;
    for (let i = 0; i < this.candidates.length; i += 1) {
      const item = this.candidates[i];
      const dx = item.x - focus.x;
      const dy = item.y - focus.y;
      const dz = item.z - focus.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const cullRange = item.range + MAX_CULL_MARGIN + (item.active ? 2.5 : 0);
      if (distSq > cullRange * cullRange) {
        item.score = 0;
        continue;
      }
      const base = (item.importance * item.intensity) / (1 + distSq * 0.05);
      item.score = item.active ? base * this.hysteresis : base;
      if (selectedCount < MAX_DYNAMIC_LIGHTS) {
        this.#selected[selectedCount] = item;
        selectedCount += 1;
      } else {
        let minIdx = 0;
        for (let k = 1; k < MAX_DYNAMIC_LIGHTS; k += 1) {
          if (this.#selected[k].score < this.#selected[minIdx].score) minIdx = k;
        }
        if (item.score > this.#selected[minIdx].score) this.#selected[minIdx] = item;
      }
    }

    for (let k = 0; k < selectedCount; k += 1) {
      this.#selectedAssigned[k] = 0;
    }

    const immediate = this.ease >= 0.99;

    // Preserve active slot indices; allow displaced slots to fade smoothly before release.
    for (let s = 0; s < MAX_DYNAMIC_LIGHTS; s += 1) {
      const prev = this.slots[s];
      if (!prev) continue;
      let matchIdx = -1;
      for (let k = 0; k < selectedCount; k += 1) {
        if (this.#selected[k] === prev) {
          matchIdx = k;
          break;
        }
      }
      if (matchIdx !== -1) {
        this.#selectedAssigned[matchIdx] = 1;
        prev.active = true;
        prev.slotted = true;
      } else if (!immediate && prev.weight > SLOT_RELEASE_THRESHOLD) {
        prev.active = false;
        prev.slotted = true;
      } else {
        prev.active = false;
        prev.slotted = false;
        prev.weight = 0;
        this.slots[s] = null;
      }
    }

    for (let k = 0; k < selectedCount; k += 1) {
      if (this.#selectedAssigned[k]) continue;
      const nextLight = this.#selected[k];
      for (let s = 0; s < MAX_DYNAMIC_LIGHTS; s += 1) {
        if (this.slots[s] === null) {
          this.slots[s] = nextLight;
          nextLight.active = true;
          nextLight.slotted = true;
          break;
        }
      }
    }

    const fadeEase = Math.min(1, this.ease * 1.65);
    for (let i = 0; i < this.candidates.length; i += 1) {
      const item = this.candidates[i];
      if (!item.slotted) {
        item.active = false;
        item.weight = 0;
        continue;
      }
      if (item.active) {
        item.weight += (1 - item.weight) * this.ease;
      } else {
        item.weight += (0 - item.weight) * fadeEase;
        if (item.weight <= SLOT_RELEASE_THRESHOLD && !immediate) {
          item.weight = 0;
        }
      }
    }

    for (let s = 0; s < MAX_DYNAMIC_LIGHTS; s += 1) {
      const light = this.slots[s];
      const uniformSlot = locationLight.dynamicLights[s];
      if (!light || light.weight < 0.004) {
        uniformSlot.color.value.setRGB(0, 0, 0);
        if (light && !light.active && light.weight === 0) {
          light.slotted = false;
          this.slots[s] = null;
        }
        continue;
      }
      const pulse = computeLampPulse(light, elapsedSeconds);
      const strength = light.intensity * this.gain * light.weight * pulse;
      const sputterWarmth = light.isAbandoned && pulse < 0.9 ? Math.max(0.8, 1 - (0.9 - pulse) * 0.45) : 1;
      uniformSlot.position.value.set(light.x, light.y, light.z);
      uniformSlot.color.value.setRGB(
        light.color[0] * strength,
        light.color[1] * strength * sputterWarmth,
        light.color[2] * strength * sputterWarmth * sputterWarmth,
      );
      uniformSlot.params.value.set(light.range, light.radius, 0);
    }
  }

  /** @returns {Array<object>} currently active candidate entries (for inspection/tests). */
  activeLights() {
    return this.slots.filter(Boolean);
  }

  dispose() {
    for (const item of this.candidates) {
      item.active = false;
      item.slotted = false;
      item.weight = 0;
    }
    this.slots.fill(null);
    this.#selected.fill(null);
    this.#clearUniforms();
  }
}
