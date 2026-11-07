import { CubeCamera, CubeRenderTarget, HalfFloatType, LinearFilter, RenderTarget, Vector3 } from 'three/webgpu';
import { abs, cubeTexture, distance, float, mix, positionWorld, smoothstep, texture, uniform, vec2 } from 'three/tsl';
import { PerfCounters } from '../../editor/performance/qa/PerfCounters.js';
import { withReflectionCapture } from './ReflectionCapture.js';
import { ReflectionShadowRegistry } from './ReflectionShadowRegistry.js';
import { ReflectionCaptureSchedule } from './ReflectionCaptureSchedule.js';
import { preparePlanarCamera } from './PlanarCamera.js';
import { PlanarReprojection } from './PlanarReprojection.js';
import { withAuxiliaryScene } from './ReflectionScene.js';
import { isLandStreamingSuspended } from '../../editor/water/underwaterState.js';
import { filteredWaterCube, filteredWaterPlanar } from './WaterReflectionFilter.js';

const OVERLAY_REFRESH_CAPTURES = 32;

/** Fixed-size local capture pool, owned by the scene rather than by water chunks. */
export class WaterReflectionController {
  constructor(terrainView, config) {
    this.view = terrainView;
    this.config = config;
    this.targets = [0, 1].map(() => new CubeRenderTarget(config.resolution, { type: HalfFloatType, minFilter: LinearFilter, generateMipmaps: false }));
    this.front = 0;
    this.cubeCamera = new CubeCamera(0.5, config.reachMeters * 3, this.targets[1]);
    this.cube = cubeTexture(this.targets[0].texture);
    this.valid = uniform(0);
    this.origin = uniform(new Vector3());
    this.planarTarget = config.planar ? new RenderTarget(config.resolution * 2, config.resolution, { type: HalfFloatType, minFilter: LinearFilter, generateMipmaps: false }) : null;
    this.planar = this.planarTarget ? texture(this.planarTarget.texture) : null;
    this.reprojection = new PlanarReprojection();
    this.planarMatrix = this.reprojection.viewProjection;
    this.planarHeight = uniform(0);
    this.planarValid = this.reprojection.valid;
    this.canonicalProbe = { x: 0, z: 0 };
    this.pendingProbe = { x: 0, z: 0 };
    this.hasCanonicalProbe = false;
    this.face = 0;
    this.nextCapture = 0;
    this.lastPlanar = -Infinity;
    this.lastCube = -Infinity;
    this.sceneRevisionState = new Float64Array(4);
    this.sceneRevisionState.fill(Number.NaN);
    this.disposed = false;
    this.capturing = false;
    this.wetSlots = [];
    this.hiddenObjects = [];
    this.overlayObjects = [];
    this.overlaySceneChildCount = -1;
    this.overlayRefreshCountdown = 0;
    this.planarWetSlots = [];
    this.preparedState = { origin: null, canonical: { x: 0, z: 0 }, wet: this.wetSlots };
    this.shadowRegistry = terrainView.scene ? new ReflectionShadowRegistry(terrainView.scene) : null;
    this.captureScratch = { states: [], shadows: [], shadowOwners: this.shadowRegistry?.owners };
    this.originScratch = { x: 0, z: 0 };
    this.lastCaptureCpuMs = 0;
    this.captureSchedule = new ReflectionCaptureSchedule(config);
  }

  get captureBudgetMs() { return this.captureSchedule.budgetMs(this.planarPending ? 'planar' : 'cube'); }

  sample(direction, fallback, allowPlanar = float(1), distortion = vec2(0), roughness = float(0)) {
    const local = this.valid.mul(smoothstep(this.config.reachMeters * 0.7, this.config.reachMeters,
      distance(positionWorld, this.origin)).oneMinus());
    const cube = this.config.roughnessFiltering === false ? this.cube.sample(direction).rgb
      : filteredWaterCube(this.cube, direction, roughness);
    let result = mix(fallback, cube, local);
    if (this.planar) {
      const { uv, weight: projectionWeight } = this.reprojection.uvNode();
      const weight = projectionWeight.mul(local).mul(allowPlanar)
        .mul(smoothstep(0.1, 0.3, abs(positionWorld.y.sub(this.planarHeight))).oneMinus());
      const point = uv.add(distortion);
      const planar = this.config.roughnessFiltering === false ? this.planar.sample(point.clamp(0, 1)).rgb
        : filteredWaterPlanar(this.planar, point, roughness, this.config.resolution);
      result = mix(result, planar, weight);
    }
    return result;
  }

