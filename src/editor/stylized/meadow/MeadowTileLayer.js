import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { createCompaction } from './meadowGrassCompaction.js';
import { MeadowGrassBatches } from './MeadowGrassBatches.js';
import { tileDistanceSquared } from './meadowGrassLayout.js';
import { compactionPrefix } from './MeadowCompactionPrefix.js';
import { meadowTileInView } from './meadowTileVisibility.js';
import { MeadowPublicationBudget } from './MeadowPublicationBudget.js';

/**
 * A camera-centred grid of chunk-aligned tiles, each drawing one band's template
 * compacted against its ground — the machinery grass-test's `GrassField` and
 * `FarGrassField` share, here shared by the meadow's blades and its far cards.
 *
 *  - Tiles are keyed by their canonical grid cell, so a tile survives the
 *    floating origin moving; only its render-space origin (and so its batch
 *    slot) is rewritten.
 *  - Builds run nearest-first until the caller's deadline, in slices of
 *    `SLICE_STEMS`, and a tile keeps drawing its previous band until the new one
 *    is ready, so nothing blinks.
 *  - Bounded packed pages retain local uploads and avoid drawing unused stems.
 *  - No garbage in steady state: a band's compaction outputs (up to ~0.5 MB each)
 *    are pooled and reused as tiles leave and rebuild. Allocating them fresh
 *    showed up as 40–230 ms collector pauses while running across the meadow.
 */
/** Stems compacted between deadline checks. */
const SLICE_STEMS = 256;
/** Recycled outputs kept per band; past this they are left to the collector. */
const POOL_LIMIT = 24;
const CAMERA_POSITION_QUANTIZATION = 4;
const VIEW_DIRECTION_QUANTIZATION = 512;
/** Metres the camera may travel between full window walks. No wider than a tile:
 * the walk reaches one tile past `reach`, so an arriving tile is always found. */
const LAYOUT_SLACK = 1;

export class MeadowTileLayer {
  /**
   * @param {object} options
   * @param {object} options.scene
   * @param {string} options.name
   * @param {number} options.tileSize metres
   * @param {Record<string, object>} options.templates band → template
   * @param {object} options.material
   * @param {(distanceSquared: number, farthestSquared: number) => string | null} options.selectBand
   * @param {number} options.reach metres beyond which no tile is considered
   * @param {object} options.ground MeadowGroundSampler
   * @param {number} [options.renderOrder]
   */
  constructor({ scene, name, tileSize, templates, material, selectBand, selectPreparationBand = null, reach, ground, renderOrder = 0, boundsPadding = null, maxPublicationBytes = Infinity, maxPublicationsPerFrame = Infinity, preparer = null, getDrawPreparation = () => null }) {
    this.tileSize = tileSize;
    this.templates = templates;
    this.selectBand = selectBand;
    this.reach = reach;
    this.ground = ground;
    this.preparer = preparer;
    for (const template of Object.values(templates)) preparer?.register(template);
    this.maxPublicationBytes = maxPublicationBytes;
    this.maxPublicationsPerFrame = maxPublicationsPerFrame;
    this.publicationBytes = 0;
    this.publications = 0;
    this.batchBudget = new MeadowPublicationBudget(maxPublicationBytes);
    this.origin = null;
    const definitions = Object.values(templates).map(template => template.userData?.meadow);
    this.stablePrefixes = definitions.every(definition => definition?.tileSize === tileSize
      && definition.cards === definitions[0].cards);
    this.selectPreparationBand = this.stablePrefixes ? selectPreparationBand : null;
    this.batches = new MeadowGrassBatches({ scene, templates, material, name, renderOrder, boundsPadding, getDrawPreparation });
    this.tiles = new Map();
    this.pools = new Map(Object.keys(templates).map((band) => [band, []]));
    this.buildSerial = 0;
    this.frameSerial = 0;
    this.updateSerial = 0;
    this.staleTiles = [];
    this.layoutState = new Float64Array(5);
    this.layoutState.fill(Number.NaN);
    this.layoutCamera = { x: Number.NaN, z: Number.NaN };
    this.layoutSlack = Math.min(LAYOUT_SLACK, tileSize);
    // Flat tx, tz pairs whose band or membership could change within the slack.
    this.boundaryCells = [];
    this.viewState = new Float64Array(3);
    this.viewState.fill(Number.NaN);
    this.batchDirty = true;
    this.stats = {
      tiles: 0,
      building: 0,
      stems: 0,
      bands: {},
      visibleMissing: 0,
      visibleCapacityLag: 0,
      inViewMissing: 0,
      inViewCapacityLag: 0,
    };
  }

