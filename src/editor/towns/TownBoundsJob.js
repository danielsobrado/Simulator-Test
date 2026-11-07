import { Matrix4, Sphere } from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

const clockNow = () => performance.now();

function recordStep(started, rows, now) {
  const elapsed = now() - started;
  PerfCounters.inc('townBoundsCpuMs', elapsed);
  PerfCounters.inc('townBoundsInstanceRowsRead', rows);
  PerfCounters.set('townBoundsMaxStepCpuMs', Math.max(PerfCounters.get('townBoundsMaxStepCpuMs'), elapsed));
}

/** Exact InstancedMesh bounding sphere, with a scheduling boundary every 64 rows. */
export function* townBoundsJob(mesh, now = clockNow) {
  let started = now(), rows = 0;
  try {
    mesh.geometry.computeBoundingSphere();
    PerfCounters.inc('townBoundsGeometryVerticesScanned', mesh.geometry.getAttribute('position')?.count ?? 0);
    const sphere = new Sphere(), matrix = new Matrix4();
    mesh.boundingSphere = new Sphere().makeEmpty();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);
      mesh.boundingSphere.union(sphere);
      rows++;
      if (i % 64 === 63) {
        recordStep(started, rows, now); started = null; rows = 0;
        yield;
        started = now();
      }
    }
    PerfCounters.inc('townBoundsMeshesPrepared');
  } finally {
    // A cancelled iterator at a yield must not count its suspended wall time.
    if (started !== null) recordStep(started, rows, now);
  }
}
