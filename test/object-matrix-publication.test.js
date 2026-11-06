import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three/webgpu';
import { ObjectMatrixRows, writeObjectMatrixRows } from '../src/editor/placement/ObjectMatrixRows.js';
import { prepareObjectInstances } from '../src/editor/placement/ObjectInstanceUpdates.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';

test('cached placements and a late local edit stay inside each preparation slice', () => {
  const objects = Array.from({ length: 1000 }, (_, id) => ({ id, x: id, z: 0 }));
  const renderer = { worldHeight: 1, placementRecords: new Map(objects.map(object => [object.id,
    { object, signature: JSON.stringify(object), originX: 0, originZ: 0 }])) };
  const view = { terrainView: { floatingOrigin: { getState: () => ({ x: 0, z: 0 }) } },
    dirtyPlacements: new Set(), allPlacementsDirty: false,
    resolvePlacement: () => ({ surface: { foundationDepth: 0 } }),
    createObjectMatrix: object => new Matrix4().makeTranslation(object.x, 0, object.z) };
  objects[999] = { ...objects[999], x: 2000 };
  const job = prepareObjectInstances(view, renderer, objects);
  PerfCounters.reset();
  let result, turns = 0;
  do {
    const before = PerfCounters.get('objectPlacementRecordsVisited');
    result = job.next(); turns++;
    assert.ok(PerfCounters.get('objectPlacementRecordsVisited') - before <= 16);
  } while (!result.done);
  assert.ok(turns > 60);
  assert.equal(result.value.get(0), renderer.placementRecords.get(0));
  assert.equal(result.value.get(999).matrix.elements[12], 2000);
});

test('stable object rows transform only edits, tail moves and additions, including foundations', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const meshes = [new InstancedMesh(geometry, material, 512), new InstancedMesh(geometry, material, 512)];
  const foundation = new InstancedMesh(geometry, material, 512);
  const rows = new ObjectMatrixRows('matrix'), foundations = new ObjectMatrixRows('foundationMatrix');
  const records = new Map(Array.from({ length: 256 }, (_, id) => [id, { object: { id },
    matrix: new Matrix4().makeTranslation(id * .1, 2, -3),
    foundationMatrix: new Matrix4().makeTranslation(id * .1, -1, -3) }]));
  const parts = [new Matrix4(), new Matrix4().makeRotationY(.4)];
  const publish = () => {
    rows.patch(records); foundations.patch(records);
    meshes.forEach((mesh, i) => writeObjectMatrixRows(mesh, rows, parts[i]));
    writeObjectMatrixRows(foundation, foundations);
  };
  const verify = () => {
    for (const mesh of [...meshes, foundation]) for (let row = 0; row < mesh.count; row++) {
      const record = records.get(mesh.userData.objectIds[row]);
      const expected = mesh === foundation ? record.foundationMatrix
        : new Matrix4().multiplyMatrices(record.matrix, parts[meshes.indexOf(mesh)]);
      assert.deepEqual([...mesh.instanceMatrix.array.subarray(row * 16, row * 16 + 16)], expected.elements.map(Math.fround));
    }
  };
  try {
    publish(); verify();
    for (const mesh of [...meshes, foundation]) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.computeBoundingSphere = () => assert.fail('local publication must extend existing bounds');
    }
    records.set(17, { ...records.get(17), matrix: new Matrix4().makeTranslation(50, 4, 6) });
    PerfCounters.reset(); publish(); verify();
    assert.equal(PerfCounters.get('objectInstanceRowsTransformed'), 2);
    assert.deepEqual(meshes[0].instanceMatrix.updateRanges, [{ start: 17 * 16, count: 16 }]);
    assert.equal(foundation.instanceMatrix.updateRanges.length, 0);
    records.delete(1);
    records.set(900, { object: { id: 900 }, matrix: new Matrix4().makeTranslation(3, 4, 5), foundationMatrix: null });
    PerfCounters.reset(); publish(); verify();
    assert.equal(PerfCounters.get('objectInstanceRowsTransformed'), 5);
    assert.equal(meshes[0].userData.objectIds[1], 255);
    assert.equal(meshes[0].count, 256); assert.equal(foundation.count, 255);
    const grown = new InstancedMesh(geometry, material, 1024);
    try {
      writeObjectMatrixRows(grown, rows, parts[0]);
      assert.equal(grown.count, 256);
      assert.deepEqual(grown.instanceMatrix.array.subarray(0, 256 * 16), meshes[0].instanceMatrix.array.subarray(0, 256 * 16));
    } finally { grown.dispose(); }
  } finally {
    for (const mesh of [...meshes, foundation]) mesh.dispose();
    geometry.dispose(); material.dispose();
  }
});
