/**
 * Count-based precipitation density (storm plan §3.2), shared by rain and snow.
 *
 * Each field is allocated at its storm count. Layers are interleaved in the
 * instance buffer, and every instance stores its rank within its layer as a
 * stratified key in [0, 1). An instance is drawn while its key is below its
 * layer's live share, so the live set of every layer is a prefix of the buffer
 * and `instanceCount` trims the culled tail: a light shower pays for its own
 * drops, not for a storm's worth of invisible ones. Pure: no three.js.
 */
import { evaluateLevels, PRECIP_LEVEL_KEYS } from './stormCurves.js';

/** Opacity fades in below this share of the storm allocation, so the first drops do not pop. */
const FADE_IN_SHARE = 0.15;

/**
 * Interleave layers by stride scheduling: slot i goes to the layer furthest
 * behind its share, so any prefix holds every layer in proportion.
 *
 * @param {number[]} counts allocated instances per layer
 * @returns {{ layer: Uint8Array, rank: Uint32Array, slots: Uint32Array[] }}
 *   per slot its layer and its rank in that layer; per layer, slot of each rank
 */
export function interleaveLayers(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const layer = new Uint8Array(total);
  const rank = new Uint32Array(total);
  const slots = counts.map((count) => new Uint32Array(count));
  const placed = counts.map(() => 0);
  for (let slot = 0; slot < total; slot += 1) {
    let best = -1;
    let bestDue = Infinity;
    counts.forEach((count, index) => {
      if (placed[index] >= count) return;
      const due = (placed[index] + 0.5) / count;
      if (due < bestDue) { bestDue = due; best = index; }
    });
    layer[slot] = best;
    rank[slot] = placed[best];
    slots[best][placed[best]] = slot;
    placed[best] += 1;
  }
  return { layer, rank, slots };
}

/**
 * This frame's density for a field.
 *
 * @param {{ counts: number[] }[]} layers per layer its live count at each level
 * @param {number} channel the field's storm channel (precipitation × share × gain)
 * @param {Uint32Array[]} slots from `interleaveLayers`
 * @returns {{ live: number[], density: number[], instanceCount: number, fade: number }}
 *   live instances and live share per layer, the instances to draw, and the
 *   opacity fade-in at the very bottom of the ladder
 */
export function precipitationDensity(layers, channel, slots) {
  const level = Math.max(0, Math.min(1, Number(channel) || 0));
  let allocated = 0;
  let liveTotal = 0;
  let instanceCount = 0;
  const live = layers.map((layer, index) => {
    const max = slots[index].length;
    const count = Math.min(max, evaluateLevels(layer.counts, level, PRECIP_LEVEL_KEYS));
    allocated += max;
    liveTotal += count;
    if (count > 0) instanceCount = Math.max(instanceCount, slots[index][Math.ceil(count) - 1] + 1);
    return count;
  });
  return {
    live,
    density: live.map((count, index) => (slots[index].length ? count / slots[index].length : 0)),
    instanceCount,
    fade: allocated ? Math.min(1, liveTotal / allocated / FADE_IN_SHARE) : 0,
  };
}

/** Allocation per layer: the most any level asks for. */
export function layerAllocation(layers) {
  return layers.map((layer) => Math.ceil(Math.max(...layer.counts)));
}
