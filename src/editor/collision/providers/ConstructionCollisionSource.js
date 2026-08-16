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
  if (!Number.isFinite(curveSegmentLength) || curveSegmentLength <= 0) {
    throw new Error('Construction collision curve segment length must be positive and finite.');
  }
  return Object.freeze({ curveSegmentLength });
}

function validateActiveRecord(record) {
  if (!record?.id || !Number.isSafeInteger(record.revision)) {
    throw new Error('Construction collision source requires an active record revision.');
  }
}

function validatePlanBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') {
    throw new Error('Construction collision plan requires bounds.');
  }
  for (const field of BOUNDS_FIELDS) {
    if (!Number.isFinite(bounds[field])) {
      throw new Error(`Construction collision plan bounds ${field} must be finite.`);
    }
  }
  if (bounds.maxX < bounds.minX || bounds.maxZ < bounds.minZ) {
    throw new Error('Construction collision plan bounds maximums must cover their minimums.');
  }
}

function validateVector(value, field, boxId) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`Construction collision box "${boxId}" ${field} must contain two finite values.`);
  }
}

function validatePlanBoxes(boxes) {
  if (!Array.isArray(boxes)) {
    throw new Error('Construction collision plan boxes must be an array.');
  }
  for (const [index, box] of boxes.entries()) {
    const boxId = typeof box?.id === 'string' && box.id ? box.id : `#${index}`;
    if (!box || typeof box !== 'object' || typeof box.id !== 'string' || !box.id) {
      throw new Error(`Construction collision box ${boxId} requires an id.`);
    }
    validateVector(box.center, 'center', boxId);
    validateVector(box.tangent, 'tangent', boxId);
    if (!Number.isFinite(box.length) || box.length <= 0) {
      throw new Error(`Construction collision box "${boxId}" length must be positive and finite.`);
    }
    if (!Number.isFinite(box.thickness) || box.thickness <= 0) {
      throw new Error(`Construction collision box "${boxId}" thickness must be positive and finite.`);
    }
    if (!Number.isFinite(box.bottom) || !Number.isFinite(box.top) || box.top <= box.bottom) {
      throw new Error(`Construction collision box "${boxId}" vertical range must be finite and positive.`);
    }
    if (!Number.isFinite(box.foundationOverlap) || box.foundationOverlap < 0) {
      throw new Error(`Construction collision box "${boxId}" foundation overlap must be finite and non-negative.`);
    }
    validatePlanBounds(box.bounds);
  }
}

function sameBounds(left, right) {
  return BOUNDS_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function sameVector(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
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
    && Array.isArray(left?.boxes)
    && Array.isArray(right?.boxes)
    && left.boxes.length === right.boxes.length
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
    if (!Number.isFinite(chunkWorldSize) || chunkWorldSize <= 0) {
      throw new Error('Construction collision source requires a positive finite chunk size.');
    }
    if (this.spatialIndex) {
      if (this.chunkWorldSize !== chunkWorldSize) {
        throw new Error('Construction collision source cannot change chunk size at runtime.');
      }
      return this;
    }

    const spatialIndex = new ConstructionSpatialIndex({ chunkWorldSize });
    for (const [id, plan] of this.plans) spatialIndex.updateBounds(id, plan.bounds);
    this.chunkWorldSize = chunkWorldSize;
    this.spatialIndex = spatialIndex;
    return this;
  }

  setActive(record) {
    validateActiveRecord(record);
    this.activeRevisions.set(record.id, record.revision);
  }

  replaceActive(records) {
    if (!Array.isArray(records)) {
      throw new Error('Construction collision active records must be an array.');
    }

    const nextActiveRevisions = new Map();
    for (const record of records) {
      validateActiveRecord(record);
      if (nextActiveRevisions.has(record.id)) {
        throw new Error(`Construction collision active records duplicate "${record.id}".`);
      }
      nextActiveRevisions.set(record.id, record.revision);
    }

    this.activeRevisions = nextActiveRevisions;
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
    validatePlanBounds(plan.bounds);
    validatePlanBoxes(plan.boxes);
    if (this.activeRevisions.get(record.id) !== record.revision) {
      this.rejectedPlans += 1;
      return false;
    }

    const previous = this.plans.get(record.id);
    const unchanged = sameGeometry(previous, plan);
    if (!unchanged) {
      this.spatialIndex?.updateBounds(record.id, plan.bounds);
    }
    this.plans.set(record.id, plan);
    if (unchanged) this.unchangedPlans += 1;
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
