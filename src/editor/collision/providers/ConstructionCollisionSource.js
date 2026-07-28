import { ConstructionSpatialIndex } from '../../construction/ConstructionSpatialIndex.js';

const DEFAULT_CONFIG = Object.freeze({ curveSegmentLength: 1.25 });
const BOUNDS_FIELDS = Object.freeze(['minX', 'minZ', 'maxX', 'maxZ']);
const BOX_FIELDS = Object.freeze([
  'id',
  'segmentId',
  'length',
  'thickness',
  'bottom',
  'top',
  'foundationOverlap',
]);

function normalizeConfig(config = {}) {
  const curveSegmentLength = config.curveSegmentLength ?? DEFAULT_CONFIG.curveSegmentLength;
  if (!(curveSegmentLength > 0)) {
    throw new Error('Construction collision curve segment length must be positive.');
  }
  return Object.freeze({ curveSegmentLength });
}

function sameBounds(left, right) {
  return BOUNDS_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function sameVector(left, right) {
  return left?.length === right?.length
    && left.every((value, index) => value === right[index]);
}

function sameBox(left, right) {
  return BOX_FIELDS.every((field) => left?.[field] === right?.[field])
    && sameVector(left?.center, right?.center)
    && sameVector(left?.tangent, right?.tangent)
    && sameVector(left?.openingIds, right?.openingIds)
    && sameBounds(left?.bounds, right?.bounds);
}

function sameGeometry(left, right) {
  return sameBounds(left?.bounds, right?.bounds)
    && left?.boxes?.length === right?.boxes?.length
    && left.boxes.every((box, index) => sameBox(box, right.boxes[index]));
}

export class ConstructionCollisionSource {
  constructor() {
    this.activeRevisions = new Map();
    this.plans = new Map();
    this.spatialIndex = null;
    this.chunkWorldSize = null;
    this.config = DEFAULT_CONFIG;
    this.appliedPlans = 0;
    this.unchangedPlans = 0;
    this.rejectedPlans = 0;
  }

  setConfig(config) {
    this.config = normalizeConfig(config);
    return this.config;
  }

  getConfig() {
    return this.config;
  }

  configure(chunkWorldSize) {
    if (!(chunkWorldSize > 0)) {
      throw new Error('Construction collision source requires a positive chunk size.');
    }
    if (this.spatialIndex) {
      if (this.chunkWorldSize !== chunkWorldSize) {
        throw new Error('Construction collision source cannot change chunk size at runtime.');
      }
      return this;
    }
    this.chunkWorldSize = chunkWorldSize;
    this.spatialIndex = new ConstructionSpatialIndex({ chunkWorldSize });
    for (const [id, plan] of this.plans) this.spatialIndex.updateBounds(id, plan.bounds);
    return this;
  }

  setActive(record) {
    if (!record?.id || !Number.isSafeInteger(record.revision)) {
      throw new Error('Construction collision source requires an active record revision.');
    }
    this.activeRevisions.set(record.id, record.revision);
  }

  replaceActive(records) {
    if (!Array.isArray(records)) {
      throw new Error('Construction collision active records must be an array.');
    }
    this.activeRevisions.clear();
    for (const record of records) this.setActive(record);
    this.plans.clear();
    this.spatialIndex?.clear();
  }

  applyPlan(record, plan) {
    if (!record || !plan || plan.version !== 1) {
      throw new Error('Construction collision source requires a versioned compiled plan.');
    }
    if (record.id !== plan.constructionId || record.revision !== plan.constructionRevision) {
      throw new Error('Construction collision plan does not match its source record.');
    }
    if (this.activeRevisions.get(record.id) !== record.revision) {
      this.rejectedPlans += 1;
      return false;
    }

    const previous = this.plans.get(record.id);
    this.plans.set(record.id, plan);
    if (sameGeometry(previous, plan)) {
      this.unchangedPlans += 1;
    } else {
      this.spatialIndex?.updateBounds(record.id, plan.bounds);
    }
    this.appliedPlans += 1;
    return true;
  }

  remove(constructionId) {
    const id = String(constructionId);
    this.activeRevisions.delete(id);
    const removed = this.plans.delete(id);
    this.spatialIndex?.remove(id);
    return removed;
  }

  clear() {
    this.activeRevisions.clear();
    this.plans.clear();
    this.spatialIndex?.clear();
  }

  getPlan(constructionId) {
    return this.plans.get(String(constructionId)) ?? null;
  }

  getPlanCount() {
    return this.plans.size;
  }

  list(chunkX, chunkZ) {
    return this.spatialIndex?.list(chunkX, chunkZ) ?? [];
  }

  signature(chunkX, chunkZ) {
    return this.spatialIndex?.signature(chunkX, chunkZ) ?? 0;
  }

  getStatus() {
    let stalePlans = 0;
    for (const [id, plan] of this.plans) {
      if (this.activeRevisions.get(id) !== plan.constructionRevision) stalePlans += 1;
    }
    return Object.freeze({
      id: 'construction-collision-source',
      activeRecords: this.activeRevisions.size,
      plans: this.plans.size,
      stalePlans,
      appliedPlans: this.appliedPlans,
      unchangedPlans: this.unchangedPlans,
      rejectedPlans: this.rejectedPlans,
      spatialRevision: this.spatialIndex?.revision ?? 0,
      config: this.config,
    });
  }
}

export const constructionCollisionSource = new ConstructionCollisionSource();
