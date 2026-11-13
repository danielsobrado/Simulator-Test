import { InstanceLodRows } from '../../../stylized/lod/InstanceLodRows.js';
import { InstanceAnchor } from '../../../stylized/lod/InstanceAnchor.js';
import { writeInstances } from '../../../stylized/lod/StylizedLodRuntime.js';
import { PerfCounters } from '../../../performance/qa/PerfCounters.js';

const SLICE = 32;
let passes = 0;

/** A paved site is not a replacement for its still-loading building silhouettes. */
export function settlementSiteDrawn(view, site) {
  const coverage = site?.buildingCoverage;
  if (!site?.surfaces || site.job || !site.pavingReady || !coverage?.complete
      || coverage.epoch !== (view.coverageEpoch ?? 0)) return false;
  for (const [key, bands] of coverage.required) {
    const entry = view.pool.get(key);
    if (!entry) return false;
    for (const band of bands) {
      const tier = entry[band];
      if (!tier || tier.publication || !tier.meshes.every(mesh => mesh.parent === view.root && mesh.visible && mesh.count > 0)) return false;
    }
  }
  return true;
}

function publish(view, key, changes) {
  const rows = view.rows.get(key);
  if (!rows || rows.entry.state !== 'ready') { view.rows.delete(key); return; }
  const plan = rows.storage.patch(changes, 0);
  const x = rows.anchor.x, z = rows.anchor.z;
  rows.anchor.follow(view.origin);
  const rebased = x !== rows.anchor.x || z !== rows.anchor.z;
  for (const band of ['near', 'far']) {
    if (band === 'far' && !rows.entry.far) continue;
    const instances = plan.buckets[band];
    const tier = view.pool.tier(rows.entry, band, instances.length);
    const previous = rows.published[band];
    if (rebased || previous?.tier !== tier || previous.version !== plan.signatures[band]) {
      const partial = !rebased && previous?.tier === tier && previous.version === plan.baseVersions[band];
      writeInstances([tier.meshes], [instances], rows.anchor, partial ? [plan.changedRows[band]] : null);
      rows.published[band] = { tier, version: plan.signatures[band] };
      const anchor = rows.tiers.get(tier) ?? new InstanceAnchor();
      anchor.x = rows.anchor.x; anchor.z = rows.anchor.z; rows.tiers.set(tier, anchor);
    }
    for (const mesh of tier.meshes) rows.tiers.get(tier).place(mesh, view.origin);
  }
}

/** Bounded classification and row publication. Unvisited placements keep their
 * last complete instance; no whole-town buffer comparison on every fade frame. */
