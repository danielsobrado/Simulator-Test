import { normalizeConstructionRecord } from './ConstructionSchema.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function numericSuffix(id) {
  const match = /^construction-([1-9][0-9]*)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

export class ConstructionStore {
  constructor(records = []) {
    this.records = new Map();
    this.listeners = new Set();
    this.nextId = 1;
    this.replaceAll(records);
  }

  get size() {
    return this.records.size;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change) {
    for (const listener of this.listeners) listener(change);
  }

  nextConstructionId() {
    while (this.records.has(`construction-${this.nextId}`)) this.nextId += 1;
    const id = `construction-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  get(id) {
    return clone(this.records.get(String(id)) ?? null);
  }

  list() {
    return [...this.records.values()]
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
      .map(clone);
  }

  add(input) {
    const record = normalizeConstructionRecord(input);
    if (this.records.has(record.id)) throw new Error(`Construction ${record.id} already exists.`);
    this.records.set(record.id, record);
    this.nextId = Math.max(this.nextId, numericSuffix(record.id) + 1);
    const snapshot = clone(record);
    this.emit({ kind: 'add', id: record.id, before: null, after: snapshot });
    return snapshot;
  }

  update(id, input) {
    const key = String(id);
    const current = this.records.get(key);
    if (!current) throw new Error(`Unknown construction ${key}.`);
    const candidate = typeof input === 'function' ? input(clone(current)) : input;
    const record = normalizeConstructionRecord({
      ...candidate,
      id: key,
      revision: current.revision + 1,
    });
    this.records.set(key, record);
    const before = clone(current);
    const after = clone(record);
    this.emit({ kind: 'update', id: key, before, after });
    return after;
  }

  remove(id) {
    const key = String(id);
    const current = this.records.get(key);
    if (!current) return null;
    this.records.delete(key);
    const snapshot = clone(current);
    this.emit({ kind: 'remove', id: key, before: snapshot, after: null });
    return snapshot;
  }

  restore(input) {
    const record = normalizeConstructionRecord(input);
    if (this.records.has(record.id)) throw new Error(`Construction ${record.id} already exists.`);
    this.records.set(record.id, record);
    this.nextId = Math.max(this.nextId, numericSuffix(record.id) + 1);
    const snapshot = clone(record);
    this.emit({ kind: 'restore', id: record.id, before: null, after: snapshot });
    return snapshot;
  }

  applyChange(change, direction) {
    const source = direction === 'undo' ? change.after : change.before;
    const target = direction === 'undo' ? change.before : change.after;
    if (source) this.records.delete(source.id);
    if (target) this.records.set(target.id, normalizeConstructionRecord(target));
    this.nextId = Math.max(
      1,
      ...[...this.records.keys()].map((id) => numericSuffix(id) + 1),
    );
    this.emit({ kind: 'history', id: target?.id ?? source?.id, before: source, after: target });
  }

  clear() {
    const previous = this.list();
    this.records.clear();
    this.nextId = 1;
    if (previous.length > 0) this.emit({ kind: 'clear', before: previous, after: [] });
    return previous;
  }

  replaceAll(records) {
    if (!Array.isArray(records)) throw new Error('Construction payload must be an array.');
    const normalized = records.map(normalizeConstructionRecord);
    const next = new Map();
    for (const record of normalized) {
      if (next.has(record.id)) throw new Error(`Construction payload duplicates ${record.id}.`);
      next.set(record.id, record);
    }
    this.records = next;
    this.nextId = Math.max(1, ...normalized.map(({ id }) => numericSuffix(id) + 1));
    this.emit({ kind: 'replace', before: null, after: this.list() });
  }

  toDocument() {
    return this.list();
  }

  loadDocument(records) {
    this.replaceAll(records ?? []);
  }
}

