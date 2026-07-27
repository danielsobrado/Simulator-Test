import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { collisionChunkKey, parseCollisionChunkKey } from '../CollisionIds.js';

function sampleFromCollider(collider) {
  if (!collider) return null;
  return Object.freeze({
    sourceId: collider.sourceId,
    prototypeId: collider.prototypeId,
    x: collider.position?.[0] ?? (collider.aabb.minX + collider.aabb.maxX) * 0.5,
    y: collider.position?.[1] ?? collider.aabb.minY,
    z: collider.position?.[2] ?? (collider.aabb.minZ + collider.aabb.maxZ) * 0.5,
    radius: collider.dimensions?.[0] ?? 0,
    height: collider.dimensions?.[1] ?? collider.aabb.maxY - collider.aabb.minY,
  });
}

function componentData(component, chunkX, chunkZ) {
  const data = component.provider.buildChunkData(chunkX, chunkZ);
  if (!data || typeof data.signature !== 'string' || !Array.isArray(data.colliders)) {
    throw new Error(`Collision component ${component.id} returned invalid chunk data.`);
  }
  return Object.freeze({
    id: component.id,
    signature: data.signature,
    colliders: data.colliders,
    colliderCount: data.colliders.length,
    stats: data.stats ?? Object.freeze({ colliders: data.colliders.length }),
    sample: data.sample ?? sampleFromCollider(data.colliders[0]),
  });
}

function combinedData(components, chunkX, chunkZ) {
  const entries = components.map((component) => componentData(component, chunkX, chunkZ));
  const colliders = entries.flatMap((entry) => entry.colliders);
  colliders.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return Object.freeze({
    signature: entries.map((entry) => `${entry.id}:${entry.signature}`).join('|'),
    colliders: Object.freeze(colliders),
    components: Object.freeze(Object.fromEntries(entries.map((entry) => [entry.id, entry]))),
  });
}

function componentEpoch(component) {
  if (typeof component.provider.getEpoch === 'function') return component.provider.getEpoch();
  if (typeof component.provider.source?.epoch === 'function') return component.provider.source.epoch();
  return 'static';
}

function changedComponents(previous, next) {
  const changed = [];
  for (const [id, data] of Object.entries(next.components)) {
    if (previous?.components?.[id]?.signature !== data.signature) changed.push(id);
  }
  return changed;
}

export class NaturalCollisionProvider {
  constructor({
    components,
    buildsPerFrame = 1,
    buildBudgetMs = 2,
    now = () => performance.now(),
    logger = console,
  }) {
    if (!Array.isArray(components) || components.length === 0) {
      throw new Error('Natural collision provider requires at least one component.');
    }
    const ids = new Set();
    for (const component of components) {
      if (!component?.id
          || typeof component.counterName !== 'string'
          || !component.counterName.trim()
          || !component.provider?.buildChunkData
          || ids.has(component.id)) {
        throw new Error(
          'Natural collision components require unique IDs, counter names, and chunk builders.',
        );
      }
      ids.add(component.id);
    }
    if (!Number.isSafeInteger(buildsPerFrame) || buildsPerFrame < 1) {
      throw new Error('Natural collision buildsPerFrame must be a positive integer.');
    }
    if (!Number.isFinite(buildBudgetMs) || buildBudgetMs <= 0) {
      throw new Error('Natural collision buildBudgetMs must be positive.');
    }
    this.components = Object.freeze(components.map((component) => Object.freeze({ ...component })));
    this.buildsPerFrame = buildsPerFrame;
    this.buildBudgetMs = buildBudgetMs;
    this.now = now;
    this.logger = logger ?? console;
    this.descriptor = Object.freeze({
      id: 'production-natural-props',
      components: Object.freeze(this.components.map((component) => component.id)),
    });
    this.chunkStates = new Map();
    this.pendingRefresh = [];
    this.pendingRefreshKeys = new Set();
    this.nextRevision = 1;
    this.lastSourceEpoch = this.sourceEpoch();
    this.lastError = null;
    this.refreshBuilds = 0;
    this.samples = Object.create(null);
    this.updateCounters();
  }