export function* settlementSelectionJob(view, focus, timestamp, settings) {
  // Rows remember the pass that last saw each id: a per-pass set of ids was garbage on every placement.
  const pass = ++passes, pending = new Map();
  const epoch = view.coverageEpoch ?? 0;
  let fading = false, shown = 0, buildings = 0, props = 0, units = 0;
  const flush = function* () {
    for (const [key, changes] of pending) { publish(view, key, changes); yield; }
    pending.clear();
  };
  for (const site of view.sites.values()) {
    if (!site.surfaces) continue;
    const coverage = { epoch, complete: Boolean(site.placements) && !site.job, required: new Map() };
    const source = { style: site.plan.profile.style, kind: '', variant: 0, surfaces: site.surfaces };
    const placements = site.placements ?? [];
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      const id = placement.objectId ??= `${site.id}:${index}`, distance = Math.hypot(placement.x - focus.x, placement.z - focus.z);
      const range = placement.small ? settings.smallRange : settings.farRange;
      const inView = !view.culls || view.inView(placement);
      const needsCoverage = index < site.plan.buildings.length && distance < range && inView;
      // Elapsed wall time per placement keeps fade speed independent of how
      // many frames the town's classification needs.
      const fadeStep = placement.selectedAt === undefined ? 0
        : Math.max(0, Math.min(settings.fadeSeconds, (timestamp - placement.selectedAt) / 1000)) / settings.fadeSeconds;
      placement.selectedAt = timestamp;
      let entry = null;
      if (distance <= range + 20 || placement.shown > 0) {
        source.kind = placement.kind; source.variant = placement.variant;
        entry = view.pool.request(placement.key, source, distance);
      }
      if (entry?.state === 'ready') {
        const wantNear = !entry.far || distance < (placement.blend > .5 ? settings.nearOut : settings.nearIn);
        const blend = Math.max(0, Math.min(1, placement.blend + (wantNear ? fadeStep : -fadeStep)));
        const visible = Math.max(0, Math.min(1, placement.shown + (distance < range ? fadeStep : -fadeStep)));
        fading ||= blend !== placement.blend || visible !== placement.shown;
        // A newly prepared placement must get a second evaluation to start its fade.
        fading ||= visible < 1 && distance < range;
        placement.blend = blend; placement.shown = visible;
        let rows = view.rows.get(placement.key);
        if (!rows) {
          rows = { entry, storage: new InstanceLodRows(['near', 'far']), anchor: new InstanceAnchor(), published: {}, tiers: new Map(),
            seenAt: new Map() };
          view.rows.set(placement.key, rows);
        }
        rows.entry = entry;
        rows.seenAt.set(id, pass);
        const drawn = visible > 0 && inView;
        const nearFade = drawn ? visible * blend : 0, farFade = drawn && entry.far ? visible * (1 - blend) : 0;
        if (drawn) {
          if (needsCoverage && (nearFade > 0 || farFade > 0)) {
            if (!coverage.required.has(placement.key)) coverage.required.set(placement.key, new Set());
            if (nearFade > 0) coverage.required.get(placement.key).add('near');
            if (farFade > 0) coverage.required.get(placement.key).add('far');
          }
          shown++; if (index < site.plan.buildings.length) buildings++; else props++;
        }
        // Every ready key is still published each pass (its anchor follows the origin there),
        // but a placement whose rows would compare equal sends no change and allocates nothing.
        if (!pending.has(placement.key)) pending.set(placement.key, new Map());
        const sent = placement.sent ??= { rows: null, near: 0, far: 0, nearMatrix: null, farMatrix: null };
        if (sent.rows !== rows || sent.near !== nearFade || sent.far !== farFade
            || sent.nearMatrix !== placement.near?.matrix || sent.farMatrix !== placement.far?.matrix) {
          const representations = [];
          if (nearFade > 0) representations.push({ ...placement.near, band: 'near', fade: nearFade, objectId: id,
            biomeLook: site.biomeLook, quantizedFade: Math.fround(nearFade), ditherDirection: 1 });
          if (farFade > 0) representations.push({ ...placement.far, band: 'far', fade: farFade, objectId: id,
            biomeLook: site.biomeLook, quantizedFade: Math.fround(farFade), ditherDirection: -1 });
          pending.get(placement.key).set(id, representations);
          sent.rows = rows; sent.near = nearFade; sent.far = farFade;
          sent.nearMatrix = placement.near?.matrix; sent.farMatrix = placement.far?.matrix;
        }
      } else if (placement.sent) placement.sent.rows = null;
      if (needsCoverage && (entry?.state !== 'ready' || placement.shown < 1)) coverage.complete = false;
      PerfCounters.inc('settlementPlacementsEvaluated');
      if (++units % SLICE === 0) { yield* flush(); yield; }
    }
    yield* flush();
    site.buildingCoverage = coverage;
  }
  yield* flush();
  // Eviction and culled/unready placements retire locally, under the same slices.
  for (const [key, rows] of view.rows) {
    if (rows.entry.state !== 'ready') { view.rows.delete(key); continue; }
    const inspected = new Set(), remove = new Map();
    for (const band of ['near', 'far']) for (const id of rows.storage.indices[band].keys()) {
      if (!inspected.has(id)) {
        inspected.add(id);
        if (rows.seenAt.get(id) !== pass) { remove.set(id, []); rows.seenAt.delete(id); }
      }
      // Scan retained IDs under the same budget, even when none need removal.
      PerfCounters.inc('settlementRetirementRowsChecked');
      if (++units % SLICE === 0) {
        if (remove.size) { publish(view, key, remove); remove.clear(); }
        yield;
      }
    }
    if (remove.size) { publish(view, key, remove); yield; }
  }
  view.visibleBuildings = buildings; view.visibleProps = props;
  PerfCounters.set('settlementInstances', shown);
  return fading;
}

/** Rebase roots at mesh granularity; their retained instance rows stay untouched. */
export function placeSettlementRows(view) {
  const origin = view.origin, retirement = view.pool.retirementVersion ?? 0;
  const state = view.rowPlacementState ??= { x: NaN, z: NaN, retirement: -1 };
  const moved = state.x !== origin.x || state.z !== origin.z;
  const retired = state.retirement !== retirement;
  if (!moved && !retired) return;
  for (const rows of view.rows.values()) for (const [tier, anchor] of rows.tiers) {
    PerfCounters.inc('settlementPlacementTiersVisited');
    if (retired && tier.meshes.every(mesh => !mesh.parent)) { rows.tiers.delete(tier); continue; }
    if (moved) for (const mesh of tier.meshes) anchor.place(mesh, origin);
  }
  state.x = origin.x; state.z = origin.z; state.retirement = retirement;
}
