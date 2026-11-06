import { Frustum, Group, Matrix4, Sphere } from 'three/webgpu';
import { PerfCounters } from '../../../performance/qa/PerfCounters.js';
import { SettlementSurfaceLibrary } from '../surfaces/SettlementSurfaceLibrary.js';
import { SettlementPrototypePool } from './SettlementPrototypePool.js';
import { settlementDusk } from './SettlementDusk.js';
import { updateSettlementSunlight } from './SettlementWindowLight.js';
import { SettlementSite } from './SettlementSite.js';
import { SettlementSkyline } from './SettlementSkyline.js';
import { settlementPreparationStatus } from './SettlementPreparationStatus.js';
import { settlementPreparationFor } from '../SettlementPreparation.js';
import { settlementSelectionJob, placeSettlementRows, settlementSiteDrawn } from './SettlementSelection.js';

export const SETTLEMENT_VIEW = Object.freeze({
  /** Settlements whose edge is within this many metres of the camera are drawn. */
  siteRadius: 520,
  /** Leave margin, so a town on the boundary does not flicker in and out. */
  siteHysteresis: 60,
  maxSites: 3,
  /** New meshes shown per frame; each compiles a shader pipeline on its first draw. */
  revealsPerFrame: 2,
  /** Full-detail meshes inside `nearIn`; they hand over to the far tier past `nearOut`. */
  nearIn: 70,
  nearOut: 84,
  /** Street furniture is drawn only this close. */
  smallRange: 95,
  /**
   * Buildings of an adopted site draw out to here (props stop at `smallRange`). Wide
   * enough for a whole population-sized city seen from `siteRadius`, so a site draws
   * all of its town and the skyline can step aside for it (SettlementSkyline isDrawn).
   */
  farRange: 1500,
  fadeSeconds: 0.35,
  /** Metres the camera may move before levels of detail are re-chosen. */
  reselectMetres: 2,
  refreshMs: 500,
  /**
   * Radius, in metres, a placement is kept for round the view frustum. Generous
   * for buildings: one just off screen still throws its shadow into the street.
   */
  cullRadius: Object.freeze({ building: 34, small: 4 }),
  /** How far the camera may turn or move, as a change of its matrix, before culling is redone. */
  cullTolerance: 0.02,
  /** Frames a queued build may be starved of frame budget before it runs anyway. */
  starvationFrames: 2,
});

/**
 * Draws planned settlements: every building and prop of the plans near the
 * camera as instances of pooled workshop meshes, over paved streets.
 *
 * The plan itself is derived, never stored (see SettlementPlanner), so the view
 * holds nothing a save needs. Everything expensive is spread over frames — one
 * mesh variant, or one slice of paving, per frame — and a town fills in around
 * the player, nearest buildings first.
 */
export class SettlementView {
  /**
   * @param {() => number} [options.duskProvider] how far into evening the sky is, 0–1 (SettlementDusk)
   * @param {() => ?{ direction: object, color: object, intensity: number }} [options.sunlightProvider]
   *   the sky's key light (sun by day, moon by night), for the light through the rooms' windows
   */
  constructor({ terrainView, baseUrl = '/', enabled = true, duskProvider = () => 0, sunlightProvider = () => null }) {
    this.sunlightProvider = sunlightProvider;
    this.terrainView = terrainView;
    this.duskProvider = duskProvider;
    this.enabled = enabled;
    this.root = new Group();
    this.root.name = 'settlement-buildings';
    this.pavingRoot = new Group();
    this.pavingRoot.name = 'settlement-paving';
    terrainView.scene.add(this.root, this.pavingRoot);
    this.pool = new SettlementPrototypePool({ root: this.root, renderer: terrainView.renderer,
      getDrawPreparation: () => terrainView.drawPreparation });
    this.skyline = new SettlementSkyline({ scene: terrainView.scene,
      getDrawPreparation: () => terrainView.drawPreparation,
      isDrawn: id => settlementSiteDrawn(this, this.sites.get(id)) });
    this.library = new SettlementSurfaceLibrary({ renderer: terrainView.renderer, baseUrl });
    this.sites = new Map();
    this.preparation = settlementPreparationFor(terrainView.worldStore);
    this.plans = this.preparation.plans;
    this.registry = this.preparation.registry;
    this.unsubscribePreparation = this.preparation.subscribe(() => { this.nextRefresh = 0; this.dirty = true; });
    this.generator = null;
    this.origin = { x: 0, z: 0 };
    this.nextRefresh = 0;
    this.lastTimestamp = null;
    this.selected = { x: Infinity, z: Infinity };
    this.dirty = false;
    this.fading = false;
    this.starved = 0;
    this.rows = new Map();
    this.frustum = new Frustum();
    this.viewProjection = new Matrix4();
    this.culledWith = new Matrix4().makeScale(0, 0, 0);
    this.sphere = new Sphere();
    this.disposed = false;
    this.coverageEpoch = 0;
  }

