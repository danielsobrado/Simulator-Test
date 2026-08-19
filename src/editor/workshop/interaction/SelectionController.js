import { WORKSHOP_ENTITY_ID_PATTERN } from '../kernel/WorkshopKernelConstants.js';

function requireEntityId(value) {
  if (typeof value !== 'string' || !WORKSHOP_ENTITY_ID_PATTERN.test(value)) {
    throw new Error('Workshop selection contains an invalid entity id.');
  }
  return value;
}

export class SelectionController {
  #selected = Object.freeze([]);
  #primaryId = null;
  #listeners = new Set();

  get selectedIds() {
    return this.#selected;
  }

  get primaryId() {
    return this.#primaryId;
  }

  has(id) {
    return this.#selected.includes(id);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('Selection listener must be a function.');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish() {
    const snapshot = Object.freeze({ selectedIds: this.#selected, primaryId: this.#primaryId });
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  set(ids, { primaryId = null } = {}) {
    if (!Array.isArray(ids)) throw new Error('Workshop selection ids must be an array.');
    const selected = [...new Set(ids.map(requireEntityId))].sort();
    const primary = primaryId === null
      ? selected[0] ?? null
      : requireEntityId(primaryId);
    if (primary && !selected.includes(primary)) {
      throw new Error('Primary workshop selection must be selected.');
    }
    this.#selected = Object.freeze(selected);
    this.#primaryId = primary;
    return this.#publish();
  }

  select(id) {
    const entityId = requireEntityId(id);
    return this.set([entityId], { primaryId: entityId });
  }

  toggle(id) {
    const entityId = requireEntityId(id);
    const next = this.has(entityId)
      ? this.#selected.filter((selectedId) => selectedId !== entityId)
      : [...this.#selected, entityId];
    const primaryId = this.#primaryId === entityId ? next[0] ?? null : this.#primaryId ?? entityId;
    return this.set(next, { primaryId });
  }

  clear() {
    return this.set([]);
  }
}
