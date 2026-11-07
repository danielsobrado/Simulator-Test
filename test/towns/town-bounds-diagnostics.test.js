import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three/webgpu';
import { townBoundsJob } from '../../src/editor/towns/TownBoundsJob.js';
import { drainJob } from '../../src/editor/world/settlements/SettlementArrayJobs.js';
import { PerfCounters } from '../../src/editor/performance/qa/PerfCounters.js';

function fixture(t, count = 130) {
  const geometry = new BoxGeometry(2, 3, 4), material = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, count), matrix = new Matrix4();
  for (let index = 0; index < count; index++) mesh.setMatrixAt(index, matrix.makeRotationY(index / 7).setPosition(index * 3, index % 5, -index * 2));
  t.after(() => { mesh.dispose(); geometry.dispose(); material.dispose(); });
  return mesh;
}

test('town bounds diagnostics preserve the exact standard instanced sphere', t => {
  const mesh = fixture(t); mesh.computeBoundingSphere(); const expected = mesh.boundingSphere.clone();
  PerfCounters.reset(); drainJob(townBoundsJob(mesh));
  assert.deepEqual(mesh.boundingSphere, expected);
  assert.equal(PerfCounters.get('townBoundsInstanceRowsRead'), 130);
  assert.equal(PerfCounters.get('townBoundsMeshesPrepared'), 1);
  assert.equal(PerfCounters.get('townBoundsGeometryVerticesScanned'), mesh.geometry.attributes.position.count);
});

test('town bounds CPU counters exclude suspension and cancellation wait time', t => {
  const mesh = fixture(t), getMatrixAt = mesh.getMatrixAt.bind(mesh);
  let time = 0;
  mesh.getMatrixAt = (index, matrix) => { time += 0.01; return getMatrixAt(index, matrix); };
  PerfCounters.reset(); const job = townBoundsJob(mesh, () => time);
  assert.equal(job.next().done, false);
  assert.equal(PerfCounters.get('townBoundsInstanceRowsRead'), 64);
  time += 10000;
  assert.equal(job.next().done, false);
  time += 10000; job.return();
  assert.equal(PerfCounters.get('townBoundsInstanceRowsRead'), 128);
  assert.equal(PerfCounters.get('townBoundsMeshesPrepared'), 0);
  assert.ok(Math.abs(PerfCounters.get('townBoundsCpuMs') - 1.28) < 1e-6);
  assert.ok(PerfCounters.get('townBoundsMaxStepCpuMs') < 1);
});
