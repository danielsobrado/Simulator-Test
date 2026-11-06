import {
  attachConstructionGrowth,
  buildModuleGrowth,
  buildModuleMasonry,
  mergeModuleMasonryBatches,
} from '../compile/ConstructionMasonryBuilder.js';
import { ConstructionGeometryWorkerClient } from '../compile/ConstructionGeometryWorkerClient.js';
import { decodeConstructionGeometry } from '../compile/ConstructionGeometryCodec.js';
import { createConstructionGroundPatch, advanceConstructionGroundPatch } from '../compile/ConstructionGroundPatch.js';

const DEFAULT_PLACEMENTS_PER_SLICE = 8;

function buildOptions(state) {
  return {
    record: state.record,
    materials: state.materials,
    arcTable: state.arcTable,
    moduleOrigin: state.moduleOrigin,
    groundHeightAt: state.groundHeightAt,
    pathInterval: state.pathInterval,
    lodBand: state.lodBand,
  };
}

export class ConstructionModuleBuilder {
  constructor({ terrainView, placementsPerSlice = DEFAULT_PLACEMENTS_PER_SLICE, geometryWorker = null }) {
    this.terrainView = terrainView;
    this.placementsPerSlice = Math.max(1, Math.floor(placementsPerSlice));
    this.geometryWorker = geometryWorker ?? ((typeof Worker === 'function' || typeof window !== 'undefined')
      ? new ConstructionGeometryWorkerClient() : null);
  }

  createState({
    key,
    record,
    materials,
    arcTable,
    moduleOrigin,
    pathInterval,
    lodBand,
    placements,
    terrainRevision,
    retainedGrowth = null,
    bounds = null,
    growthOnly = false,
    cachedMasonry = null,
  }) {
    return {
      key,
      record,
      materials,
      arcTable,
      moduleOrigin,
      pathInterval,
      lodBand,
      placements,
      terrainRevision,
      retainedGrowth,
      bounds,
      growthOnly: growthOnly || Boolean(cachedMasonry),
      cachedMasonry,
      cacheHit: Boolean(cachedMasonry),
      cancelled: false,
      workerStarted: false,
      workerProduct: null,
      workerError: null,
      groundPatch: null,
      groundHeightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z) ?? 0,
      offset: growthOnly || cachedMasonry ? placements.length : 0,
      batches: [],
      growth: retainedGrowth,
      ownsGrowth: false,
      growthPrepared: Boolean(retainedGrowth) || placements.length === 0 || !materials.growth,
      merged: false,
    };
  }

  advance(state) {
    if (state.cachedMasonry && state.growthPrepared) {
      const built = attachConstructionGrowth(state.cachedMasonry, state.growth);
      if (state.growth) state.growth.castShadow = state.lodBand !== 'coarse';
      state.cachedMasonry = null;
      state.ownsGrowth = false;
      return { done: true, built };
    }
    if (this.geometryWorker) return this.advanceWorker(state);
    if (state.offset < state.placements.length) {
      const end = Math.min(
        state.placements.length,
        state.offset + this.placementsPerSlice,
      );
      const slice = state.placements.slice(state.offset, end);
      state.batches.push(buildModuleMasonry(slice, {
        ...buildOptions(state),
        includeGrowth: false,
      }));
      state.offset = end;
      return { done: false, built: null };
    }

    if (!state.growthPrepared) {
      state.growth = buildModuleGrowth(state.placements, buildOptions(state));
      state.ownsGrowth = Boolean(state.growth);
      state.growthPrepared = true;
      return { done: false, built: null };
    }

    if (!state.merged) {
      const built = mergeModuleMasonryBatches(state.batches);
      state.batches.length = 0;
      if (state.growth) {
        state.growth.castShadow = state.lodBand !== 'coarse';
        attachConstructionGrowth(built, state.growth);
        state.ownsGrowth = false;
      }
      state.merged = true;
      return { done: true, built: this.complete(state, built) };
    }

    return { done: true, built: null };
  }

  advanceWorker(state) {
    if (state.workerError || this.geometryWorker.error) {
      if (!this.failureReported) {
        console.error('Construction detail is unavailable; retaining its shell.', state.workerError ?? this.geometryWorker.error);
        this.failureReported = true;
      }
      return { done: true, built: null };
    }
    if (state.workerProduct) {
      const built = decodeConstructionGeometry(state.workerProduct, state.materials);
      if (state.retainedGrowth) {
        state.retainedGrowth.castShadow = state.lodBand !== 'coarse';
        attachConstructionGrowth(built, state.retainedGrowth);
      }
      state.workerProduct = null;
      return { done: true, built: this.complete(state, built) };
    }
    if (state.workerStarted) return { done: false, built: null };
    if (!this.geometryWorker.available) return { done: false, built: null };
    state.groundPatch ??= createConstructionGroundPatch(state.bounds, state.record,
      this.terrainView.worldStore?.tileSize ?? 2);
    if (!advanceConstructionGroundPatch(state.groundPatch, this.terrainView)) return { done: false, built: null };
    state.workerStarted = true;
    this.geometryWorker.request({ record: state.record, placements: state.placements,
      moduleOrigin: state.moduleOrigin, pathInterval: state.pathInterval, lodBand: state.lodBand,
      includeGrowth: Boolean(state.materials.growth) && !state.retainedGrowth,
      growthOnly: state.growthOnly, groundPatch: state.groundPatch,
    }).then(product => {
      if (!state.cancelled) state.workerProduct = product;
    }, error => { if (!state.cancelled) state.workerError = error; });
    return { done: false, built: null };
  }

  shutdown() { this.geometryWorker?.dispose(); }

  complete(state, built) {
    if (!state.cachedMasonry) return built;
    const masonry = state.cachedMasonry;
    state.cachedMasonry = null;
    for (const mesh of built.meshes) attachConstructionGrowth(masonry, mesh);
    return masonry;
  }

  dispose(state) {
    if (!state) return;
    state.cancelled = true;
    state.workerProduct = null;
    for (const mesh of state.cachedMasonry?.meshes ?? []) mesh.geometry.dispose();
    state.cachedMasonry = null;
    for (const batch of state.batches ?? []) {
      for (const mesh of batch.meshes ?? []) mesh.geometry.dispose();
    }
    state.batches?.splice(0);
    if (state.ownsGrowth) state.growth?.geometry?.dispose();
    state.growth = null;
    state.ownsGrowth = false;
  }
}
