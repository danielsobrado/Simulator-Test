import {
  projectedPixelHeight,
  quantizeFade,
  selectProjectedLod,
  updateLodTransition,
} from './stylized/lod/projectedLod.js';

const SOURCE_TO_OBJECT_BAND = Object.freeze({
  near: 'near',
  proxy: 'coarse',
  impostor: 'shell',
  cluster: 'shell',
  culled: 'culled',
});

const OBJECT_TO_SOURCE_BAND = Object.freeze({
  near: 'near',
  coarse: 'proxy',
  shell: 'impostor',
});

function cameraSignature(camera, viewportHeight) {
  const values = [
    camera.position.x, camera.position.y, camera.position.z,
    camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w,
    camera.zoom ?? 1, camera.fov ?? 0, viewportHeight,
  ];
  return values.map((value, index) => {
    const scale = index < 3 ? 2 : index < 7 ? 1000 : 10;
    return Math.round(value * scale);
  }).join(':');
}

function stableSeed(id) {
  let hash = Math.imul(Number(id) || 1, 0x9e3779b1) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

export class ObjectLodController {
  constructor({
    nearPixels = 140,
    coarsePixels = 35,
    hysteresisRatio = 0.15,
    transitionMs = 240,
    fadeSteps = 16,
  } = {}) {
    this.thresholds = {
      nearPixels,
      proxyPixels: coarsePixels,
      impostorPixels: 0,
      clusterPixels: 0,
      hysteresisRatio,
    };
    this.transitionMs = transitionMs;
    this.fadeSteps = fadeSteps;
    this.states = new Map();
    this.lastCameraSignature = null;
    this.lastSelectedObjectId = null;
    this.lastPlan = null;
    this.transitioning = false;
  }

  clear() {
    this.states.clear();
    this.lastCameraSignature = null;
    this.lastSelectedObjectId = null;
    this.lastPlan = null;
    this.transitioning = false;
  }

  seed(placements, band = 'near', timestamp = 0) {
    const sourceBand = OBJECT_TO_SOURCE_BAND[band] ?? 'near';
    for (const placement of placements) {
      this.states.set(placement.object.id, {
        from: sourceBand,
        target: sourceBand,
        startedAt: timestamp,
        complete: true,
        representations: Object.freeze([Object.freeze({
          band: sourceBand,
          fade: 1,
          ditherDirection: 1,
        })]),
      });
    }
  }

  plan({
    placements,
    camera,
    viewportHeight,
    timestamp,
    selectedObjectId = null,
    force = false,
  }) {
    const nextCameraSignature = cameraSignature(camera, viewportHeight);
    if (!force && !this.transitioning
      && nextCameraSignature === this.lastCameraSignature
      && selectedObjectId === this.lastSelectedObjectId
      && this.lastPlan) {
      return this.lastPlan;
    }

    const buckets = { near: [], coarse: [], shell: [] };
    const activeIds = new Set();
    let transitions = 0;
    for (const placement of placements) {
      activeIds.add(placement.object.id);
      const previousState = this.states.get(placement.object.id) ?? null;
      const previousObjectBand = SOURCE_TO_OBJECT_BAND[previousState?.target] ?? null;
      const pixels = projectedPixelHeight({
        camera,
        worldPosition: placement.worldPosition,
        worldHeight: placement.worldHeight,
        viewportHeight,
      });
      const targetObjectBand = placement.object.id === selectedObjectId
        ? 'near'
        : SOURCE_TO_OBJECT_BAND[selectProjectedLod({
          pixels,
          previous: previousObjectBand ? OBJECT_TO_SOURCE_BAND[previousObjectBand] : null,
          ...this.thresholds,
        })];
      const target = OBJECT_TO_SOURCE_BAND[targetObjectBand] ?? 'impostor';
      const state = updateLodTransition({
        state: previousState,
        target,
        timestamp,
        durationMs: this.transitionMs,
      });
      this.states.set(placement.object.id, state);
      if (!state.complete) transitions += 1;
      for (const representation of state.representations) {
        const band = SOURCE_TO_OBJECT_BAND[representation.band];
        if (!buckets[band]) continue;
        buckets[band].push({
          matrix: placement.matrix,
          fade: representation.fade,
          ditherDirection: representation.ditherDirection ?? 1,
          quantizedFade: quantizeFade(representation.fade, this.fadeSteps),
          seed: stableSeed(placement.object.id),
          objectId: placement.object.id,
        });
      }
    }
    for (const id of this.states.keys()) {
      if (!activeIds.has(id)) this.states.delete(id);
    }

    const signatures = {};
    for (const [band, instances] of Object.entries(buckets)) {
      signatures[band] = instances.map((instance) => (
        `${instance.objectId}:${instance.quantizedFade}:${instance.ditherDirection}`
      )).join('|');
    }
    this.transitioning = transitions > 0;
    this.lastCameraSignature = nextCameraSignature;
    this.lastSelectedObjectId = selectedObjectId;
    this.lastPlan = Object.freeze({
      buckets,
      signatures: Object.freeze(signatures),
      transitions,
    });
    return this.lastPlan;
  }
}
