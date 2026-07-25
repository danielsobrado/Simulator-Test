import { bumpEntity, createEntityEnvelope } from '../model/entityEnvelope.js';
import {
  getEntity,
  putEntity,
  requireEntity,
  upsertEntity,
} from '../model/worldState.js';

const reducers = new Map();

export function registerReducer(type, fn) {
  if (reducers.has(type)) {
    throw new Error(`duplicate_reducer:${type}`);
  }
  reducers.set(type, fn);
}

export function getReducer(type) {
  return reducers.get(type) ?? null;
}

export function applyEvent(state, event) {
  const reducer = reducers.get(event.type);
  if (!reducer) {
    throw Object.assign(new Error(`unknown_event_type:${event.type}`), { code: 'unknown_event_type' });
  }
  reducer(state, event);
  state.diagnostics.eventsApplied += 1;
  state.revision += 1;
}

registerReducer('entity.upserted', (state, event) => {
  const { kind, id, data, status = 'active', tags = [] } = event.payload;
  const existing = getEntity(state, kind, id);
  if (existing) {
    // Idempotent rematerialization: replace data rather than failing on duplicates.
    upsertEntity(state, bumpEntity(existing, event.tick, data, status));
    return;
  }
  putEntity(state, createEntityEnvelope({
    id,
    kind,
    createdAtTick: event.tick,
    updatedAtTick: event.tick,
    status,
    tags,
    data,
  }));
});

registerReducer('entity.destroyed', (state, event) => {
  const { kind, id } = event.payload;
  const entity = requireEntity(state, kind, id);
  upsertEntity(state, bumpEntity(entity, event.tick, null, 'destroyed'));
});

registerReducer('calendar.set', (state, event) => {
  state.calendar = { ...state.calendar, ...event.payload };
});

registerReducer('entity.patched', (state, event) => {
  const { kind, id, dataPatch = {}, status = null } = event.payload;
  const entity = requireEntity(state, kind, id);
  upsertEntity(state, bumpEntity(entity, event.tick, dataPatch, status));
});

export function listRegisteredReducerTypes() {
  return [...reducers.keys()].sort();
}
