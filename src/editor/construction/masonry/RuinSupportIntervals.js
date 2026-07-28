/**
 * Interval support helpers for ruin masonry.
 */

export function intervalOverlap(a0, a1, b0, b1) {
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  return Math.max(0, end - start);
}

/**
 * Merge overlapping [start,end] intervals and return total covered length plus
 * the largest uncovered gap inside [s0,s1].
 */
export function coverageWithinSpan(span0, span1, supports) {
  const width = Math.max(0, span1 - span0);
  if (!(width > 0)) {
    return {
      covered: 0,
      ratio: 1,
      leftOverhang: 0,
      rightOverhang: 0,
      largestGap: 0,
      merged: [],
    };
  }

  const clipped = [];
  for (const [s0, s1] of supports) {
    const start = Math.max(span0, s0);
    const end = Math.min(span1, s1);
    if (end > start) clipped.push([start, end]);
  }
  clipped.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (!last || interval[0] > last[1]) {
      merged.push([interval[0], interval[1]]);
    } else {
      last[1] = Math.max(last[1], interval[1]);
    }
  }

  let covered = 0;
  for (const [start, end] of merged) covered += end - start;

  const leftOverhang = merged.length > 0
    ? Math.max(0, merged[0][0] - span0)
    : width;
  const rightOverhang = merged.length > 0
    ? Math.max(0, span1 - merged[merged.length - 1][1])
    : width;

  let largestGap = 0;
  let cursor = span0;
  for (const [start, end] of merged) {
    largestGap = Math.max(largestGap, start - cursor);
    cursor = end;
  }
  largestGap = Math.max(largestGap, span1 - cursor);

  return {
    covered,
    ratio: covered / width,
    leftOverhang,
    rightOverhang,
    largestGap,
    merged,
  };
}

/**
 * Binary-search candidates sorted by span start for possible supporters.
 */
export function findOverlapCandidates(sortedByStart, s0, s1, pad = 0) {
  if (!sortedByStart.length) return [];
  const target = s0 - pad;
  let low = 0;
  let high = sortedByStart.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const start = sortedByStart[mid].support.span[0];
    if (start < target) low = mid + 1;
    else high = mid;
  }
  const result = [];
  for (let index = Math.max(0, low - 1); index < sortedByStart.length; index += 1) {
    const candidate = sortedByStart[index];
    if (candidate.support.span[0] > s1 + pad) break;
    if (candidate.support.span[1] >= s0 - pad) result.push(candidate);
  }
  return result;
}
