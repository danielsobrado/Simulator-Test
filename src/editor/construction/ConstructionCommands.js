import { moveCubicBezierAnchor } from './curve/CubicBezierPath.js';

/**
 * Segments whose geometry an anchor move can change.
 *
 * Moving anchor `i` obviously changes segments `i-1` and `i`. It also changes
 * `i-2` and `i+1`, because the Catmull-Rom handle solve derives a segment's
 * handles from the anchors on either side of it — so the neighbours' curvature
 * moves too. Under-reporting here shows up as stale geometry next to an edit.
 */
function dirtySegmentsForAnchor(path, anchorId) {
  const anchorIndex = path.anchors.findIndex(({ id }) => id === anchorId);
  if (anchorIndex < 0) return [];
  const count = path.segments.length;
  const ids = new Set();
  for (let offset = -2; offset <= 1; offset += 1) {
    const index = anchorIndex + offset;
    const wrapped = path.closed ? ((index % count) + count) % count : index;
    if (wrapped >= 0 && wrapped < count) ids.add(path.segments[wrapped].id);
  }
  return [...ids];
}

/**
 * An empty `dirtySegmentIds` means "every module"; `materialOnly` means the
 * geometry is unchanged and the view need only swap materials.
 */
function change(before, after, { dirtySegmentIds = [], materialOnly = false } = {}) {
  return Object.freeze({
    kind: 'construction',
    before,
    after,
    dirtySegmentIds: Object.freeze([...dirtySegmentIds]),
    materialOnly,
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
    const dirtySegmentIds = dirtySegmentsForAnchor(before.path, command.anchorId);
    const after = store.update(before.id, {
      ...before,
      path: moveCubicBezierAnchor(before.path, command.anchorId, command.position),
    }, { dirtySegmentIds });
    return change(before, after, { dirtySegmentIds });
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