  get meshes() {
    return this.batches.meshes;
  }

  /**
   * @param {{ x: number, z: number }} camera canonical metres
   * @param {{ x: number, z: number }} origin floating origin
   * @param {number} deadline performance.now() by which this frame's builds stop
   */
  beginFrame(frameId) {
    if (this.publicationFrameId === frameId) return;
    this.publicationFrameId = frameId;
    this.publicationBytes = 0;
    this.publications = 0;
    this.batchBudget.reset(this.maxPublicationBytes);
  }

  update(camera, origin, deadline, time = performance.now() / 1000, viewCone = null, buildEnabled = true, frameId = null) {
    this.time = time;
    if (frameId === null) {
      this.publicationBytes = 0; this.publications = 0; this.batchBudget.reset(this.maxPublicationBytes);
    }
    else this.beginFrame(frameId);
    if (this.origin && (this.origin.x !== origin.x || this.origin.z !== origin.z)) {
      this.batches.rebase(this.origin.x - origin.x, this.origin.z - origin.z, this.batchBudget);
    }
    this.origin = { x: origin.x, z: origin.z };
    this.updateSerial += 1;
    const groundRevision = Number.isFinite(this.ground.revision)
      ? this.ground.revision
      : this.updateSerial;
    const windowRefresh = this.windowInputsChanged(origin, groundRevision);
    const layoutChanged = this.updateLayoutState(camera, origin, groundRevision);
    if (windowRefresh || (layoutChanged && Math.hypot(camera.x - this.layoutCamera.x,
      camera.z - this.layoutCamera.z) >= this.layoutSlack)) this.refreshLayout(camera, origin, viewCone);
    else if (layoutChanged) this.refreshBoundary(camera, origin, viewCone);
    else if (this.staleTiles.length > 1 && this.updateViewState(viewCone)) {
      for (const tile of this.staleTiles) {
        tile.inView = meadowTileInView(
          tile.centerX,
          tile.centerZ,
          camera,
          this.tileSize,
          viewCone,
        );
      }
      this.sortStaleTiles();
    }
    if (buildEnabled) {
      // Cached prefixes are cheap on the CPU but still upload full GPU attributes
      // on a band change. Publish nearest/in-view first under the byte allowance.
      for (const tile of this.staleTiles) {
        if (this.stablePrefixes && tile.band !== null && tile.prepared?.revision === tile.revision
          && tile.prepared.capacity >= this.templates[tile.band].instanceCount) this.publishPrepared(tile);
      }
      this.build(deadline, layoutChanged);
    }
    if (this.batchDirty && this.workRunner) this.workRunner(() => this.commit());
    else this.commit();
  }

  windowInputsChanged(origin, groundRevision) {
    const state = this.layoutState;
    return state[2] !== origin.x || state[3] !== origin.z || state[4] !== groundRevision;
  }

  updateLayoutState(camera, origin, groundRevision) {
    const cameraX = Math.round(camera.x * CAMERA_POSITION_QUANTIZATION);
    const cameraZ = Math.round(camera.z * CAMERA_POSITION_QUANTIZATION);
    const state = this.layoutState;
    const changed = state[0] !== cameraX
      || state[1] !== cameraZ
      || state[2] !== origin.x
      || state[3] !== origin.z
      || state[4] !== groundRevision;
    state[0] = cameraX;
    state[1] = cameraZ;
    state[2] = origin.x;
    state[3] = origin.z;
    state[4] = groundRevision;
    return changed;
  }

  updateViewState(viewCone) {
    const nextX = viewCone ? Math.round(viewCone.x * VIEW_DIRECTION_QUANTIZATION) : 0;
    const nextZ = viewCone ? Math.round(viewCone.z * VIEW_DIRECTION_QUANTIZATION) : 0;
    const nextTangent = viewCone ? Math.round(viewCone.tangent * VIEW_DIRECTION_QUANTIZATION) : 0;
    const changed = this.viewState[0] !== nextX
      || this.viewState[1] !== nextZ
      || this.viewState[2] !== nextTangent;
    this.viewState[0] = nextX;
    this.viewState[1] = nextZ;
    this.viewState[2] = nextTangent;
    return changed;
  }

