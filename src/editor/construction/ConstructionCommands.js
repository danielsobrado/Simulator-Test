import {
  closeCubicBezierPath,
  cubicBezierDirtySegments,
  deleteCubicBezierAnchor,
  insertCubicBezierAnchor,
  moveCubicBezierAnchor,
  openCubicBezierPath,
  setCubicBezierHandle,
} from './curve/CubicBezierPath.js';
import { flattenHandlesAround } from './curve/CurveSnapping.js';

/** Segments adjacent to a segment, which a handle move reaches through. */
function neighbouringSegments(path, segmentId) {
  const index = path.segments.findIndex(({ id }) => id === segmentId);
  if (index < 0) return [];
  const count = path.segments.length;
  const ids = new Set();
  for (let offset = -1; offset <= 1; offset += 1) {
    const position = index + offset;
    const wrapped = path.closed ? ((position % count) + count) % count : position;
    if (wrapped >= 0 && wrapped < count) ids.add(path.segments[wrapped].id);
  }
  return [...ids];
}

/** Every segment: for edits whose reach is the whole path. */
function allSegments(path) {
  return path.segments.map(({ id }) => id);
}

/**
 * Drop top-profile points and features whose host segment no longer exists.
 *
 * Deleting an anchor or closing a loop removes segment ids. Both `top.profile`
 * and `features` are anchored per segment — that is what stops them sliding
 * when an unrelated anchor moves — so an orphaned reference would make
 * `normalizeConstructionRecord` throw and the edit would fail rather than
 * degrade. Dropping is the honest outcome: the stretch of wall those points
 * described is genuinely gone.
 */
function reconcileToPath(record, path) {
  const live = new Set(path.segments.map(({ id }) => id));
  const profile = record.top.profile.filter(({ segmentId }) => live.has(segmentId));
  const features = record.features.filter(({ segmentId }) => live.has(segmentId));
  return {
    ...record,
    path: { ...path, features },
    features,
    top: { ...record.top, profile },
    dropped: (record.top.profile.length - profile.length)
      + (record.features.length - features.length),
  };
}

/**
 * An empty `dirtySegmentIds` means "every module"; `materialOnly` means the
 * geometry is unchanged and the view need only swap materials.
 */
function change(before, after, { dirtySegmentIds = [], materialOnly = false, dropped = 0 } = {}) {
  return Object.freeze({
    kind: 'construction',
    before,
    after,
    dirtySegmentIds: Object.freeze([...dirtySegmentIds]),
    materialOnly,
    /** Top points and features discarded because their segment went away. */
    dropped,
  });
}

