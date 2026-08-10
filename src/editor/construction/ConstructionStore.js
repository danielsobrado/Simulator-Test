import { ensureCollisionP7QaFixture } from '../collision/CollisionP7QaFixture.js';
import { ensureConstructionPerfQaFixture } from './ConstructionPerfQaFixture.js';
import { constructionCollisionSource } from '../collision/providers/ConstructionCollisionSource.js';
import { normalizeConstructionRecord } from './ConstructionSchema.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function numericSuffix(id) {
  const match = /^construction-([1-9][0-9]*)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function browserSearch() {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function withRuntimeRevision(record, watermark) {
  if (record.revision > watermark) return record;
  return normalizeConstructionRecord({ ...record, revision: watermark + 1 });
}

export class ConstructionStore {
  constructor(records = []) {
    this.records = new Map();
    this.listeners = new Set();
    this.revisionWatermarks = new Map();
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

  normalizeForRuntime(input) {
    const normalized = normalizeConstructionRecord(input);
    const record = withRuntimeRevision(
      normalized,
      this.revisionWatermarks.get(normalized.id) ?? 0,
    );
    this.revisionWatermarks.set(record.id, record.revision);
    return record;
  }

  add(input) {
    const normalized = normalizeConstructionRecord(input);
    if (this.records.has(normalized.id)) {
      throw new Error(`Construction ${normalized.id} already exists.`);
    }
    const record = this.normalizeForRuntime(normalized);
    this.records.set(record.id, record);
    constructionCollisionSource.setActive(record);
    this.nextId = Math.max(this.nextId, numericSuffix(record.id) + 1);
    const snapshot = clone(record);
    this.emit({ kind: 'add', id: record.id, before: null, after: snapshot });
    return snapshot;
  }

  /**
   * `hint` rides along on the emitted change so the renderer can narrow its
   * rebuild. It is advisory only — the store never interprets it, and a view
   * that ignores it stays correct, just slower.
   */
  update(id, input, hint = null) {
    const key = String(id);
    const current = this.records.get(key);
    if (!current) throw new Error(`Unknown construction ${key}.`);
    const candidate = typeof input === 'function' ? input(clone(current)) : input;
    const record = this.normalizeForRuntime({
      ...candidate,
      id: key,
      revision: current.revision + 1,
    });
    this.records.set(key, record);
    constructionCollisionSource.setActive(record);
    const before = clone(current);
    const after = clone(record);
    this.emit({ kind: 'update', id: key, before, after, hint });
    return after;
  }

  remove(id) {
    const key = String(id);
    const current = this.records.get(key);
    if (!current) return null;
    this.records.delete(key);
    constructionCollisionSource.remove(key);
    const snapshot = clone(current);
    this.emit({ kind: 'remove', id: key, before: snapshot, after: null });
    return snapshot;
  }

  restore(input) {
    const normalized = normalizeConstructionRecord(input);
    if (this.records.has(normalized.id)) {
      throw new Error(`Construction ${normalized.id} already exists.`);
    }
    const record = this.normalizeForRuntime(normalized);
    this.records.set(record.id, record);
    constructionCollisionSource.setActive(record);
    this.nextId = Math.max(this.nextId, numericSuffix(record.id) + 1);
    const snapshot = clone(record);
    this.emit({ kind: 'restore', id: record.id, before: null, after: snapshot });
    return snapshot;
  }

  applyChange(change, direction) {
    const source = direction === 'undo' ? change.after : change.before;
    const target = direction === 'undo' ? change.before : change.after;
    if (source) this.records.delete(source.id);
    let runtimeTarget = null;
    if (target) {
      runtimeTarget = this.normalizeForRuntime(target);
      this.records.set(runtimeTarget.id, runtimeTarget);
      constructionCollisionSource.setActive(runtimeTarget);
    } else if (source) {
      constructionCollisionSource.remove(source.id);
    }
    this.nextId = Math.max(
      1,
      ...[...this.records.keys()].map((id) => numericSuffix(id) + 1),
    );
    // Forward the command hint so undo of a palette paint stays material-only
    // and does not re-pack every stone on a long wall.
    const hint = change.materialOnly
      ? { dirtySegmentIds: [...(change.dirtySegmentIds ?? [])], materialOnly: true }
      : Array.isArray(change.dirtySegmentIds)
        ? { dirtySegmentIds: [...change.dirtySegmentIds] }
        : undefined;
    this.emit({
      kind: 'history',
      id: runtimeTarget?.id ?? source?.id,
      before: source,
      after: runtimeTarget ? clone(runtimeTarget) : null,
      hint,
    });
  }

  clear() {
    const previous = this.list();
    this.records.clear();
    constructionCollisionSource.clear();
    this.nextId = 1;
    if (previous.length > 0) this.emit({ kind: 'clear', before: previous, after: [] });
    return previous;
  }

  replaceAll(records) {
    if (!Array.isArray(records)) throw new Error('Construction payload must be an array.');
    const normalized = records.map(normalizeConstructionRecord);
    const seen = new Set();
    for (const record of normalized) {
      if (seen.has(record.id)) throw new Error(`Construction payload duplicates ${record.id}.`);
      seen.add(record.id);
    }

    const nextWatermarks = new Map(this.revisionWatermarks);
    const runtimeRecords = normalized.map((record) => {
      const runtimeRecord = withRuntimeRevision(record, nextWatermarks.get(record.id) ?? 0);
      nextWatermarks.set(runtimeRecord.id, runtimeRecord.revision);
      return runtimeRecord;
    });
    const next = new Map(runtimeRecords.map((record) => [record.id, record]));

    this.records = next;
    this.revisionWatermarks = nextWatermarks;
    constructionCollisionSource.replaceActive(runtimeRecords);
    this.nextId = Math.max(1, ...runtimeRecords.map(({ id }) => numericSuffix(id) + 1));
    this.emit({ kind: 'replace', before: null, after: this.list() });
    ensureCollisionP7QaFixture(this, browserSearch());
    ensureConstructionPerfQaFixture(this, browserSearch());
  }

  toDocument() {
    return this.list();
  }

  loadDocument(records) {
    this.replaceAll(records ?? []);
  }
}
