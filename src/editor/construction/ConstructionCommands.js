import { moveCubicBezierAnchor } from './curve/CubicBezierPath.js';

function adjacentSegments(path, anchorId) {
  return path.segments
    .filter(({ startAnchorId, endAnchorId }) => (
      startAnchorId === anchorId || endAnchorId === anchorId
    ))
    .map(({ id }) => id);
}

export function executeConstructionCommand(store, command) {
  if (!command || typeof command !== 'object') throw new Error('Construction command is invalid.');
  if (command.type === 'create') {
    const after = store.add(command.record);
    return Object.freeze({ kind: 'construction', before: null, after, dirtySegmentIds: [] });
  }
  if (command.type === 'delete') {
    const before = store.remove(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    return Object.freeze({ kind: 'construction', before, after: null, dirtySegmentIds: [] });
  }
  if (command.type === 'move_anchor') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const dirtySegmentIds = adjacentSegments(before.path, command.anchorId);
    const after = store.update(before.id, {
      ...before,
      path: moveCubicBezierAnchor(before.path, command.anchorId, command.position),
    });
    return Object.freeze({
      kind: 'construction',
      before,
      after,
      dirtySegmentIds: Object.freeze(dirtySegmentIds),
    });
  }
  if (command.type === 'replace') {
    const before = store.get(command.constructionId);
    if (!before) throw new Error(`Unknown construction ${command.constructionId}.`);
    const after = store.update(before.id, command.record);
    return Object.freeze({
      kind: 'construction',
      before,
      after,
      dirtySegmentIds: Object.freeze(command.dirtySegmentIds ?? []),
    });
  }
  throw new Error(`Unsupported construction command ${command.type}.`);
}