  sourceEpoch() {
    return this.components
      .map((component) => `${component.id}:${componentEpoch(component)}`)
      .join('|');
  }

  buildOwnerChunk(chunkX, chunkZ) {
    const data = combinedData(this.components, chunkX, chunkZ);
    const revision = this.nextRevision;
    this.nextRevision += 1;
    return Object.freeze({ revision, colliders: data.colliders, providerData: data });
  }

  commitOwnerChunk({ chunkX, chunkZ, revision, providerData }) {
    if (!providerData) return;
    const key = collisionChunkKey(chunkX, chunkZ);
    this.recordChunk(key, revision, providerData);
    for (const component of this.components) {
      PerfCounters.inc(`collision${component.counterName}ChunkBuilds`);
    }
  }

  unloadOwnerChunk(chunkX, chunkZ) {
    const key = collisionChunkKey(chunkX, chunkZ);
    this.chunkStates.delete(key);
    this.pendingRefreshKeys.delete(key);
    this.refreshSamples();
    this.updateCounters();
  }

  recordChunk(key, revision, data) {
    this.chunkStates.set(key, Object.freeze({
      revision,
      signature: data.signature,
      colliderCount: data.colliders.length,
      components: data.components,
    }));
    this.refreshSamples();
    this.updateCounters();
  }

  refreshSamples() {
    for (const component of this.components) this.samples[component.id] = null;
    for (const key of [...this.chunkStates.keys()].sort()) {
      const state = this.chunkStates.get(key);
      for (const component of this.components) {
        this.samples[component.id] ??= state.components[component.id]?.sample ?? null;
      }
    }
  }

  enqueueLoadedChunks(world) {
    for (const key of this.chunkStates.keys()) {
      const { chunkX, chunkZ } = parseCollisionChunkKey(key);
      if (!world.isOwnerChunkReady(chunkX, chunkZ)) {
        this.unloadOwnerChunk(chunkX, chunkZ);
        continue;
      }
      if (this.pendingRefreshKeys.has(key)) continue;
      this.pendingRefreshKeys.add(key);
      this.pendingRefresh.push(key);
    }
  }

  enqueueRetry(key) {
    if (!this.chunkStates.has(key) || this.pendingRefreshKeys.has(key)) return;
    this.pendingRefreshKeys.add(key);
    this.pendingRefresh.push(key);
  }

  refresh(world) {
    let epoch;
    try {
      epoch = this.sourceEpoch();
    } catch (error) {
      this.lastError = error;
      this.logger.error?.('Natural collision source refresh failed.', error);
      this.updateCounters();
      return Object.freeze({ attempted: 0, rebuilt: 0, remaining: this.pendingRefresh.length });
    }
    if (epoch !== this.lastSourceEpoch) {
      this.lastSourceEpoch = epoch;
      this.enqueueLoadedChunks(world);
    }

    const startedAt = this.now();
    let attempted = 0;
    let rebuilt = 0;
    let frameError = null;
    const changedCounts = Object.create(null);
    const retryKeys = [];
    while (this.pendingRefresh.length > 0 && attempted < this.buildsPerFrame) {
      if (attempted > 0 && this.now() - startedAt >= this.buildBudgetMs) break;
      const key = this.pendingRefresh.shift();
      this.pendingRefreshKeys.delete(key);
      attempted += 1;
      const previous = this.chunkStates.get(key);
      if (!previous) continue;
      const { chunkX, chunkZ } = parseCollisionChunkKey(key);
      if (!world.isOwnerChunkReady(chunkX, chunkZ)) {
        this.unloadOwnerChunk(chunkX, chunkZ);
        continue;
      }
      try {
        const data = combinedData(this.components, chunkX, chunkZ);
        if (data.signature === previous.signature) continue;
        const revision = this.nextRevision;
        this.nextRevision += 1;
        if (world.replaceOwnerChunk({ chunkX, chunkZ, revision, colliders: data.colliders })) {
          for (const id of changedComponents(previous, data)) {
            changedCounts[id] = (changedCounts[id] ?? 0) + 1;
          }
          this.recordChunk(key, revision, data);
          rebuilt += 1;
          this.refreshBuilds += 1;
        }
      } catch (error) {
        frameError = error;
        if (this.chunkStates.has(key) && world.isOwnerChunkReady(chunkX, chunkZ)) {
          retryKeys.push(key);
        }
        this.logger.error?.(`Natural collision refresh failed for ${key}.`, error);
      }
    }
    for (const key of retryKeys) this.enqueueRetry(key);
    if (frameError) this.lastError = frameError;
    else if (attempted > 0) this.lastError = null;
    const elapsed = this.now() - startedAt;
    for (const component of this.components) {
      const changed = changedCounts[component.id] ?? 0;
      PerfCounters.inc(`collision${component.counterName}ChunkRefreshes`, changed);
      if (attempted > 0) PerfCounters.inc(`collision${component.counterName}RefreshMs`, elapsed);
    }
    this.updateCounters();
    return Object.freeze({ attempted, rebuilt, remaining: this.pendingRefresh.length });
  }

