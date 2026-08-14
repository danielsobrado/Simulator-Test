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

const OBJECT_BANDS = Object.freeze(['near', 'coarse', 'shell']);
const CAMERA_STATE_SIZE = 10;

function writeCameraState(camera, viewportHeight, target) {
  const position = camera.position;
  const quaternion = camera.quaternion;
  target[0] = Math.round(position.x * 2);
  target[1] = Math.round(position.y * 2);
  target[2] = Math.round(position.z * 2);
  target[3] = Math.round(quaternion.x * 1000);
  target[4] = Math.round(quaternion.y * 1000);
  target[5] = Math.round(quaternion.z * 1000);
  target[6] = Math.round(quaternion.w * 1000);
  target[7] = Math.round((camera.zoom ?? 1) * 10);
  target[8] = Math.round((camera.fov ?? 0) * 10);
  target[9] = Math.round(viewportHeight * 10);
}

function cameraStatesEqual(left, right) {
  for (let index = 0; index < CAMERA_STATE_SIZE; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function bandSignature(instances) {
  let signature = '';
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    if (index > 0) signature += '|';
    signature += `${instance.objectId}:${instance.quantizedFade}:${instance.ditherDirection}`;
  }
  return signature;
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
    this.seeds = new Map();
    this.activeIds = new Set();
    this.cameraState = new Float64Array(CAMERA_STATE_SIZE);
    this.lastCameraState = new Float64Array(CAMERA_STATE_SIZE);
    this.hasLastCameraState = false;
    this.lastSelectedObjectId = null;
    this.lastPlan = null;
    this.transitioning = false;
  }

  clear() {
    this.states.clear();
    this.seeds.clear();
    this.activeIds.clear();
    this.hasLastCameraState = false;
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
    writeCameraState(camera, viewportHeight, this.cameraState);
    const cameraUnchanged = this.hasLastCameraState
      && cameraStatesEqual(this.cameraState, this.lastCameraState);
    if (!force && !this.transitioning
      && cameraUnchanged
      && selectedObjectId === this.lastSelectedObjectId
      && this.lastPlan) {
      return this.lastPlan;
    }

    const buckets = { near: [], coarse: [], shell: [] };
    const activeIds = this.activeIds;
    activeIds.clear();
    let transitions = 0;
    for (const placement of placements) {
      const objectId = placement.object.id;
      activeIds.add(objectId);
      const previousState = this.states.get(objectId) ?? null;
      const previousObjectBand = SOURCE_TO_OBJECT_BAND[previousState?.target] ?? null;
      const pixels = projectedPixelHeight({
        camera,
        worldPosition: placement.worldPosition,
        worldHeight: placement.worldHeight,
        viewportHeight,
      });
      const targetObjectBand = objectId === selectedObjectId
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
      this.states.set(objectId, state);
      if (!state.complete) transitions += 1;

      let seed = this.seeds.get(objectId);
      if (seed === undefined) {
        seed = stableSeed(objectId);
        this.seeds.set(objectId, seed);
      }
      for (const representation of state.representations) {
        const band = SOURCE_TO_OBJECT_BAND[representation.band];
        if (!buckets[band]) continue;
        buckets[band].push({
          matrix: placement.matrix,
          fade: representation.fade,
          ditherDirection: representation.ditherDirection ?? 1,
          quantizedFade: quantizeFade(representation.fade, this.fadeSteps),
          seed,
          objectId,
        });
      }
    }
    for (const id of this.states.keys()) {
      if (activeIds.has(id)) continue;
      this.states.delete(id);
      this.seeds.delete(id);
    }

    const signatures = {};
    for (const band of OBJECT_BANDS) {
      signatures[band] = bandSignature(buckets[band]);
    }
    this.transitioning = transitions > 0;
    this.lastCameraState.set(this.cameraState);
    this.hasLastCameraState = true;
    this.lastSelectedObjectId = selectedObjectId;
    this.lastPlan = Object.freeze({
      buckets,
      signatures: Object.freeze(signatures),
      transitions,
    });
    return this.lastPlan;
  }
}
