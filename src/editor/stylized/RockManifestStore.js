const EMPTY_BLOCKERS = Object.freeze({ signature: 'disabled-rocks', placements: Object.freeze([]) });
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { StylizedBuildQueue } from './StylizedBuildQueue.js';
import { createStableChunkManifestBuilder, placementSignature } from './StableScatterManifest.js';
import { createIteratorBuilder } from './ResumableIterator.js';

/**
 * The stone sources a chunk's manifest gathers after the scatter (stage 0), each
 * a view method returning a resumable iterator, then one ground-fit pass.
 */
const STONE_SOURCES = Object.freeze([
  { name: 'Riverbank', factory: 'riverbankRocksForChunk' },
  { name: 'Coast', factory: 'coastStonesForChunk' },
  { name: 'Seabed', factory: 'seabedRocksForChunk' },
  { name: 'Formations', factory: 'formationRocksForChunk' },
]);
const STAGE_NAMES = Object.freeze(['Scatter', ...STONE_SOURCES.map(({ name }) => name), 'GroundFit']);
const GROUND_FIT_STAGE = STAGE_NAMES.length - 1;
import { withinPreparationWindow } from '../world/PlacementPreparationWindow.js';

/** Placement ownership is independent of render slots and lookup order. */
export class RockManifestStore {
  constructor(view) {
    this.view = view;
    this.cache = new Map();
    this.pending = new Map();
    this.halos = new Map();
    this.haloSignatures = new Map();
    this.clock = 0;
    this.version = 0;
    this.queue = new StylizedBuildQueue({ buildsPerFrame: 16, budgetMs: view.manifestBuildBudgetMs });
    this.queue.shouldYield = () => Boolean(view.shouldYieldWork?.());
  }

  get(x, z) {
    const entry = this.cache.get(`${x}:${z}`);
    if (entry?.key !== this.view.manifestKey(x, z)) return null;
    entry.used = ++this.clock;
    return entry.placements;
  }

  setWindow(x, z, radius) {
    if (this.window?.x === x && this.window.z === z && this.window.radius === radius) return;
    this.window = { x, z, radius };
    this.queue.retain(job => withinPreparationWindow(job.chunkX, job.chunkZ, this.window));
    for (const key of this.pending.keys()) {
      const [cx, cz] = key.split(':').map(Number);
      if (!withinPreparationWindow(cx, cz, this.window)) this.pending.delete(key);
    }
  }

  request(x, z, priority = null) {
    const placements = this.get(x, z);
    if (placements !== null) return placements;
    if (!withinPreparationWindow(x, z, this.window)) return null;
    if (this.view.prototypes.length === 0) return null;
    const focus = this.view.terrainView.focusChunk;
    priority ??= focus ? Math.max(Math.abs(x - focus.chunkX), Math.abs(z - focus.chunkZ)) : 0;
    this.queue.enqueue({ key: `${x}:${z}`, chunkX: x, chunkZ: z, priority });
    return null;
  }

  blockerSnapshot(x, z, halo = 1) {
    const assets = this.view.assetReadiness?.();
    if (assets?.errors.length) throw new Error(`Required rock assets failed: ${assets.errors.join(', ')}`);
    if (this.view.config?.rocks?.enabled === false
        || this.view.prototypes.length === 0 && assets?.ready && assets.requiredCount === 0) return EMPTY_BLOCKERS;
    const key = `${x}:${z}:${halo}`;
    const token = `${this.version}:${this.view.revisionTracker?.revision ?? 0}:${this.view.prototypeRevision ?? 0}:${this.view.biomeAssetPalette?.revision ?? 0}`;
    const existing = this.halos.get(key);
    if (existing?.token === token) return existing;
    const entries = [];
    let ready = true;
    for (let dz = -halo; dz <= halo; dz++) for (let dx = -halo; dx <= halo; dx++) {
      const placements = this.request(x + dx, z + dz);
      if (placements === null) ready = false;
      else entries.push(this.cache.get(`${x + dx}:${z + dz}`));
    }
    if (!ready) return null;
    // Cache entries are immutable and replaced on rebuild, so identical entry
    // references mean an identical signature; skip the per-frame join then.
    const memo = this.haloSignatures.get(key);
    const same = memo !== undefined && memo.entries.length === entries.length
      && memo.entries.every((entry, i) => entry === entries[i]);
    const signature = same ? memo.signature : entries.map(entry => entry.signature).join('|');
    if (!same) {
      this.haloSignatures.set(key, { entries, signature });
      if (this.haloSignatures.size > 625) this.haloSignatures.delete(this.haloSignatures.keys().next().value);
    }
    const cached = this.halos.get(key);
    if (cached?.signature === signature) { cached.token = token; return cached; }
    const snapshot = { token, signature, placements: Object.freeze(entries.flatMap(e => e.placements)) };
    this.halos.set(key, snapshot);
    if (this.halos.size > 625) this.halos.delete(this.halos.keys().next().value);
    return snapshot;
  }

