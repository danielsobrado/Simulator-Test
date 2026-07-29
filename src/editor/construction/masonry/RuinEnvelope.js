/**
 * Shell-LOD crown envelope from resolved ruin survivors.
 *
 * Samples are the transferable authority — `heightAt` is a same-thread
 * convenience and is stripped by worker `postMessage` structured clone.
 */

import { CONSTRUCTION_SUPPORT_ROLE } from './ConstructionSupportRoles.js';

export function sampleRuinEnvelopeHeight(envelope, s) {
  const samples = envelope?.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    return typeof envelope?.fallbackHeightAt === 'function'
      ? envelope.fallbackHeightAt(s)
      : 0;
  }
  if (s <= samples[0].s) return samples[0].height;
  const last = samples[samples.length - 1];
  if (s >= last.s) return last.height;
  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].s <= s) low = middle;
    else high = middle;
  }
  const span = samples[high].s - samples[low].s;
  const t = span > 1e-9 ? (s - samples[low].s) / span : 0;
  return samples[low].height + (samples[high].height - samples[low].height) * t;
}

function spanCovers(placement, s) {
  const span = placement?.support?.span;
  return Array.isArray(span) && s >= span[0] - 1e-6 && s <= span[1] + 1e-6;
}

function isRemovedField(entry) {
  const placement = entry?.placement;
  const role = placement?.support?.role;
  return role === CONSTRUCTION_SUPPORT_ROLE.FIELD || placement?.category === 'field';
}

export function createRuinEnvelope({
  survivors,
  removed = [],
  totalLength,
  sampleSpacing = 0.35,
  fallbackHeightAt,
  minimumHeight = 0.2,
}) {
  const spacing = Math.max(0.1, sampleSpacing);
  const count = Math.max(2, Math.ceil(totalLength / spacing) + 1);
  const removedField = removed.filter(isRemovedField);
  const samples = [];

  for (let index = 0; index < count; index += 1) {
    const s = Math.min(totalLength, (index / (count - 1)) * totalLength);
    let peak = 0;
    let found = false;
    for (const stone of survivors) {
      if (!spanCovers(stone, s)) continue;
      peak = Math.max(peak, stone.support.top);
      found = true;
    }

    const damageVoid = !found && removedField.some((entry) => spanCovers(entry.placement, s));
    const fallback = fallbackHeightAt?.(s) ?? minimumHeight;
    const height = found
      ? peak
      : damageVoid
        ? Math.min(fallback, minimumHeight)
        : fallback;
    samples.push(Object.freeze({
      s,
      height,
      fromSurvivors: found,
      damageVoid,
    }));
  }

  // Smooth surviving crown samples downward only. Damage voids retain their
  // minimum height and cannot be filled by a neighbouring macro fallback.
  const smoothed = samples.map((sample, index) => {
    if (!sample.fromSurvivors) return sample.height;
    const previous = samples[Math.max(0, index - 1)].height;
    const next = samples[Math.min(samples.length - 1, index + 1)].height;
    const blended = sample.height * 0.7 + previous * 0.15 + next * 0.15;
    return Math.min(sample.height, blended);
  });

  const frozenSamples = Object.freeze(samples.map((sample, index) => Object.freeze({
    s: sample.s,
    height: smoothed[index],
    fromSurvivors: sample.fromSurvivors,
    damageVoid: sample.damageVoid,
  })));

  const envelope = Object.freeze({ samples: frozenSamples });
  return Object.freeze({
    ...envelope,
    heightAt(s) {
      return sampleRuinEnvelopeHeight(envelope, s);
    },
  });
}
