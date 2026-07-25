const OPENING_KINDS = new Set(['door', 'window', 'opening']);
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_EDGE_INSET = 0.06;
const DEFAULT_NEIGHBOR_GAP = 0.16;
const EPSILON = 1e-6;

function clamp(value, minimum, maximum) {
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, value));
}

function finitePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizedSize(size) {
  return {
    x: finitePositive(size?.x, EPSILON),
    y: finitePositive(size?.y, EPSILON),
  };
}

function normalizedBounds(bounds) {
  if (
    !bounds
    || !Number.isFinite(bounds.minX)
    || !Number.isFinite(bounds.maxX)
    || !Number.isFinite(bounds.minY)
    || !Number.isFinite(bounds.maxY)
    || bounds.minX > bounds.maxX
    || bounds.minY > bounds.maxY
  ) {
    return null;
  }
  return bounds;
}

function bestCandidate(value, candidates, threshold) {
  let best = null;
  for (const candidate of candidates) {
    const distance = Math.abs(value - candidate.value);
    if (distance > threshold * (candidate.thresholdMultiplier ?? 1)) continue;
    if (
      !best
      || distance < best.distance - EPSILON
      || (
        Math.abs(distance - best.distance) <= EPSILON
        && candidate.priority < best.priority
      )
    ) {
      best = { ...candidate, distance };
    }
  }
  return best;
}

function openingRect(item) {
  const size = normalizedSize(item.size);
  return {
    kind: item.kind,
    label: item.label ?? 'nearby opening',
    centerX: item.position.x,
    centerY: item.position.y,
    width: size.x,
    height: size.y,
    left: item.position.x - size.x / 2,
    right: item.position.x + size.x / 2,
    bottom: item.position.y - size.y / 2,
    top: item.position.y + size.y / 2,
  };
}

function neighborPriority(selectedKind, neighborKind) {
  return selectedKind === neighborKind ? 0 : 1;
}

function positionCandidates({
  kind,
  size,
  wall,
  siblings,
  edgeInset,
  neighborGap,
}) {
  const halfX = size.x / 2;
  const halfY = size.y / 2;
  const x = [
    {
      value: (wall.minX + wall.maxX) / 2,
      reason: 'Wall centre',
      priority: 3,
    },
    {
      value: wall.minX + edgeInset + halfX,
      reason: 'Left wall margin',
      priority: 4,
    },
    {
      value: wall.maxX - edgeInset - halfX,
      reason: 'Right wall margin',
      priority: 4,
    },
  ];
  const y = [
    {
      value: (wall.minY + wall.maxY) / 2,
      reason: 'Wall centreline',
      priority: 4,
    },
    {
      value: wall.maxY - edgeInset - halfY,
      reason: 'Wall head line',
      priority: 5,
    },
  ];

  if (kind === 'door' || kind === 'opening') {
    y.push({
      value: wall.minY + edgeInset + halfY,
      reason: 'Wall floor line',
      priority: 0,
      thresholdMultiplier: 2.5,
    });
  }

  for (const sibling of siblings) {
    const rect = openingRect(sibling);
    const priority = neighborPriority(kind, rect.kind);
    x.push(
      {
        value: rect.centerX,
        reason: `Centred with ${rect.label}`,
        priority,
      },
      {
        value: rect.left + halfX,
        reason: `Left edge aligned with ${rect.label}`,
        priority: priority + 1,
      },
      {
        value: rect.right - halfX,
        reason: `Right edge aligned with ${rect.label}`,
        priority: priority + 1,
      },
      {
        value: rect.left - neighborGap - halfX,
        reason: `Even spacing from ${rect.label}`,
        priority: priority + 2,
      },
      {
        value: rect.right + neighborGap + halfX,
        reason: `Even spacing from ${rect.label}`,
        priority: priority + 2,
      },
    );
    y.push(
      {
        value: rect.centerY,
        reason: `Row aligned with ${rect.label}`,
        priority,
      },
      {
        value: rect.bottom + halfY,
        reason: `Sill aligned with ${rect.label}`,
        priority: priority + 1,
      },
      {
        value: rect.top - halfY,
        reason: `Head aligned with ${rect.label}`,
        priority: priority + 1,
      },
    );
  }
  return { x, y };
}

function sizeCandidate(value, siblings, axis, kind, threshold) {
  const candidates = siblings.map((sibling) => {
    const target = normalizedSize(sibling.size)[axis];
    return {
      value: target,
      reason: `${axis === 'x' ? 'Width' : 'Height'} matched to ${sibling.label ?? 'nearby opening'}`,
      priority: neighborPriority(kind, sibling.kind),
      threshold: Math.max(threshold, target * 0.12),
    };
  });
  let best = null;
  for (const candidate of candidates) {
    const distance = Math.abs(value - candidate.value);
    if (distance > candidate.threshold) continue;
    if (
      !best
      || distance < best.distance - EPSILON
      || (
        Math.abs(distance - best.distance) <= EPSILON
        && candidate.priority < best.priority
      )
    ) {
      best = { ...candidate, distance };
    }
  }
  return best;
}

export function isWorkshopArchitecturalOpening(component) {
  return OPENING_KINDS.has(component?.kind);
}

export function solveWorkshopArchitecturalSnap({
  kind,
  mode = 'translate',
  position,
  size: rawSize,
  wallBounds: rawWallBounds,
  siblings = [],
  enabled = true,
  threshold = DEFAULT_THRESHOLD,
  edgeInset = DEFAULT_EDGE_INSET,
  neighborGap = DEFAULT_NEIGHBOR_GAP,
}) {
  const wall = normalizedBounds(rawWallBounds);
  const size = normalizedSize(rawSize);
  const nextPosition = {
    x: Number.isFinite(position?.x) ? position.x : 0,
    y: Number.isFinite(position?.y) ? position.y : 0,
  };
  const guides = [];
  if (!wall) return { position: nextPosition, size, guides };

  if (enabled && mode === 'scale') {
    for (const axis of ['x', 'y']) {
      const match = sizeCandidate(size[axis], siblings, axis, kind, threshold);
      if (!match) continue;
      size[axis] = match.value;
      guides.push({ axis, reason: match.reason, type: 'size' });
    }
  }

  const halfX = size.x / 2;
  const halfY = size.y / 2;
  const minX = wall.minX + edgeInset + halfX;
  const maxX = wall.maxX - edgeInset - halfX;
  const minY = wall.minY + edgeInset + halfY;
  const maxY = wall.maxY - edgeInset - halfY;

  if (enabled && mode === 'translate') {
    const candidates = positionCandidates({
      kind,
      size,
      wall,
      siblings,
      edgeInset,
      neighborGap,
    });
    for (const axis of ['x', 'y']) {
      const match = bestCandidate(nextPosition[axis], candidates[axis], threshold);
      if (!match) continue;
      nextPosition[axis] = match.value;
      guides.push({ axis, reason: match.reason, type: 'position' });
    }
  }

  const containedX = clamp(nextPosition.x, minX, maxX);
  const containedY = clamp(nextPosition.y, minY, maxY);
  if (Math.abs(containedX - nextPosition.x) > EPSILON) {
    guides.push({ axis: 'x', reason: 'Kept inside wall', type: 'containment' });
  }
  if (Math.abs(containedY - nextPosition.y) > EPSILON) {
    guides.push({ axis: 'y', reason: 'Kept inside wall', type: 'containment' });
  }
  nextPosition.x = containedX;
  nextPosition.y = containedY;

  return { position: nextPosition, size, guides };
}
