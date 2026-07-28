import { ConstructionSpatialIndex } from '../../construction/ConstructionSpatialIndex.js';

export class ConstructionCollisionSource {
  constructor({ store, chunkWorldSize }) {
    if (!store?.subscribe || !store?.get || !store?.list) {
      throw new Error('Construction collision source requires a construction store.');
    }
    if (!(chunkWorldSize > 0)) {
      throw new Error('Construction collision source requires a positive chunk size.');
    }
    this.store = store;
    this.plans = new Map();
    this.spatialIndex = new ConstructionSpatialIndex({ chunkWorldSize });
    this.appliedPlans = 0;
    this.rejectedPlans = 0;
    this.unsubscribe = store.subscribe((change) => this.onStoreChange(change));
  }

  onStoreChange(change) {
    if (change.kind === 'clear' || change.kind === 'replace') {
      this.plans.clear();
      this.spatialIndex.clear();
      return;
    }
    if (!change.after && change.id) this.remove(change.id);
  }

  applyPlan(record, plan) {
    if (!record || !plan || plan.version !== 1) {
      throw new Error('Construction collision source requires a versioned compiled plan.');
    }
    if (record.id !== plan.constructionId || record.revision !== plan.constructionRevision) {
      throw new Error('Construction collision plan does not match its source record.');
    }
    const current = this.store.get(record.id);
    if (!current || current.revision !== record.revision) {
      this.rejectedPlans += 1;
      return false;
    }
    this.plans.set(record.id, plan);
    this.spatialIndex.updateBounds(record.id, plan.bounds);
    this.appliedPlans += 1;
    return true;
  }

  remove(constructionId) {
    const id = String(constructionId);
    const removed = this.plans.delete(id);
    this.spatialIndex.remove(id);
    return removed;
  }

  getPlan(constructionId) {
    return this.plans.get(String(constructionId)) ?? null;
  }

  list(chunkX, chunkZ) {
    return this.spatialIndex.list(chunkX, chunkZ);
  }

  signature(chunkX, chunkZ) {
    return this.spatialIndex.signature(chunkX, chunkZ);
  }

  getStatus() {
    let stalePlans = 0;
    for (const [id, plan] of this.plans) {
      if (this.store.get(id)?.revision !== plan.constructionRevision) stalePlans += 1;
    }
    return Object.freeze({
      id: 'construction-collision-source',
      plans: this.plans.size,
      stalePlans,
      appliedPlans: this.appliedPlans,
      rejectedPlans: this.rejectedPlans,
      spatialRevision: this.spatialIndex.revision,
    });
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.plans.clear();
    this.spatialIndex.clear();
  }
}
