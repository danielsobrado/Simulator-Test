function normalizeId(id) {
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

export class ObjectSelectionModel {
  constructor() {
    this.ids = new Set();
    this.primaryId = null;
  }

  get size() {
    return this.ids.size;
  }

  [Symbol.iterator]() {
    return this.ids.values();
  }

  has(id) {
    const numeric = normalizeId(id);
    return numeric !== null && this.ids.has(numeric);
  }

  values(limit = Infinity) {
    const maximum = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Infinity;
    const values = [];
    for (const id of this.ids) {
      if (values.length >= maximum) break;
      values.push(id);
    }
    return values;
  }

  clear() {
    const changed = this.ids.size > 0 || this.primaryId !== null;
    this.ids.clear();
    this.primaryId = null;
    return changed;
  }

  replace(id) {
    const numeric = normalizeId(id);
    if (numeric === null) return this.clear();
    const unchanged = this.ids.size === 1 && this.ids.has(numeric) && this.primaryId === numeric;
    this.ids.clear();
    this.ids.add(numeric);
    this.primaryId = numeric;
    return !unchanged;
  }

  add(id) {
    const numeric = normalizeId(id);
    if (numeric === null) return false;
    const changed = !this.ids.has(numeric) || this.primaryId !== numeric;
    this.ids.add(numeric);
    this.primaryId = numeric;
    return changed;
  }

  toggle(id) {
    const numeric = normalizeId(id);
    if (numeric === null) return false;
    if (this.ids.has(numeric)) {
      this.ids.delete(numeric);
      if (this.primaryId === numeric) this.primaryId = this.ids.values().next().value ?? null;
      return true;
    }
    this.ids.add(numeric);
    this.primaryId = numeric;
    return true;
  }

  retain(validIds) {
    const valid = new Set([...validIds].map(normalizeId).filter((id) => id !== null));
    let changed = false;
    for (const id of this.ids) {
      if (valid.has(id)) continue;
      this.ids.delete(id);
      changed = true;
    }
    if (this.primaryId !== null && !this.ids.has(this.primaryId)) {
      this.primaryId = this.ids.values().next().value ?? null;
      changed = true;
    }
    return changed;
  }

  setPrimary(id) {
    const numeric = normalizeId(id);
    if (numeric === null || !this.ids.has(numeric) || this.primaryId === numeric) return false;
    this.primaryId = numeric;
    return true;
  }
}