  reset() {
    this.plans.release(this);
    for (const site of this.sites.values()) site.dispose();
    this.sites.clear();
    this.skyline.clear();
    this.pool.clear();
    this.rows.clear();
    this.selectionJob = null;
    this.nextRefresh = 0;
    this.dirty = true;
  }

  getPreparationStatus() { return settlementPreparationStatus(this); }
  hasPendingWork() {
    return this.enabled && !this.disposed && (Boolean(this.selectionJob) || this.skyline.pending > 0 || this.registry.pending > 0 || this.plans.pending > 0 || this.pool.pending > 0 || [...this.sites.values()]
      .some(site => site.job || (site.surfaces && !site.pavingReady)));
  }

  /** Adopt the settlements round `focus` (canonical metres) and drop the ones left behind. */
  refreshSites(focus, field = this.generator?.ensureSettlementField?.()) {
    const tileSize = this.terrainView.worldStore.tileSize;
    const near = field
      ? field.entriesNear(focus.x / tileSize, -focus.z / tileSize, (SETTLEMENT_VIEW.siteRadius + SETTLEMENT_VIEW.siteHysteresis) / tileSize)
      : [];
    const keep = new Set();
    for (const { entry, distance } of near) {
      if (keep.size >= SETTLEMENT_VIEW.maxSites) break;
      const id = entry.settlement.id;
      const edge = (distance - entry.reachCells) * tileSize;
      if (!this.sites.has(id) && edge > SETTLEMENT_VIEW.siteRadius) continue;
      keep.add(id);
      const plan = this.plans.get(entry, edge, this);
      if (!plan) continue;
      let ready = true;
      for (const { entry: neighbor } of field.entriesNear(entry.settlement.cellX, entry.settlement.cellZ, entry.reachCells)) {
        if (!this.plans.get(neighbor, edge, this) || !neighbor.index) ready = false;
      }
      if (!ready) continue;
      if (this.sites.has(id)) continue;
      const site = new SettlementSite({ entry, plan, generator: this.generator, tileSize,
        library: this.library, getDrawPreparation: () => this.terrainView.drawPreparation });
      this.pavingRoot.add(site.paving);
      this.sites.set(id, site);
      this.selectionJob = null;
      this.dirty = true;
    }
    let left = false;
    for (const [id, site] of this.sites) {
      if (keep.has(id)) continue;
      site.dispose();
      this.sites.delete(id);
      left = true;
    }
    if (!left) return;
    this.selectionJob = null;
    // Meshes are pooled per dressing and style; keep the ones a town in view still wears.
    const prefixes = [...this.sites.values()].map((site) => site.poolPrefix);
    this.pool.prune((key) => prefixes.some((prefix) => key.startsWith(prefix)));
    this.dirty = true;
  }

  /** One slice of deferred work: site preparation first, then a mesh variant. */
  advanceWork(shouldYield) {
    // Terrain and scenery streaming can spend the whole deferred budget every
    // frame while a city loads; after `starvationFrames` of that, one unit runs anyway.
    const starving = shouldYield();
    if (starving && ++this.starved < SETTLEMENT_VIEW.starvationFrames) return;
    this.starved = 0;
    let forced = 0;
    const yieldNow = starving ? () => forced++ > 0 : shouldYield;
    this.plans.advance(yieldNow);
    if (yieldNow()) return;
    this.skyline.advance(yieldNow);
    if (yieldNow()) return;
    // A starved slice still does one unit, then stops.
    let units = 0;
    const gate = () => units++ > 0 && yieldNow();
    for (const site of this.sites.values()) {
      if (site.job) {
        const started = performance.now();
        if (site.advance(gate)) this.dirty = true;
        PerfCounters.inc('settlementPreparationCpuMs', performance.now() - started);
        return;
      }
      if (!site.pavingReady && site.surfaces) {
        const started = performance.now();
        if (site.installPaving(gate)) this.dirty = true;
        PerfCounters.inc('settlementInstallationCpuMs', performance.now() - started);
        return;
      }
    }
    if (this.pool.advance()) this.dirty = true;
  }

  /**
   * The nearest adopted town as a listener hears it: metres to its centre, its
   * radius and rank, and metres to its nearest smithy. Null out of earshot.
   */
  nearestTown(focus) {
    let nearest = null;
    for (const site of this.sites.values()) {
      const distance = Math.hypot(site.centre.x - focus.x, site.centre.z - focus.z);
      if (!nearest || distance < nearest.distance) nearest = { distance, site };
    }
    if (!nearest) return null;
    const { site, distance } = nearest;
    let smithy = Infinity;
    for (const { x, z } of site.smithies) smithy = Math.min(smithy, Math.hypot(x - focus.x, z - focus.z));
    return { distance, radius: site.plan.profile.radius, rank: site.plan.profile.rank, smithy };
  }