export function executeConstructionCommand(store, command) {
  if (!command || typeof command !== 'object') throw new Error('Construction command is invalid.');
  if (command.type === 'create') {
    return change(null, store.add(command.record));
  }
  if (command.type === 'delete') {
    const before = store.remove(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    return change(before, null);
  }
  if (command.type === 'move_anchor') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const dirtySegmentIds = cubicBezierDirtySegments(before.path, command.anchorId);
    let path = moveCubicBezierAnchor(before.path, command.anchorId, command.position, {
      resolveHandles: command.resolveHandles ?? 'catmull-rom',
    });
    // A `straight` snap positions the anchor on the line through its
    // neighbours; the span only actually goes straight once the adjacent
    // handles lose their perpendicular component too.
    if (command.flattenHandles) path = flattenHandlesAround(path, command.anchorId);
    const after = store.update(before.id, { ...before, path }, { dirtySegmentIds });
    return change(before, after, { dirtySegmentIds });
  }
  if (command.type === 'insert_anchor') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const dirtySegmentIds = neighbouringSegments(before.path, command.segmentId);
    const path = insertCubicBezierAnchor(before.path, command.segmentId, command.t);
    const after = store.update(before.id, { ...before, path }, { dirtySegmentIds });
    return change(before, after, { dirtySegmentIds });
  }
  if (command.type === 'delete_anchor') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const path = deleteCubicBezierAnchor(before.path, command.anchorId);
    const { dropped, ...next } = reconcileToPath(before, path);
    // Segments are relinked, so scope the rebuild to everything.
    const after = store.update(before.id, next, {});
    return change(before, after, { dirtySegmentIds: allSegments(path), dropped });
  }
  if (command.type === 'move_handle') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const dirtySegmentIds = neighbouringSegments(before.path, command.segmentId);
    const path = setCubicBezierHandle(
      before.path,
      command.segmentId,
      command.which,
      command.offset,
      { mode: command.mode ?? 'smooth' },
    );
    const after = store.update(before.id, { ...before, path }, { dirtySegmentIds });
    return change(before, after, { dirtySegmentIds });
  }
  if (command.type === 'close_path' || command.type === 'open_path') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const path = command.type === 'close_path'
      ? closeCubicBezierPath(before.path, { dropAnchorId: command.dropAnchorId ?? null })
      : openCubicBezierPath(before.path, { atSegmentId: command.segmentId ?? null });
    const { dropped, ...next } = reconcileToPath(before, path);
    const after = store.update(before.id, next, {});
    return change(before, after, { dirtySegmentIds: allSegments(path), dropped });
  }
  if (
    command.type === 'add_feature'
    || command.type === 'move_feature'
    || command.type === 'resize_feature'
    || command.type === 'delete_feature'
  ) {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const existing = before.features.find(({ id }) => id === command.featureId) ?? null;
    let features;
    if (command.type === 'add_feature') {
      features = [...before.features, command.feature];
    } else if (command.type === 'delete_feature') {
      if (!existing) throw new Error(`Unknown feature ${command.featureId}.`);
      features = before.features.filter(({ id }) => id !== command.featureId);
    } else {
      if (!existing) throw new Error(`Unknown feature ${command.featureId}.`);
      features = before.features.map((feature) => (
        feature.id === command.featureId ? { ...feature, ...command.changes } : feature
      ));
    }
    // A feature can move between segments, so both host segments are dirty.
    const segments = new Set();
    if (existing) segments.add(existing.segmentId);
    if (command.feature?.segmentId) segments.add(command.feature.segmentId);
    if (command.changes?.segmentId) segments.add(command.changes.segmentId);
    const hint = { dirtySegmentIds: [...segments] };
    const after = store.update(before.id, {
      ...before,
      features,
      path: { ...before.path, features },
    }, hint);
    return change(before, after, hint);
  }
  if (command.type === 'set_material') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const hint = { dirtySegmentIds: [], materialOnly: true };
    const after = store.update(before.id, {
      ...before,
      style: {
        ...before.style,
        materials: { ...before.style.materials, ...command.materials },
      },
    }, hint);
    // Geometry is untouched — the renderer only swaps the material, so painting
    // a 200 m wall must not re-pack a single stone.
    return change(before, after, hint);
  }
  if (command.type === 'set_style' || command.type === 'set_dimensions') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    let next;
    if (command.type === 'set_style') {
      next = { ...before, style: { ...before.style, key: command.styleKey } };
    } else {
      const dimensions = { ...before.dimensions, ...command.dimensions };
      // `top.base` defaults to the wall height and is authoritative once set,
      // so changing the height would otherwise leave the top where it was.
      // Carry it along only while the user has not authored a top of their
      // own — an explicit base or any profile point means they have.
      const tracksHeight = before.top.profile.length === 0
        && Math.abs(before.top.base - before.dimensions.height) < 1e-9;
      next = {
        ...before,
        dimensions,
        top: tracksHeight ? { ...before.top, base: dimensions.height } : before.top,
      };
    }
    // Course height and stone width both come from the style, and thickness
    // changes every stone's depth, so the whole wall is dirty either way.
    const after = store.update(before.id, next, {});
    return change(before, after, { dirtySegmentIds: allSegments(after.path) });
  }
  if (command.type === 'set_top_profile') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    // A control point that moved off a segment dirties both the segment it left
    // and the one it landed on, so the dirty set is the union across the edit.
    const segments = new Set();
    for (const point of before.top.profile) segments.add(point.segmentId);
    for (const point of command.top.profile ?? []) segments.add(point.segmentId);
    const hint = { dirtySegmentIds: [...segments] };
    const after = store.update(before.id, { ...before, top: command.top }, hint);
    return change(before, after, hint);
  }
  if (command.type === 'replace') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const hint = {
      dirtySegmentIds: command.dirtySegmentIds ?? [],
      materialOnly: command.materialOnly === true,
    };
    const after = store.update(before.id, command.record, hint);
    return change(before, after, hint);
  }
  throw new Error(`Unsupported construction command ${command.type}.`);
}