  updateCounters() {
    const aggregates = Object.fromEntries(this.components.map((component) => [component.id, {
      chunks: 0,
      colliders: 0,
      decorative: 0,
      blocking: 0,
      walkablePending: 0,
    }]));
    for (const state of this.chunkStates.values()) {
      for (const component of this.components) {
        const data = state.components[component.id];
        if (!data) continue;
        const aggregate = aggregates[component.id];
        aggregate.chunks += 1;
        aggregate.colliders += data.colliderCount;
        aggregate.decorative += data.stats.decorative ?? 0;
        aggregate.blocking += data.stats.blocking ?? 0;
        aggregate.walkablePending += data.stats.walkablePending ?? 0;
      }
    }
    for (const component of this.components) {
      const aggregate = aggregates[component.id];
      PerfCounters.set(`collision${component.counterName}Chunks`, aggregate.chunks);
      PerfCounters.set(`collision${component.counterName}Colliders`, aggregate.colliders);
      PerfCounters.set(`collision${component.counterName}RefreshQueueDepth`, this.pendingRefresh.length);
      if (component.id === 'rocks') {
        PerfCounters.set('collisionRockDecorativeInstances', aggregate.decorative);
        PerfCounters.set('collisionRockBlockingInstances', aggregate.blocking);
        PerfCounters.set('collisionRockWalkablePendingInstances', aggregate.walkablePending);
      }
    }
    PerfCounters.set('collisionNaturalRefreshQueueDepth', this.pendingRefresh.length);
  }

  getStatus() {
    const components = {};
    for (const component of this.components) {
      let chunks = 0;
      let colliders = 0;
      let decorative = 0;
      let blocking = 0;
      let walkablePending = 0;
      for (const state of this.chunkStates.values()) {
        const data = state.components[component.id];
        if (!data) continue;
        chunks += 1;
        colliders += data.colliderCount;
        decorative += data.stats.decorative ?? 0;
        blocking += data.stats.blocking ?? 0;
        walkablePending += data.stats.walkablePending ?? 0;
      }
      components[component.id] = Object.freeze({
        id: component.id,
        profileCount: component.provider.getProfileCount?.()
          ?? component.provider.source?.profiles?.length
          ?? 0,
        chunks,
        colliders,
        decorative,
        blocking,
        walkablePending,
        sample: this.samples[component.id] ?? null,
      });
    }
    const treeSample = components.trees?.sample ?? null;
    const rockSample = components.rocks?.sample ?? null;
    return Object.freeze({
      id: this.descriptor.id,
      loadedChunks: this.chunkStates.size,
      colliderCount: [...this.chunkStates.values()]
        .reduce((sum, state) => sum + state.colliderCount, 0),
      queuedRefreshes: this.pendingRefresh.length,
      refreshBuilds: this.refreshBuilds,
      lastError: this.lastError?.message ?? null,
      sample: treeSample,
      rockSample,
      components: Object.freeze(components),
    });
  }

  dispose() {
    this.chunkStates.clear();
    this.pendingRefresh.length = 0;
    this.pendingRefreshKeys.clear();
    this.lastError = null;
    this.refreshBuilds = 0;
    for (const component of this.components) component.provider.dispose?.();
    this.refreshSamples();
    this.updateCounters();
  }
}