  refreshLayout(camera, origin, viewCone) {
    this.updateViewState(viewCone);
    const size = this.tileSize;
    const reach = this.reach + size;
    const frameSerial = ++this.frameSerial;
    this.layoutCamera.x = camera.x;
    this.layoutCamera.z = camera.z;
    this.boundaryCells.length = 0;
    for (let tz = Math.floor((camera.z - reach) / size); tz <= Math.floor((camera.z + reach) / size); tz += 1) {
      for (let tx = Math.floor((camera.x - reach) / size); tx <= Math.floor((camera.x + reach) / size); tx += 1) {
        const { nearest, farthest } = this.measureCell(tx, tz, camera);
        if (this.bandCanChange(nearest, farthest)) this.boundaryCells.push(tx, tz);
        const tile = this.refreshCell(tx, tz, nearest, farthest, camera, origin, viewCone);
        if (tile) tile.seenFrame = frameSerial;
      }
    }
    for (const [key, tile] of this.tiles) {
      if (tile.seenFrame !== frameSerial) this.retire(key, tile);
    }
    this.rebuildStaleTiles();
  }

  /**
   * The camera moved inside the slack: only cells that could change band were
   * listed, and only tiles waiting to build care about their exact distance.
   */
  refreshBoundary(camera, origin, viewCone) {
    this.updateViewState(viewCone);
    let changed = false;
    const cells = this.boundaryCells;
    for (let index = 0; index < cells.length; index += 2) {
      const tx = cells[index], tz = cells[index + 1];
      const key = `${tx}:${tz}`;
      const before = this.tiles.get(key);
      const previousBand = before?.band, previousPreparationBand = before?.preparationBand;
      const { nearest, farthest } = this.measureCell(tx, tz, camera);
      const tile = this.refreshCell(tx, tz, nearest, farthest, camera, origin, viewCone);
      if (!tile && before) this.retire(key, before);
      changed ||= tile !== (before ?? null) || tile?.band !== previousBand
        || tile?.preparationBand !== previousPreparationBand;
    }
    if (changed) { this.rebuildStaleTiles(); return; }
    for (const tile of this.staleTiles) {
      const { nearest } = this.measureTile(tile.centerX, tile.centerZ, camera);
      tile.distanceSquared = nearest;
      tile.inView = meadowTileInView(tile.centerX, tile.centerZ, camera, this.tileSize, viewCone);
    }
    this.sortStaleTiles();
  }

  measureCell(tx, tz, camera) {
    return this.measureTile((tx + 0.5) * this.tileSize, (tz + 0.5) * this.tileSize, camera);
  }

  measureTile(centerX, centerZ, camera) {
    const size = this.tileSize;
    const measure = this.measure ??= { nearest: 0, farthest: 0 };
    measure.nearest = tileDistanceSquared(camera.x, camera.z, centerX, centerZ, size);
    measure.farthest = (Math.abs(camera.x - centerX) + size / 2) ** 2
      + (Math.abs(camera.z - centerZ) + size / 2) ** 2;
    return measure;
  }

  /**
   * Both distances move at most as far as the camera, and the bands widen with
   * distance, so the extremes reachable within the slack bound any change.
   */
  bandCanChange(nearest, farthest) {
    const nearRoot = Math.sqrt(nearest), farRoot = Math.sqrt(farthest), slack = this.layoutSlack;
    const closeNearest = Math.max(0, nearRoot - slack) ** 2, wideNearest = (nearRoot + slack) ** 2;
    const closeFarthest = Math.max(0, farRoot - slack) ** 2, wideFarthest = (farRoot + slack) ** 2;
    const select = this.selectBand, prepare = this.selectPreparationBand;
    const band = select(nearest, farthest);
    return select(closeNearest, wideFarthest) !== band || select(wideNearest, closeFarthest) !== band
      || (prepare !== null && (prepare(closeNearest, wideFarthest) !== prepare(nearest, farthest)
        || prepare(wideNearest, closeFarthest) !== prepare(nearest, farthest)));
  }

