import { diffWorkshopDocuments } from '../kernel/WorkshopPatch.js';
import { DEFAULT_WORKSHOP_HISTORY_ENTRIES } from '../interaction/WorkshopInteractionConstants.js';

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  return value;
}

function historyEntry(before, event) {
  const label = event.inverse?.label ?? '';
  const forward = diffWorkshopDocuments(before, event.document, label);
  if (forward.isEmpty) return null;
  return Object.freeze({
    label,
    forward,
    inverse: event.inverse,
  });
}

export class WorkshopHistory {
  #bus;
  #past = [];
  #future = [];
  #lastDocument;
  #unsubscribe;

  constructor(bus, { maxEntries = DEFAULT_WORKSHOP_HISTORY_ENTRIES } = {}) {
    if (!bus || typeof bus.subscribe !== 'function' || typeof bus.applyPatch !== 'function') {
      throw new Error('Workshop history requires a workshop command bus.');
    }
    this.#bus = bus;
    this.maxEntries = requirePositiveInteger(maxEntries, 'Workshop history max entries');
    this.#lastDocument = bus.document;
    this.#unsubscribe = bus.subscribe((event) => this.#recordEvent(event));
  }

  get canUndo() {
    return this.#past.length > 0;
  }

  get canRedo() {
    return this.#future.length > 0;
  }

  get undoDepth() {
    return this.#past.length;
  }

  get redoDepth() {
    return this.#future.length;
  }

  #recordEvent(event) {
    const before = this.#lastDocument;
    this.#lastDocument = event.document;
    if (event.metadata?.historyAction) return;
    const entry = historyEntry(before, event);
    if (!entry) return;
    this.#past.push(entry);
    if (this.#past.length > this.maxEntries) this.#past.shift();
    this.#future = [];
  }

  undo() {
    const entry = this.#past.pop();
    if (!entry) return null;
    try {
      const result = this.#bus.applyPatch(entry.inverse, { historyAction: 'undo' });
      this.#future.push(entry);
      return result;
    } catch (error) {
      this.#past.push(entry);
      throw error;
    }
  }

  redo() {
    const entry = this.#future.pop();
    if (!entry) return null;
    try {
      const result = this.#bus.applyPatch(entry.forward, { historyAction: 'redo' });
      this.#past.push(entry);
      return result;
    } catch (error) {
      this.#future.push(entry);
      throw error;
    }
  }

  clear() {
    this.#past = [];
    this.#future = [];
    this.#lastDocument = this.#bus.document;
  }

  dispose() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
