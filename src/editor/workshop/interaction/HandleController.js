import { WORKSHOP_ENTITY_ID_PATTERN } from '../kernel/WorkshopKernelConstants.js';
import { cloneWorkshopProperties } from '../kernel/WorkshopEntity.js';
import { WORKSHOP_HANDLE_AXES, WORKSHOP_HANDLE_ID_PATTERN } from './WorkshopInteractionConstants.js';

const AXES = new Set(WORKSHOP_HANDLE_AXES);

function normalizeHandle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workshop handle must be an object.');
  }
  if (typeof input.id !== 'string' || !WORKSHOP_HANDLE_ID_PATTERN.test(input.id)) {
    throw new Error('Workshop handle id is invalid.');
  }
  if (typeof input.entityId !== 'string' || !WORKSHOP_ENTITY_ID_PATTERN.test(input.entityId)) {
    throw new Error('Workshop handle entity id is invalid.');
  }
  if (typeof input.kind !== 'string' || input.kind.length === 0 || input.kind.length > 64) {
    throw new Error('Workshop handle kind is invalid.');
  }
  const axes = input.axes ?? [];
  if (!Array.isArray(axes) || axes.some((axis) => !AXES.has(axis))) {
    throw new Error('Workshop handle axes must contain x, y, or z.');
  }
  return Object.freeze({
    id: input.id,
    entityId: input.entityId,
    kind: input.kind,
    axes: Object.freeze([...new Set(axes)].sort()),
    properties: cloneWorkshopProperties(input.properties ?? {}, `Workshop handle ${input.id} properties`),
  });
}

export class HandleController {
  #handles = new Map();
  #hoveredId = null;
  #activeId = null;
  #listeners = new Set();

  get hoveredId() {
    return this.#hoveredId;
  }

  get activeId() {
    return this.#activeId;
  }

  list() {
    return Object.freeze([...this.#handles.values()].sort((left, right) => left.id.localeCompare(right.id)));
  }

  get(id) {
    return this.#handles.get(id) ?? null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('Handle listener must be a function.');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish() {
    const snapshot = Object.freeze({
      handles: this.list(),
      hoveredId: this.#hoveredId,
      activeId: this.#activeId,
    });
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  replace(handles) {
    if (!Array.isArray(handles)) throw new Error('Workshop handles must be an array.');
    const next = new Map();
    for (const source of handles) {
      const handle = normalizeHandle(source);
      if (next.has(handle.id)) throw new Error(`Duplicate workshop handle: ${handle.id}.`);
      next.set(handle.id, handle);
    }
    this.#handles = next;
    if (!next.has(this.#hoveredId)) this.#hoveredId = null;
    if (!next.has(this.#activeId)) this.#activeId = null;
    return this.#publish();
  }

  setHovered(id) {
    if (id !== null && !this.#handles.has(id)) throw new Error(`Unknown workshop handle: ${id}.`);
    this.#hoveredId = id;
    return this.#publish();
  }

  setActive(id) {
    if (id !== null && !this.#handles.has(id)) throw new Error(`Unknown workshop handle: ${id}.`);
    this.#activeId = id;
    return this.#publish();
  }

  clear() {
    this.#handles = new Map();
    this.#hoveredId = null;
    this.#activeId = null;
    return this.#publish();
  }
}