  getDiagnostics(now = performance.now()) {
    return { cubeValid: this.valid.value, planarValid: this.planarValid.value,
      cubeAgeMs: Number.isFinite(this.lastCube) ? now - this.lastCube : null,
      planarAgeMs: Number.isFinite(this.lastPlanar) ? now - this.lastPlanar : null,
      facePending: this.face, canonicalProbe: { ...this.canonicalProbe },
      poolTargets: this.targets.length + (this.planarTarget ? 1 : 0),
      captureFrameStride: this.captureSchedule.stride, captureBudgetEstimateMs: this.captureBudgetMs,
      lastCaptureCpuMs: this.lastCaptureCpuMs,
      roughnessFiltering: this.config.roughnessFiltering !== false };
  }

  invalidate() {
    this.valid.value = 0;
    this.planarValid.value = 0;
    this.face = 0;
    this.nextCapture = 0;
    this.lastPlanar = -Infinity;
    this.hasCanonicalProbe = false;
    this.planarPending = false;
  }

  // Validity must follow world/camera changes even when no capture work fits.
  prepare(camera, surface) {
    if (this.disposed || this.capturing) return;
    if (isLandStreamingSuspended()) { this.invalidate(); return; }
    if (this.planarValid.value && camera.position.y <= this.planarHeight.value + 0.1) this.planarValid.value = 0;
    const origin = this.view.floatingOrigin.readState?.(this.originScratch)
      ?? this.view.floatingOrigin.getState();
    if (this.generator !== this.view.worldStore.generator || this.lastOrigin?.x !== origin.x || this.lastOrigin?.z !== origin.z) {
      this.invalidate();
      this.generator = this.view.worldStore.generator;
      this.lastOrigin ??= { x: 0, z: 0 };
      this.lastOrigin.x = origin.x;
      this.lastOrigin.z = origin.z;
    }
    const canonical = this.preparedState.canonical;
    canonical.x = camera.position.x + origin.x;
    canonical.z = camera.position.z + origin.z;
    const sceneRevision = this.sceneRevisionState;
    const worldRevision = this.view.worldStore.revision ?? 0;
    const surfaceRevision = surface.revisionTracker?.revision ?? 0;
    const objectRevision = surface.objectMap?.revision ?? 0;
    const constructionRevision = this.revisionProvider?.() ?? 0;
    if (sceneRevision[0] !== worldRevision
        || sceneRevision[1] !== surfaceRevision
        || sceneRevision[2] !== objectRevision
        || sceneRevision[3] !== constructionRevision) {
      this.invalidate();
      sceneRevision[0] = worldRevision;
      sceneRevision[1] = surfaceRevision;
      sceneRevision[2] = objectRevision;
      sceneRevision[3] = constructionRevision;
    }
    const wet = this.wetSlots;
    wet.length = 0;
    let nearby = false;
    for (const slot of surface.waterSlots) {
      if (!slot.hasWaterCoverage || !slot.terrainSlot.descriptor) continue;
      wet.push(slot);
      const d = slot.terrainSlot.descriptor;
      if (Math.hypot(d.centerWorldX - canonical.x, d.centerWorldZ - canonical.z)
        < this.config.reachMeters + this.view.chunkWorldSize) nearby = true;
    }
    if (!nearby) { this.invalidate(); return; }
    if (this.hasCanonicalProbe && (Math.hypot(canonical.x - this.canonicalProbe.x, canonical.z - this.canonicalProbe.z) > this.config.reachMeters * 0.5
      || Math.abs(camera.position.y - this.probeY) > this.config.reachMeters * 0.2)) this.invalidate();
    if (this.hasCanonicalProbe) {
      this.origin.value.set(
        this.canonicalProbe.x - origin.x,
        this.probeY,
        this.canonicalProbe.z - origin.z,
      );
    }
    this.preparedState.origin = origin;
    return this.preparedState;
  }

