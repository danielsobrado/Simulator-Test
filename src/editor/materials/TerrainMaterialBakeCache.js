function defaultDisposeValue(value) {
  value?.dispose?.();
}

function assertBuildResult(result) {
  if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'value')) {
    throw new Error('Terrain material bake builder must return { value, byteLength }.');
  }
  if (!Number.isSafeInteger(result.byteLength) || result.byteLength <= 0) {
    throw new Error('Terrain material bake byteLength must be a positive safe integer.');
  }
  return result;
}

function createLease(cache, entry, stale) {
  let released = false;
  return Object.freeze({
    value: entry.value,
    descriptor: entry.descriptor,
    stale,
    release() {
      if (released) return;
      released = true;
      cache.release(entry);
    },
  });
}

export class TerrainMaterialBakeCache {
  constructor({ config, disposeValue = defaultDisposeValue, onError = null } = {}) {
    if (!config?.cache || !config?.fallback) {
      throw new Error('Terrain material bake cache requires validated material bake configuration.');
    }
    if (typeof disposeValue !== 'function') {
      throw new Error('Terrain material bake cache disposer must be a function.');
    }
    if (onError !== null && typeof onError !== 'function') {
      throw new Error('Terrain material bake cache error reporter must be a function.');
    }

    this.config = config;
    this.disposeValue = disposeValue;
    this.onError = onError;
    this.entries = new Map();
    this.currentBySlot = new Map();
    this.desiredBySlot = new Map();
    this.inFlight = new Map();
    this.residentBytes = 0;
    this.disposed = false;
    this.counters = {
      hits: 0,
      misses: 0,
      staleHits: 0,
      staleFallbacks: 0,
      inFlightHits: 0,
      buildsStarted: 0,
      buildsCompleted: 0,
      buildFailures: 0,
      evictions: 0,
      disposals: 0,
      disposalFailures: 0,
      peakEntries: 0,
      peakResidentBytes: 0,
      peakInFlight: 0,
    };
  }

  assertOpen() {
    if (this.disposed) {
      throw new Error('Cannot acquire a terrain material bake after cache disposal.');
    }
  }

  reportError(error, context) {
    try {
      this.onError?.(error, context);
    } catch {
      // Error reporting must never break cache lifecycle guarantees.
    }
  }

  currentEntry(slotKey) {
    const key = this.currentBySlot.get(slotKey);
    if (!key) return null;
    const entry = this.entries.get(key) ?? null;
    if (!entry) this.currentBySlot.delete(slotKey);
    return entry;
  }

  promote(entry) {
    const previousKey = this.currentBySlot.get(entry.slotKey);
    if (previousKey && previousKey !== entry.key) {
      const previous = this.entries.get(previousKey);
      if (previous) previous.retired = true;
    }
    entry.retired = false;
    this.currentBySlot.set(entry.slotKey, entry.key);
  }

