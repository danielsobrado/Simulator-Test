/**
 * Shell-LOD crown envelope from resolved ruin survivors.
 */

export function createRuinEnvelope({
  survivors,
  totalLength,
  sampleSpacing = 0.35,
  fallbackHeightAt,
}) {
  const spacing = Math.max(0.1, sampleSpacing);
  const count = Math.max(2, Math.ceil(totalLength / spacing) + 1);
  const samples = [];

  for (let index = 0; index < count; index += 1) {
    const s = Math.min(totalLength, (index / (count - 1)) * totalLength);
    let peak = 0;
    let found = false;
    for (const stone of survivors) {
      const span = stone.support?.span;
      if (!span) continue;
      if (s < span[0] - 1e-6 || s > span[1] + 1e-6) continue;
      peak = Math.max(peak, stone.support.top);
      found = true;
    }
    const fallback = fallbackHeightAt?.(s) ?? 0;
    // Never fill a notch above survivors; mild blend only when empty.
    const height = found ? peak : fallback;
    samples.push(Object.freeze({ s, height, fromSurvivors: found }));
  }

  // Mild smoothing that never exceeds local max of neighbours+self.
  const smoothed = samples.map((sample, index) => {
    if (!sample.fromSurvivors) return sample.height;
    const prev = samples[Math.max(0, index - 1)].height;
    const next = samples[Math.min(samples.length - 1, index + 1)].height;
    const blended = sample.height * 0.7 + prev * 0.15 + next * 0.15;
    return Math.min(sample.height, blended);
  });

  function heightAt(s) {
    if (samples.length === 0) return fallbackHeightAt?.(s) ?? 0;
    if (s <= samples[0].s) return smoothed[0];
    if (s >= samples[samples.length - 1].s) return smoothed[smoothed.length - 1];
    let low = 0;
    let high = samples.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (samples[mid].s <= s) low = mid;
      else high = mid;
    }
    const span = samples[high].s - samples[low].s;
    const t = span > 1e-9 ? (s - samples[low].s) / span : 0;
    return smoothed[low] + (smoothed[high] - smoothed[low]) * t;
  }

  return Object.freeze({
    samples: Object.freeze(samples.map((sample, index) => Object.freeze({
      s: sample.s,
      height: smoothed[index],
      fromSurvivors: sample.fromSurvivors,
    }))),
    heightAt,
  });
}