  createState(x, z, key) {
    return {
      key, stage: 0, placements: [],
      builder: createStableChunkManifestBuilder(this.view.manifestOptions(x, z)),
      startedAt: performance.now(),
    };
  }

  step(job, shouldYield) {
    const { chunkX: x, chunkZ: z, key: cacheKey } = job;
    if (this.get(x, z) !== null) return false;
    if (shouldYield()) return { completed: false, advanced: false, blocked: true, reason: 'budget' };
    const prepared = this.view.terrainView.preparedPlacement;
    if (prepared && !prepared.ensureChunk(x, z, 2, job.priority)) {
      return { completed: false, advanced: false, blocked: true, reason: 'prepared-field' };
    }
    const key = this.view.manifestKey(x, z);
    let state = this.pending.get(cacheKey);
    if (state?.key !== key) {
      state = this.createState(x, z, key);
      this.pending.set(cacheKey, state);
    }
    const before = state.stage * 10000000 + state.builder.progress;
    while (state.stage <= GROUND_FIT_STAGE && !shouldYield()) {
      const started = performance.now();
      const placements = state.builder.step({ shouldYield });
      PerfCounters.inc(`rock${STAGE_NAMES[state.stage]}Ms`, performance.now() - started);
      if (placements === null) break;
      if (state.stage === GROUND_FIT_STAGE) state.placements = placements;
      else state.placements.push(...placements);
      state.stage++;
      if (state.stage < GROUND_FIT_STAGE) {
        const factory = STONE_SOURCES[state.stage - 1].factory;
        state.builder = createIteratorBuilder(() => this.view[factory](x, z));
      } else if (state.stage === GROUND_FIT_STAGE) {
        state.builder = createIteratorBuilder(() => this.view.resolveGroundPlacements(state.placements));
      }
    }
    PerfCounters.inc('rockManifestBuildSlices');
    if (state.stage <= GROUND_FIT_STAGE || shouldYield()) {
      const after = state.stage * 10000000 + state.builder.progress;
      return { completed: false, advanced: after > before, blocked: after <= before, reason: 'budget' };
    }
    const placements = Object.freeze(state.placements);
    this.cache.set(cacheKey, {
      key, placements, signature: `${key}|${placementSignature(placements)}`, used: ++this.clock,
    });
    this.pending.delete(cacheKey);
    this.version++;
    this.view.placementsByChunk.set(cacheKey, placements);
    PerfCounters.inc('rockManifestBuilds');
    PerfCounters.set('rockManifestReadyLatencyMs', performance.now() - state.startedAt);
    // A retained CPU window is larger than the draw window; no visual radius changes.
    if (this.cache.size > 625) {
      let oldestKey = null;
      let oldest = Infinity;
      for (const [entryKey, entry] of this.cache) if (entry.used < oldest) {
        const [cx, cz] = entryKey.split(':').map(Number);
        if (this.window && withinPreparationWindow(cx, cz, this.window)) continue;
        oldest = entry.used; oldestKey = entryKey;
      }
      if (oldestKey !== null) {
        this.cache.delete(oldestKey);
        this.view.placementsByChunk.delete(oldestKey);
      }
    }
    return true;
  }

  flush() {
    const started = performance.now();
    const result = this.queue.flush((job, yieldWork) => this.step(job, yieldWork));
    PerfCounters.inc('rockManifestBuildMs', performance.now() - started);
    PerfCounters.set('rockManifestQueueDepth', result.remaining);
    PerfCounters.set('rockManifestCacheEntries', this.cache.size);
    PerfCounters.set('rockManifestOldestJobMs', this.pending.size
      ? performance.now() - Math.min(...[...this.pending.values()].map(state => state.startedAt)) : 0);
    return result;
  }

  dispose() { this.queue.clear(); this.pending.clear(); this.cache.clear(); this.halos.clear(); this.haloSignatures.clear(); }
}