  /** Brings one cell's tile up to date. Returns it, or null when the cell is outside the window. */
  refreshCell(tx, tz, nearest, farthest, camera, origin, viewCone) {
    const size = this.tileSize;
    const centerX = (tx + 0.5) * size;
    const centerZ = (tz + 0.5) * size;
    const band = this.selectBand(nearest, farthest);
    const preparationBand = this.selectPreparationBand?.(nearest, farthest) ?? band;
    if (!preparationBand) return null;
    const key = `${tx}:${tz}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = { key, centerX, centerZ, output: null, buildId: 0, job: null };
      this.tiles.set(key, tile);
      this.batchDirty = true;
    }
    const previousBand = tile.band;
    const previousRenderX = tile.renderX;
    const previousRenderZ = tile.renderZ;
    tile.band = band;
    if (band === null && tile.output) {
      tile.output = null;
      this.batchDirty = true;
    }
    tile.preparationBand = preparationBand;
    tile.preparationCapacity = this.templates[preparationBand].instanceCount;
    tile.distanceSquared = nearest;
    tile.inView = meadowTileInView(centerX, centerZ, camera, size, viewCone);
    tile.renderX = centerX - origin.x;
    tile.renderZ = centerZ - origin.z;
    if (previousBand !== tile.band
        || previousRenderX !== tile.renderX
        || previousRenderZ !== tile.renderZ) {
      this.batchDirty = true;
    }
    tile.revision = this.ground.revisionAt(centerX, centerZ, this.tileSize / 2);
    return tile;
  }

  retire(key, tile) {
    if (tile.output) this.batchDirty = true;
    this.release(tile.prepared?.band ?? tile.builtBand, tile.prepared?.output ?? tile.output);
    this.releaseJob(tile);
    this.tiles.delete(key);
  }

  rebuildStaleTiles() {
    const stale = this.staleTiles;
    stale.length = 0;
    for (const tile of this.tiles.values()) {
      if (tile.job && tile.job.revision === tile.revision && this.stablePrefixes
          && this.templates[tile.job.band].instanceCount < tile.preparationCapacity) {
        const reused = tile.job.compaction.processedCount;
        const previous = tile.job.compaction.promote(this.templates[tile.preparationBand],
          this.pools.get(tile.preparationBand).pop() ?? null);
        this.release(tile.job.band, previous);
        tile.job.band = tile.preparationBand;
        PerfCounters.inc('meadowPartialRanksReused', reused);
      }
      if (tile.job && (tile.job.revision !== tile.revision || (!this.stablePrefixes
          && this.templates[tile.job.band].instanceCount < tile.preparationCapacity))) {
        PerfCounters.inc('meadowRanksDiscarded', tile.job.compaction.processedCount);
        this.releaseJob(tile);
      }
      if (MeadowTileLayer.isStale(tile)) stale.push(tile);
      else if (tile.job) {
        this.releaseJob(tile);
      }
    }
    this.sortStaleTiles();
    this.stats.building = stale.length;
  }

  sortStaleTiles() {
    this.staleTiles.sort((a, b) => Number(!a.inView) - Number(!b.inView)
      || a.distanceSquared - b.distanceSquared);
  }

  release(band, output) {
    const pool = this.pools.get(band);
    if (output && pool && pool.length < POOL_LIMIT) pool.push(output);
  }

  releaseJob(tile) {
    if (!tile.job) return;
    tile.job.compaction.cancel?.();
    this.release(tile.job.band, tile.job.compaction.output);
    tile.job = null;
  }

  /** A tile needs a build when its ground is resident and its band or page moved on. */
  static isStale(tile) {
    return tile.revision !== null && ((tile.band !== null
      && (!tile.output || tile.builtBand !== tile.band || tile.builtRevision !== tile.revision))
      || (tile.preparationBand !== tile.band
        && (tile.prepared?.revision !== tile.revision || tile.prepared.capacity < tile.preparationCapacity)));
  }

  build(deadline, layoutChanged) {
    const stale = this.staleTiles;
    if (layoutChanged && stale.length === 0) {
      this.stats.building = 0;
      return;
    }
    const run = () => this.buildTiles(stale, this.workBudgetProvider && stale.length
      ? Math.min(deadline, performance.now() + this.workBudgetProvider(this.workBudgetMs))
      : deadline);
    if (this.workRunner && stale.length) this.workRunner(run);
    else if (stale.length) run();
    else this.stats.building = 0;
  }

  buildTiles(stale, deadline) {
    PerfCounters.inc('meadowBuildTurns');
    let compacted = 0;
    let write = 0;
    for (let read = 0; read < stale.length; read += 1) {
      const tile = stale[read];
      if (!MeadowTileLayer.isStale(tile)) {
        this.releaseJob(tile);
        continue;
      }
      if (performance.now() >= deadline) {
        let ready = 0;
        for (let remaining = read; remaining < stale.length; remaining += 1) {
          const pending = stale[remaining];
          if (MeadowTileLayer.isStale(pending)) stale[write++] = pending;
          if (pending.job?.compaction.done) ready++;
        }
        PerfCounters.inc('meadowDeadlineDeferredResults', ready);
        break;
      }
      const capacity = tile.preparationCapacity;
      if (this.stablePrefixes && tile.prepared?.revision === tile.revision
        && tile.prepared.capacity >= capacity) {
        this.releaseJob(tile);
        if (!this.publishPrepared(tile)) stale[write++] = tile;
        continue;
      }
      if (!tile.job) {
        if (this.preparer && !this.preparer.hasCapacity(this.templates[tile.preparationBand])) {
          stale[write++] = tile;
          continue;
        }
        const ground = this.ground.forTile(tile.centerX, tile.centerZ, this.tileSize / 2);
        if (!ground) {
          stale[write++] = tile;
          continue;
        }
        const options = {
          template: this.templates[tile.preparationBand],
          centerX: tile.centerX, centerZ: tile.centerZ, sample: ground.sample,
          output: this.pools.get(tile.preparationBand).pop() ?? null,
          previous: this.stablePrefixes && tile.prepared?.revision === ground.revision ? tile.prepared : null,
        };
        tile.job = {
          band: tile.preparationBand,
          revision: ground.revision,
          compaction: this.preparer && ground.snapshot && !this.preparer.failed
            ? this.preparer.create({ ...options, snapshot: ground.snapshot,
              recycle: (output, template) => this.release(Object.keys(this.templates)
                .find(band => this.templates[band] === template), output) })
            : createCompaction(options),
        };
      }
      const { compaction } = tile.job;
      const total = this.templates[tile.job.band].instanceCount;
      const before = compaction.progress;
      if (compaction.asynchronous) compaction.advance(SLICE_STEMS);
      else while (!compaction.done && performance.now() < deadline) compaction.advance(SLICE_STEMS);
      compacted += Math.round((compaction.progress - before) * total);
      if (!compaction.done) {
        stale[write++] = tile;
        continue;
      }
      if (!compaction.output) {
        // Done from its `previous` prefix alone: the prepared ranks already
        // cover this band, so nothing new was compacted and the compaction
        // hands back no output (the prefix's buffers stay owned by
        // tile.prepared). Publish that prefix; dereferencing the null output
        // threw thousands of times a run and scenery never settled.
        compaction.cancel?.();
        tile.job = null;
        if (!tile.prepared || !this.publishPrepared(tile)) stale[write++] = tile;
        continue;
      }
      const publication = this.stablePrefixes && tile.band !== null
        ? compactionPrefix(compaction.output, this.templates[tile.band].instanceCount)
        : compaction.output;
      if (tile.band !== null && !this.canPublish(publication, tile)) {
        PerfCounters.inc('meadowPublicationDeferredResults');
        stale[write++] = tile;
        continue;
      }
      if (Number.isFinite(compaction.completedAt)) {
        PerfCounters.inc('meadowResultPublishWaitMs', performance.now() - compaction.completedAt);
        PerfCounters.inc('meadowWorkerResultsPublished');
      }
      this.release(tile.prepared?.band ?? tile.builtBand, tile.prepared?.output ?? tile.output);
      if (this.stablePrefixes) {
        tile.prepared = {
          output: compaction.output,
          capacity: total,
          band: tile.job.band,
          revision: tile.job.revision,
        };
      }
      if (this.stablePrefixes) this.publishPrepared(tile, true);
      else this.publish(tile, compaction.output, tile.job.band, tile.job.revision);
      tile.job = null;
      if (MeadowTileLayer.isStale(tile)) stale[write++] = tile;
    }
    stale.length = write;
    this.stats.building = stale.length;
    PerfCounters.inc('meadowStemsCompacted', compacted);
  }

  publish(tile, output, band, revision) {
    if (!this.canPublish(output, tile)) return false;
    const predictedBytes = this.batches.publicationBytes(tile, band, output);
    this.publicationBytes += predictedBytes;
    if (output.count || tile.output?.count) this.publications++;
    PerfCounters.inc('meadowPublications');
    PerfCounters.inc('meadowPublicationBytes', output.count * 14 * 4);
    PerfCounters.inc('meadowPublicationPredictedBytes', predictedBytes);
    const previousCapacity = tile.output?.count ? this.templates[tile.builtBand].instanceCount : 0;
    if (!previousCapacity || this.templates[band].instanceCount > previousCapacity) {
      // Keep an active arrival fade across a rapid second promotion. A ground
      // refresh of already-present ranks must not make the whole tile blink.
      if (!tile.output?.count || this.time - tile.revealTime >= 0.35) {
        tile.revealTime = this.time;
        tile.revealRank = previousCapacity;
      }
    }
    tile.output = output;
    tile.builtBand = band;
    tile.builtRevision = revision;
    tile.buildId = ++this.buildSerial;
    this.batchDirty = true;
    return true;
  }

  canPublish(output, tile = null) {
    // Source admission and actual page writes are separate: all uploads,
    // including retirement and origin maintenance, spend the batch allowance.
    if (!output.count && !tile?.output?.count) return true;
    if (this.batchBudget.used >= this.maxPublicationBytes) return false;
    return this.publications < this.maxPublicationsPerFrame && (this.publicationBytes === 0
      || this.publicationBytes + this.batches.publicationBytes(tile, tile?.band, output) <= this.maxPublicationBytes);
  }

  publishPrepared(tile, force = false) {
    if (tile.band === null || (!force && tile.output
      && tile.builtBand === tile.band && tile.builtRevision === tile.revision)) return true;
    const published = this.publish(tile, compactionPrefix(tile.prepared.output, this.templates[tile.band].instanceCount), tile.band, tile.revision);
    if (published && !force) PerfCounters.inc('meadowCompactionReuses');
    return published;
  }

  commit() {
    if (!this.batchDirty) return;
    this.batches.begin();
    let tiles = 0;
    let visibleMissing = 0, visibleCapacityLag = 0;
    let inViewMissing = 0, inViewCapacityLag = 0;
    for (const tile of this.tiles.values()) {
      if (tile.band === null || !tile.output || tile.output.count === 0) continue;
      this.batches.add(tile.builtBand, tile);
      tiles += 1;
    }
    const uploadStartedAt = performance.now();
    this.stats.bands = this.batches.commit(this.batchBudget);
    PerfCounters.inc('meadowBatchCommitMs', performance.now() - uploadStartedAt);
    for (const tile of this.tiles.values()) {
      if (tile.band !== null && tile.revision !== null) {
        if (!tile.output || tile.output.count > 0 && !this.batches.isPublished(tile)) {
          visibleMissing++;
          if (tile.inView) inViewMissing++;
        } else if (this.templates[tile.builtBand].instanceCount < this.templates[tile.band].instanceCount) {
          visibleCapacityLag++;
          if (tile.inView) inViewCapacityLag++;
        }
      }
    }
    this.stats.tiles = tiles;
    this.stats.visibleMissing = visibleMissing;
    this.stats.visibleCapacityLag = visibleCapacityLag;
    this.stats.inViewMissing = inViewMissing;
    this.stats.inViewCapacityLag = inViewCapacityLag;
    this.stats.stems = Object.values(this.stats.bands).reduce((sum, value) => sum + value, 0);
    this.batchDirty = this.batches.pending > 0;
  }

  getState() {
    return {
      ...this.stats,
      building: this.staleTiles.length + this.batches.pending,
      pendingPages: this.batches.pending,
      bands: { ...this.stats.bands },
      resident: this.tiles.size,
    };
  }

  dispose() {
    for (const tile of this.tiles.values()) this.releaseJob(tile);
    this.batches.dispose();
    this.tiles.clear();
    this.pools.clear();
  }
}
