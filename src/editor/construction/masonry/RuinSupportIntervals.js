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

function overlaps(candidate, start, end) {
  const span = candidate?.support?.span;
  return Array.isArray(span) && span[0] <= end && span[1] >= start;
}

function sortedBySpanStart(candidates) {
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index - 1].support.span[0] > candidates[index].support.span[0]) {
      return false;
    }
  }
  return true;
}

/**
 * Return every interval that may support [s0,s1].
 *
 * A lower pool can contain two overlapping courses. Binary search may locate
 * the first interval starting near the target, but more than one earlier
 * interval can still reach into it. Scan all earlier candidates after locating
 * the split so no valid support is silently omitted. Callers that provide a
 * course-major pool are handled by the linear fallback.
 */
export function findOverlapCandidates(candidates, s0, s1, pad = 0) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const start = s0 - pad;
  const end = s1 + pad;

  if (!sortedBySpanStart(candidates)) {
    return candidates.filter((candidate) => overlaps(candidate, start, end));
  }

  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candidates[middle].support.span[0] < start) low = middle + 1;
    else high = middle;
  }

  const result = [];
  for (let index = 0; index < low; index += 1) {
    if (candidates[index].support.span[1] >= start) result.push(candidates[index]);
  }
  for (let index = low; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.support.span[0] > end) break;
    if (candidate.support.span[1] >= start) result.push(candidate);
  }
  return result;
}
