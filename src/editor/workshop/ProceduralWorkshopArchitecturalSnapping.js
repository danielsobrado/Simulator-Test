const OPENING_KINDS = new Set(['door', 'window', 'opening']);
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_EDGE_INSET = 0.06;
const DEFAULT_NEIGHBOR_GAP = 0.16;
const DEFAULT_CLEARANCE = 0.08;
const DEFAULT_JOIN_OVERLAP_RATIO = 0.6;
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

function rectOverlaps(left, right, clearance = 0) {
  return left.right + clearance > right.left
    && left.left - clearance < right.right
    && left.top + clearance > right.bottom
    && left.bottom - clearance < right.top;
}

function rectFor(position, size) {
  return {
    left: position.x - size.x / 2,
    right: position.x + size.x / 2,
    bottom: position.y - size.y / 2,
    top: position.y + size.y / 2,
  };
}

function verticalOverlapRatio(left, right) {
  const overlap = Math.max(0, Math.min(left.top, right.top) - Math.max(left.bottom, right.bottom));
  return overlap / Math.max(EPSILON, Math.min(left.top - left.bottom, right.top - right.bottom));
}

function horizontalGap(left, right) {
  if (left.right < right.left) return right.left - left.right;
  if (right.right < left.left) return left.left - right.right;
  return 0;
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

export function findWorkshopOpeningJoinCandidates({
  kind,
  position,
  size: rawSize,
  siblings = [],
  neighborGap = DEFAULT_NEIGHBOR_GAP,
  minimumVerticalOverlap = DEFAULT_JOIN_OVERLAP_RATIO,
}) {
  if (kind !== 'door' && kind !== 'window') return Object.freeze([]);
  const selected = rectFor(position, normalizedSize(rawSize));
  return Object.freeze(siblings.filter((sibling) => {
    if (sibling.kind !== kind) return false;
    const siblingRect = openingRect(sibling);
    return verticalOverlapRatio(selected, siblingRect) + EPSILON >= minimumVerticalOverlap
      && horizontalGap(selected, siblingRect) <= neighborGap + EPSILON;
  }));
}

function placementIsClear(position, size, siblings, clearance) {
  const candidate = rectFor(position, size);
  return siblings.every((sibling) => !rectOverlaps(
    candidate,
    openingRect(sibling),
    clearance,
  ));
}

function nearestClearPosition(position, size, wall, siblings, edgeInset, clearance) {
  const halfX = size.x / 2;
  const halfY = size.y / 2;
  const minX = wall.minX + edgeInset + halfX;
  const maxX = wall.maxX - edgeInset - halfX;
  const minY = wall.minY + edgeInset + halfY;
  const maxY = wall.maxY - edgeInset - halfY;
  const xs = [clamp(position.x, minX, maxX), minX, maxX];
  const ys = [clamp(position.y, minY, maxY), minY, maxY];
  for (const sibling of siblings) {
    const rect = openingRect(sibling);
    xs.push(
      clamp(rect.left - clearance - halfX, minX, maxX),
      clamp(rect.right + clearance + halfX, minX, maxX),
    );
    ys.push(
      clamp(rect.bottom - clearance - halfY, minY, maxY),
      clamp(rect.top + clearance + halfY, minY, maxY),
    );
  }
  let best = null;
  for (const x of xs) {
    for (const y of ys) {
      const candidate = { x, y };
      if (!placementIsClear(candidate, size, siblings, clearance)) continue;
      const distance = (x - position.x) ** 2 + (y - position.y) ** 2;
      if (
        !best
        || distance < best.distance - EPSILON
        || (
          Math.abs(distance - best.distance) <= EPSILON
          && (x < best.position.x - EPSILON
            || (Math.abs(x - best.position.x) <= EPSILON && y < best.position.y))
        )
      ) {
        best = { position: candidate, distance };
      }
    }
  }
  return best?.position ?? null;
}

function nearestClearSize(position, size, wall, siblings, edgeInset, clearance) {
  const maximumWidth = Math.max(EPSILON, wall.maxX - wall.minX - edgeInset * 2);
  const maximumHeight = Math.max(EPSILON, wall.maxY - wall.minY - edgeInset * 2);
  const widths = [Math.min(size.x, maximumWidth)];
  const heights = [Math.min(size.y, maximumHeight)];
  for (const sibling of siblings) {
    const rect = openingRect(sibling);
    widths.push(
      2 * Math.max(EPSILON, rect.left - clearance - position.x),
      2 * Math.max(EPSILON, position.x - rect.right - clearance),
    );
    heights.push(
      2 * Math.max(EPSILON, rect.bottom - clearance - position.y),
      2 * Math.max(EPSILON, position.y - rect.top - clearance),
    );
  }
  let best = null;
  for (const rawWidth of widths) {
    for (const rawHeight of heights) {
      const candidate = {
        x: Math.min(size.x, maximumWidth, rawWidth),
        y: Math.min(size.y, maximumHeight, rawHeight),
      };
      if (candidate.x <= EPSILON || candidate.y <= EPSILON) continue;
      if (!placementIsClear(position, candidate, siblings, clearance)) continue;
      const distance = (candidate.x - size.x) ** 2 + (candidate.y - size.y) ** 2;
      if (
        !best
        || distance < best.distance - EPSILON
        || (
          Math.abs(distance - best.distance) <= EPSILON
          && candidate.x * candidate.y > best.size.x * best.size.y
        )
      ) {
        best = { size: candidate, distance };
      }
    }
  }
  return best?.size ?? null;
}

export function solveWorkshopOpeningConstraints({
  kind,
  mode = 'translate',
  position,
  size: rawSize,
  wallBounds: rawWallBounds,
  siblings = [],
  autoJoin = true,
  edgeInset = DEFAULT_EDGE_INSET,
  neighborGap = DEFAULT_NEIGHBOR_GAP,
  clearance = DEFAULT_CLEARANCE,
}) {
  const wall = normalizedBounds(rawWallBounds);
  const desiredPosition = {
    x: Number.isFinite(position?.x) ? position.x : 0,
    y: Number.isFinite(position?.y) ? position.y : 0,
  };
  const desiredSize = normalizedSize(rawSize);
  if (!wall) {
    return Object.freeze({
      position: desiredPosition,
      size: desiredSize,
      joins: Object.freeze([]),
      guides: Object.freeze([]),
      valid: false,
    });
  }
  const maximumSize = {
    x: Math.max(EPSILON, wall.maxX - wall.minX - edgeInset * 2),
    y: Math.max(EPSILON, wall.maxY - wall.minY - edgeInset * 2),
  };
  const size = {
    x: Math.min(desiredSize.x, maximumSize.x),
    y: Math.min(desiredSize.y, maximumSize.y),
  };
  const positionResult = {
    x: clamp(
      desiredPosition.x,
      wall.minX + edgeInset + size.x / 2,
      wall.maxX - edgeInset - size.x / 2,
    ),
    y: clamp(
      desiredPosition.y,
      wall.minY + edgeInset + size.y / 2,
      wall.maxY - edgeInset - size.y / 2,
    ),
  };
  const joins = autoJoin
    ? findWorkshopOpeningJoinCandidates({
      kind,
      position: positionResult,
      size,
      siblings,
      neighborGap,
    })
    : [];
  const joined = new Set(joins);
  const blockers = siblings.filter((sibling) => !joined.has(sibling));
  const guides = [];
  if (size.x < desiredSize.x - EPSILON || size.y < desiredSize.y - EPSILON) {
    guides.push({ axis: size.x < desiredSize.x ? 'x' : 'y', reason: 'Fit inside wall', type: 'containment' });
  }
  if (
    Math.abs(positionResult.x - desiredPosition.x) > EPSILON
    || Math.abs(positionResult.y - desiredPosition.y) > EPSILON
  ) {
    guides.push({ axis: 'xy', reason: 'Kept inside wall', type: 'containment' });
  }
  if (!placementIsClear(positionResult, size, blockers, clearance)) {
    if (mode === 'scale') {
      const resized = nearestClearSize(
        positionResult,
        size,
        wall,
        blockers,
        edgeInset,
        clearance,
      );
      if (resized) {
        size.x = resized.x;
        size.y = resized.y;
        guides.push({ axis: 'xy', reason: 'Stopped before nearby opening', type: 'collision' });
      }
    }
    if (!placementIsClear(positionResult, size, blockers, clearance)) {
      const moved = nearestClearPosition(
        positionResult,
        size,
        wall,
        blockers,
        edgeInset,
        clearance,
      );
      if (moved) {
        positionResult.x = moved.x;
        positionResult.y = moved.y;
        guides.push({ axis: 'xy', reason: 'Moved to nearest clear space', type: 'collision' });
      }
    }
  }
  if (joins.length > 0) {
    const memberCount = 1 + joins.reduce(
      (total, sibling) => total + Math.max(1, sibling.memberIds?.length ?? 1),
      0,
    );
    guides.push({
      axis: 'x',
      reason: `Will join ${memberCount} ${kind}${memberCount === 1 ? '' : 's'}`,
      type: 'join',
    });
  }
  return Object.freeze({
    position: Object.freeze(positionResult),
    size: Object.freeze(size),
    joins: Object.freeze(joins),
    guides: Object.freeze(guides),
    valid: placementIsClear(positionResult, size, blockers, clearance),
  });
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

export function validateWorkshopOpeningPlacement({
  position,
  size: rawSize,
  wallBounds: rawWallBounds,
  siblings = [],
  edgeInset = DEFAULT_EDGE_INSET,
  clearance = 0.08,
}) {
  const wall = normalizedBounds(rawWallBounds);
  const size = normalizedSize(rawSize);
  if (!wall) return Object.freeze({ valid: false, reasons: Object.freeze(['No compatible wall surface']) });
  const halfX = size.x / 2;
  const halfY = size.y / 2;
  const reasons = [];
  if (
    position.x - halfX < wall.minX + edgeInset - EPSILON
    || position.x + halfX > wall.maxX - edgeInset + EPSILON
    || position.y - halfY < wall.minY + edgeInset - EPSILON
    || position.y + halfY > wall.maxY - edgeInset + EPSILON
  ) {
    reasons.push('Opening crosses a wall edge');
  }
  for (const sibling of siblings) {
    const rect = openingRect(sibling);
    const overlapsX = position.x + halfX + clearance > rect.left
      && position.x - halfX - clearance < rect.right;
    const overlapsY = position.y + halfY + clearance > rect.bottom
      && position.y - halfY - clearance < rect.top;
    if (overlapsX && overlapsY) {
      reasons.push(`Too close to ${rect.label}`);
    }
  }
  return Object.freeze({
    valid: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}