  touch(entry) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
  }

  lease(entry, stale) {
    if (this.entries.get(entry.key) !== entry || entry.resourceDisposed) {
      throw new Error(`Terrain material bake ${entry.key} is no longer resident.`);
    }
    entry.refs += 1;
    this.touch(entry);
    return createLease(this, entry, stale);
  }

  disposeResource(entry) {
    if (entry.resourceDisposed) return;
    entry.resourceDisposed = true;
    this.counters.disposals += 1;
    try {
      this.disposeValue(entry.value);
    } catch (error) {
      this.counters.disposalFailures += 1;
      this.reportError(error, { operation: 'dispose', descriptor: entry.descriptor ?? null });
    }
  }

  removeEntry(entry, evicted = false) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    this.residentBytes = Math.max(0, this.residentBytes - entry.byteLength);
    if (this.currentBySlot.get(entry.slotKey) === entry.key) {
      this.currentBySlot.delete(entry.slotKey);
    }
    if (evicted) this.counters.evictions += 1;
    this.disposeResource(entry);
  }

  hasActiveRetiredEntry(slotKey) {
    for (const entry of this.entries.values()) {
      if (entry.slotKey === slotKey && entry.retired && entry.refs > 0) return true;
    }
    return false;
  }

  findEvictionVictim() {
    for (const entry of this.entries.values()) {
      if (entry.refs === 0 && entry.retired) return entry;
    }
    for (const entry of this.entries.values()) {
      if (entry.refs > 0) continue;
      const isCurrent = this.currentBySlot.get(entry.slotKey) === entry.key;
      if (isCurrent && this.hasActiveRetiredEntry(entry.slotKey)) continue;
      return entry;
    }
    return null;
  }

  trim() {
    const { maxEntries, maxBytes } = this.config.cache;
    while (this.entries.size > maxEntries || this.residentBytes > maxBytes) {
      const victim = this.findEvictionVictim();
      if (!victim) return;
      this.removeEntry(victim, true);
    }
  }

  release(entry) {
    if (entry.refs <= 0) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    if (this.disposed) {
      this.removeEntry(entry);
      return;
    }
    this.trim();
  }

  transientEntry(value) {
    return {
      value,
      descriptor: null,
      resourceDisposed: false,
    };
  }

  install(descriptor, result) {
    let normalized;
    try {
      normalized = assertBuildResult(result);
    } catch (error) {
      if (result && typeof result === 'object' && Object.hasOwn(result, 'value')) {
        this.disposeResource(this.transientEntry(result.value));
      }
      throw error;
    }

    if (normalized.byteLength > this.config.cache.maxBytes) {
      this.disposeResource(this.transientEntry(normalized.value));
      throw new Error(
        `Terrain material bake ${descriptor.key} exceeds the cache byte budget.`,
      );
    }

    if (this.disposed) {
      this.disposeResource(this.transientEntry(normalized.value));
      throw new Error(`Terrain material bake ${descriptor.key} completed after cache disposal.`);
    }

    const existing = this.entries.get(descriptor.key);
    if (existing) {
      this.disposeResource(this.transientEntry(normalized.value));
      return existing;
    }

    const entry = {
      key: descriptor.key,
      slotKey: descriptor.slotKey,
      descriptor,
      value: normalized.value,
      byteLength: normalized.byteLength,
      refs: 0,
      retired: true,
      resourceDisposed: false,
    };
    this.entries.set(entry.key, entry);
    this.residentBytes += entry.byteLength;
    if (this.desiredBySlot.get(entry.slotKey) === entry.key) {
      this.promote(entry);
    }
    this.counters.buildsCompleted += 1;
    this.counters.peakEntries = Math.max(this.counters.peakEntries, this.entries.size);
    this.counters.peakResidentBytes = Math.max(
      this.counters.peakResidentBytes,
      this.residentBytes,
    );
    return entry;
  }

  cleanupDesiredSlot(slotKey) {
    for (const pending of this.inFlight.values()) {
      if (pending.slotKey === slotKey) return;
    }
    this.desiredBySlot.delete(slotKey);
  }

  ensureBuild(descriptor, build) {
    const resident = this.entries.get(descriptor.key);
    if (resident) return Promise.resolve(resident);

    const existing = this.inFlight.get(descriptor.key);
    if (existing) {
      this.counters.inFlightHits += 1;
      return existing.promise;
    }

    this.counters.buildsStarted += 1;
    const pending = {
      slotKey: descriptor.slotKey,
      promise: null,
    };
    pending.promise = Promise.resolve()
      .then(() => build(descriptor))
      .then((result) => this.install(descriptor, result))
      .catch((error) => {
        this.counters.buildFailures += 1;
        throw error;
      })
      .finally(() => {
        if (this.inFlight.get(descriptor.key) === pending) {
          this.inFlight.delete(descriptor.key);
          this.cleanupDesiredSlot(descriptor.slotKey);
        }
      });
    this.inFlight.set(descriptor.key, pending);
    this.counters.peakInFlight = Math.max(this.counters.peakInFlight, this.inFlight.size);
    return pending.promise;
  }

  startBackgroundRefresh(descriptor, build) {
    void this.ensureBuild(descriptor, build)
      .then(() => this.trim())
      .catch((error) => {
        this.reportError(error, { operation: 'backgroundRefresh', descriptor });
      });
  }

  async acquire(descriptor, build) {
    this.assertOpen();
    if (!descriptor?.key || !descriptor?.slotKey) {
      throw new Error('Terrain material bake cache requires a validated descriptor.');
    }
    if (typeof build !== 'function') {
      throw new Error('Terrain material bake cache requires a builder function.');
    }

    this.desiredBySlot.set(descriptor.slotKey, descriptor.key);

    const resident = this.entries.get(descriptor.key);
    if (resident) {
      this.promote(resident);
      this.counters.hits += 1;
      return this.lease(resident, false);
    }

    this.counters.misses += 1;
    const stale = this.currentEntry(descriptor.slotKey);
    const allowStale = Boolean(this.config.fallback.allowStale && stale);
    if (allowStale && this.config.cache.staleWhileRevalidate) {
      this.counters.staleHits += 1;
      this.startBackgroundRefresh(descriptor, build);
      return this.lease(stale, true);
    }

    const fallbackLease = allowStale ? this.lease(stale, true) : null;
    try {
      const entry = await this.ensureBuild(descriptor, build);
      this.assertOpen();
      this.promote(entry);
      const lease = this.lease(entry, false);
      fallbackLease?.release();
      this.trim();
      return lease;
    } catch (error) {
      if (fallbackLease && !this.disposed) {
        this.counters.staleFallbacks += 1;
        return fallbackLease;
      }
      fallbackLease?.release();
      throw error;
    }
  }

  async whenIdle() {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()].map((pending) => pending.promise));
    }
  }

  getStats() {
    let activeLeases = 0;
    for (const entry of this.entries.values()) activeLeases += entry.refs;
    return Object.freeze({
      ...this.counters,
      entries: this.entries.size,
      residentBytes: this.residentBytes,
      activeLeases,
      inFlight: this.inFlight.size,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.currentBySlot.clear();
    this.desiredBySlot.clear();
    for (const entry of [...this.entries.values()]) {
      if (entry.refs === 0) this.removeEntry(entry);
    }
  }
}