  /** Whether a placement, or the shadow it throws, can reach the view frustum. */
  inView(placement) {
    const radius = placement.small ? SETTLEMENT_VIEW.cullRadius.small : SETTLEMENT_VIEW.cullRadius.building;
    this.sphere.center.set(placement.x - this.origin.x, placement.y, placement.z - this.origin.z);
    this.sphere.radius = radius;
    return this.frustum.intersectsSphere(this.sphere);
  }

  /**
   * Point the culling frustum at `camera`. Returns whether the view moved enough
   * since the last cull that the visible set must be chosen again.
   */
  aim(camera) {
    this.culls = Boolean(camera);
    if (!camera) return false;
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    const now = camera.matrixWorld.elements;
    const then = this.culledWith.elements;
    let change = 0;
    for (let index = 0; index < 12; index += 1) change = Math.max(change, Math.abs(now[index] - then[index]));
    // Position is in metres, rotation in unit vectors: weigh a metre like a degree or so.
    for (let index = 12; index < 15; index += 1) change = Math.max(change, Math.abs(now[index] - then[index]) * 0.02);
    if (change <= SETTLEMENT_VIEW.cullTolerance) return false;
    this.culledWith.copy(camera.matrixWorld);
    return true;
  }

  /**
   * @param {{ x: number, z: number }} focus what the view is centred on, in canonical metres
   * @param {number} timestamp frame time in milliseconds
   * @param {() => boolean} shouldYield whether this frame's deferred budget is spent
   * @param {?THREE.Camera} camera the active camera, in render space; placements outside its view are not drawn
   */
  update(focus, timestamp, shouldYield = () => false, camera = null) {
    if (this.disposed) return;
    this.root.visible = this.enabled;
    this.pavingRoot.visible = this.enabled;
    this.skyline.root.visible = this.enabled;
    if (!this.enabled) return;
    const view = this.terrainView;
    const generator = view.worldStore.generator;
    if (generator !== this.generator) {
      this.generator = generator;
      this.reset();
    }
    const origin = view.floatingOrigin.readState?.(this.origin) ?? Object.assign(this.origin, view.floatingOrigin.getState());
    settlementDusk.value = this.duskProvider();
    const sunlight = this.sunlightProvider();
    if (sunlight) updateSettlementSunlight(sunlight);

    if (timestamp >= this.nextRefresh) {
      this.nextRefresh = timestamp + SETTLEMENT_VIEW.refreshMs;
      const field = this.preparation.field(generator);
      this.plans.begin(this);
      this.refreshSites(focus, field);
      this.skyline.refresh(field, focus, view.worldStore.tileSize, entry => this.plans.get(entry,
        Math.hypot(entry.settlement.cellX * view.worldStore.tileSize - focus.x,
          -entry.settlement.cellZ * view.worldStore.tileSize - focus.z), this));
      this.plans.end();
    }
    const moved = Math.hypot(focus.x - this.selected.x, focus.z - this.selected.z) > SETTLEMENT_VIEW.reselectMetres;
    const turned = this.aim(camera);
    if (moved || turned) { this.coverageEpoch++; this.dirty = true; }
    this.skyline.update(focus, origin);
    if (this.sites.size === 0 && this.rows.size === 0 && this.plans.pending === 0 && this.registry.pending === 0 && this.skyline.pending === 0) return;

    const started = performance.now();
    this.pool.reveal(SETTLEMENT_VIEW.revealsPerFrame, camera, view.scene);
    this.advanceWork(shouldYield);
    for (const site of this.sites.values()) {
      // Textures arrive between frames; the first frame that has them re-selects.
      if (site.surfaces && !site.dressed) {
        site.dressed = true;
        this.dirty = true;
      }
      site.paving.position.set(site.centre.x - origin.x, 0, site.centre.z - origin.z);
    }
    if (!this.selectionJob && (this.dirty || this.fading || moved || turned)) {
      this.selectionJob = settlementSelectionJob(this, { ...focus }, timestamp, SETTLEMENT_VIEW);
      this.selected.x = focus.x; this.selected.z = focus.z;
      this.dirty = false;
    }
    // At least one slice (SettlementSelection SLICE placements) a frame: run only on
    // spare budget, a capital's selection got none for a minute while the terrain
    // streamed, and the player stood among stand-in boxes the whole time.
    let steps = 0;
    while (this.selectionJob && (steps === 0 || !shouldYield())) {
      steps += 1;
      const step = this.selectionJob.next();
      if (step.done) { this.selectionJob = null; this.fading = step.value; }
    }
    placeSettlementRows(this);
    PerfCounters.inc('settlementViewCpuMs', performance.now() - started);
  }

  dispose() {
    this.disposed = true;
    this.unsubscribePreparation();
    this.reset();
    this.pool.dispose();
    this.skyline.dispose();
    this.library.dispose();
    this.root.removeFromParent();
    this.pavingRoot.removeFromParent();
  }
}