  update(camera, surface, now = performance.now(), { budgetReserved = false, prepared = null } = {}) {
    const state = prepared ?? this.prepare(camera, surface);
    if (!state) return;
    const { origin, canonical, wet } = state;
    if (now < this.nextCapture) return;
    if (!budgetReserved && surface.shouldYieldWork?.()) return;
    const hidden = this.hiddenObjects;
    hidden.length = 0;
    for (const slot of surface.waterSlots) hidden.push(slot.mesh);
    this.refreshOverlayObjects();
    for (const object of this.overlayObjects) hidden.push(object);
    const started = performance.now();
    const captureKind = this.planarPending ? 'planar' : 'cube';
    this.capturing = true;
    try {
      withReflectionCapture(this.view.renderer, this.view.scene, hidden, () => {
        if (this.planarPending) {
          this.capturePlanar(camera, wet, origin, now, surface);
          this.planarPending = false;
          this.nextCapture = now + this.config.intervalMs;
          return;
        }
        if (this.face === 0) {
          this.pendingProbe.x = canonical.x;
          this.pendingProbe.z = canonical.z;
          this.pendingProbeY = camera.position.y;
          this.cubeCamera.position.set(camera.position.x, camera.position.y, camera.position.z);
          this.cubeCamera.coordinateSystem = this.view.renderer.coordinateSystem;
          this.cubeCamera.updateCoordinateSystem();
          this.cubeCamera.updateMatrixWorld();
        }
        const back = this.targets[1 - this.front];
        this.view.renderer.setRenderTarget(back, this.face);
        const captureCamera = this.cubeCamera.children[this.face];
        withAuxiliaryScene(surface, captureCamera, origin, now, () => this.view.renderer.render(this.view.scene, captureCamera));
        this.face += 1;
        PerfCounters.inc('waterProbeFaces');
        if (this.face === 6) {
          this.lastCube = now;
          this.front = 1 - this.front;
          this.cube.value = this.targets[this.front].texture;
          this.canonicalProbe.x = this.pendingProbe.x;
          this.canonicalProbe.z = this.pendingProbe.z;
          this.hasCanonicalProbe = true;
          this.probeY = this.pendingProbeY;
          this.valid.value = 1;
          this.origin.value.set(this.canonicalProbe.x - origin.x, this.probeY, this.canonicalProbe.z - origin.z);
          this.face = 0;
          this.nextCapture = now + this.config.intervalMs;
          this.planarPending = Boolean(this.planarTarget);
        }
      }, this.captureScratch);
    } finally {
      this.capturing = false;
      this.lastCaptureCpuMs = performance.now() - started;
      this.captureSchedule.record(captureKind, this.lastCaptureCpuMs);
      PerfCounters.inc('waterReflectionCpuMs', this.lastCaptureCpuMs);
      PerfCounters.set('waterReflectionBudgetEstimateMs', this.captureBudgetMs);
    }
  }

  refreshOverlayObjects() {
    const scene = this.view.scene;
    const childCount = scene.children.length;
    this.overlayRefreshCountdown -= 1;
    if (childCount === this.overlaySceneChildCount && this.overlayRefreshCountdown > 0) return;
    this.overlaySceneChildCount = childCount;
    this.overlayRefreshCountdown = OVERLAY_REFRESH_CAPTURES;
    this.overlayObjects.length = 0;
    scene.traverse((object) => {
      if (object.userData?.editorOverlay || object.name?.includes('grid-overlay')) {
        this.overlayObjects.push(object);
      }
    });
  }

  capturePlanar(camera, wet, origin, now, surface) {
    if (!this.planarTarget || now - this.lastPlanar < this.config.intervalMs) return;
    const ordered = this.planarWetSlots;
    ordered.length = 0;
    for (const slot of wet) ordered.push(slot);
    const cameraX = origin.x + camera.position.x;
    const cameraZ = origin.z + camera.position.z;
    ordered.sort((a, b) => {
      const left = a.terrainSlot.descriptor;
      const right = b.terrainSlot.descriptor;
      const leftX = left.centerWorldX - cameraX;
      const leftZ = left.centerWorldZ - cameraZ;
      const rightX = right.centerWorldX - cameraX;
      const rightZ = right.centerWorldZ - cameraZ;
      return leftX * leftX + leftZ * leftZ - (rightX * rightX + rightZ * rightZ);
    });
    const candidateCount = Math.min(4, ordered.length);
    for (let index = 0; index < candidateCount; index += 1) {
      const slot = ordered[index];
      const d = slot.terrainSlot.descriptor;
      const water = this.view.getCanonicalWater(d.centerWorldX, d.centerWorldZ);
      if (![1, 2].includes(water.kind) || water.coverage < 0.5 || camera.position.y <= water.surfaceHeight + 0.1) continue;
      const virtual = preparePlanarCamera(camera, water.surfaceHeight, this.virtualCamera);
      this.virtualCamera = virtual;
      this.view.renderer.setRenderTarget(this.planarTarget);
      withAuxiliaryScene(surface, virtual, origin, now, () => this.view.renderer.render(this.view.scene, virtual));
      this.reprojection.record(virtual);
      this.planarHeight.value = water.surfaceHeight;
      this.lastPlanar = now;
      PerfCounters.inc('waterPlanarCaptures');
      return;
    }
    this.planarValid.value = 0;
  }

  dispose() { this.disposed = true; this.invalidate(); this.shadowRegistry?.dispose(); for (const target of this.targets) target.dispose(); this.planarTarget?.dispose(); }

  prewarm(camera, surface) {
    const now = performance.now();
    for (let pass = 0; pass < (this.planarTarget ? 7 : 6); pass++) this.update(camera, surface, now + pass * (this.config.intervalMs + 1));
    this.nextCapture = performance.now() + this.config.intervalMs;
    this.lastPlanar = performance.now();
  }
}
