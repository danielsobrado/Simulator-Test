import { Vector3 } from 'three/webgpu';
import { prepareObjectCapacity, cancelObjectCapacity } from './ObjectCapacityPublication.js';
import { ObjectMatrixRows, writeObjectMatrixRows } from './ObjectMatrixRows.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

/** Reuse exact placement products and LOD history for unchanged resident objects. */
export function* prepareObjectInstances(view, renderer, objects, invalidation = null) {
  const origin = invalidation?.origin ?? view.terrainView.floatingOrigin.getState();
  const previous = renderer.placementRecords ?? new Map();
  const next = new Map();
  let changed = previous.size !== objects.length;
  let visited = 0;
  for (const object of objects) {
    const signature = JSON.stringify(object);
    let record = previous.get(object.id);
    if (!record || record.signature !== signature || record.originX !== origin.x || record.originZ !== origin.z
        || (invalidation ? invalidation.all || invalidation.dirty.has(object.id)
          : view.allPlacementsDirty || view.dirtyPlacements.has(object.id))) {
      const placement = view.resolvePlacement(object);
      const matrix = view.createObjectMatrix(object, placement.surface);
      record = { object, signature, placement, matrix, originX: origin.x, originZ: origin.z,
        worldPosition: new Vector3(matrix.elements[12], matrix.elements[13] + renderer.worldHeight / 2, matrix.elements[14]),
        worldHeight: renderer.worldHeight,
        foundationMatrix: placement.surface.foundationDepth > 0.03
          ? view.createFoundationMatrix(placement.bounds, placement.surface) : null };
      changed = true;
    }
    next.set(object.id, record);
    PerfCounters.inc('objectPlacementRecordsVisited');
    if (++visited % 16 === 0) yield;
  }
  if (!changed && renderer.placementRecords) return null;
  return next;
}

export function publishObjectInstances(view, renderer, next) {
  const records = [...next.values()];
  const foundations = records.filter(record => record.foundationMatrix);
  if (!prepareObjectCapacity(view, renderer, next.size, foundations.length, next)) return false;
  renderer.placementRecords = next;
  view.ensureCapacity(renderer, next.size);
  if (renderer.lodSources) {
    renderer.lodPlacements = records;
    renderer.lodController.updatePlacements(next);
    if (records.length === 0) {
      renderer.lodController.clear();
      renderer.lodSignatures = { near: '', coarse: '', shell: '' };
      for (const meshes of Object.values(renderer.lodMeshes)) for (const mesh of meshes) {
        mesh.count = 0; mesh.visible = false; mesh.userData.objectIds = [];
      }
    }
  } else {
    const rows = renderer.matrixRows ??= new ObjectMatrixRows('matrix');
    rows.patch(next);
    for (let part = 0; part < renderer.parts.length; part++) {
      const mesh = renderer.meshes[part];
      writeObjectMatrixRows(mesh, rows, renderer.parts[part].matrix);
    }
  }
  view.ensureFoundationCapacity(renderer, foundations.length);
  if (renderer.foundationMesh) {
    const rows = renderer.foundationRows ??= new ObjectMatrixRows('foundationMatrix');
    rows.patch(next);
    writeObjectMatrixRows(renderer.foundationMesh, rows);
  }
  return true;
}

export function updateObjectInstances(view, renderer, objects) {
  const job = prepareObjectInstances(view, renderer, objects);
  for (;;) {
    const step = job.next();
    if (step.done) {
      if (!step.value) { cancelObjectCapacity(view, renderer); return false; }
      const published = publishObjectInstances(view, renderer, step.value);
      if (!published) view.pendingObjectUpdates.set(renderer.definition.key, { renderer, next: step.value });
      return published;
    }
  }
}
