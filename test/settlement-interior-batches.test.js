import assert from 'node:assert/strict';
import test from 'node:test';
import { Frustum, Group, Matrix4, PerspectiveCamera, Scene } from 'three/webgpu';
import { InteriorBuilder, INTERIOR_MATERIALS } from '../src/editor/world/settlements/view/interior/InteriorBuilder.js';
import { INTERIOR_BATCH_MAX_VERTICES, INTERIOR_VERTEX_ATTRIBUTES } from '../src/editor/world/settlements/view/interior/InteriorBatchStore.js';
import { createInteriorMeshes } from '../src/editor/world/settlements/view/interior/InteriorMeshes.js';
import { prepareSurfaceJob } from '../src/editor/world/settlements/view/SettlementPreparationJobs.js';
import { SettlementSite } from '../src/editor/world/settlements/view/SettlementSite.js';
import { drainJob } from '../src/editor/world/settlements/SettlementArrayJobs.js';
import { StreamedDrawPreparation } from '../src/render/preparation/StreamedDrawPreparation.js';
import { WAIT_FOR_DRAW_PREPARATION } from '../src/render/preparation/StagedDrawPublication.js';

/** The former six-corner quad emitter, retained as an independent parity oracle. */
class TriangleInteriorBuilder extends InteriorBuilder {
  quad(a, b, c, d, n, color, density = 0.6) {
    const length = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const columns = Math.max(1, Math.ceil(length(a, b) / 1.1));
    const rows = Math.max(1, Math.ceil(length(a, d) / 1.1));
    const cross = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]),
      (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]),
      (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    const order = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0 ? [0, 1, 2, 0, 2, 3] : [0, 3, 2, 0, 2, 1];
    const point = [0, 0, 0];
    const width = length(a, b) * density, height = length(a, d) * density;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      for (let triangle = 0; triangle < 2; triangle++) {
        const base = this.reserveVertices(3);
        for (const index of order.slice(triangle * 3, triangle * 3 + 3)) {
          const s = (column + (index === 1 || index === 2 ? 1 : 0)) / columns;
          const t = (row + (index >= 2 ? 1 : 0)) / rows;
          for (let axis = 0; axis < 3; axis++) {
            const near = a[axis] + (b[axis] - a[axis]) * s;
            const far = d[axis] + (c[axis] - d[axis]) * s;
            point[axis] = near + (far - near) * t;
          }
          this.vertex(point, n, color, s * width, t * height);
        }
        this.group.indices.push(base, base + 1, base + 2);
      }
    }
  }
}

function drawFixture(builder) {
  for (const [x, z, yaw] of [[0, 0, 0], [-130, 260, Math.PI / 3], [260, -130, -Math.PI / 2]]) {
    builder.enter({ x, z, yaw }, [
      { at: [1, 2, 0], color: [1, 0.6, 0.2], strength: 2.5, radius: 2 },
      { at: [-2, 2.4, 1], sky: true, strength: 0.7, radius: 1.4 },
    ]);
    for (const role of INTERIOR_MATERIALS) {
      builder.use(role);
      builder.wall(-2, -1, 2, 1, 0, 2.7, [0, 1], [0.3, 0.5, 0.7], 0.45);
      builder.slab(-2, 2, -1, 1, 0, true, [0.6, 0.4, 0.2], 0.9);
      builder.box(-1, 1, -1, 1, 0, 0.8, [0.2, 0.3, 0.4], { underside: true });
      builder.prism(0, 0, 0.3, 0, 0.7, [0.5, 0.2, 0.1], { sides: 7, belly: 0.2, taper: 0.1 });
      builder.disc(0, 1, 0, 0.25, [0, -1], [0.4, 0.5, 0.6], 9);
    }
  }
  return builder.arrays();
}

function expandedAttributes(batches) {
  const grouped = new Map();
  for (const batch of batches) {
    const key = `${batch.materialKey}:${batch.cellX}:${batch.cellZ}`;
    if (!grouped.has(key)) grouped.set(key, Object.fromEntries(Object.keys(INTERIOR_VERTEX_ATTRIBUTES).map(name => [name, []])));
    const target = grouped.get(key);
    for (const index of batch.indices) for (const [name, size] of Object.entries(INTERIOR_VERTEX_ATTRIBUTES)) {
      for (let channel = 0; channel < size; channel++) target[name].push(batch[name][index * size + channel]);
    }
  }
  return new Map([...grouped].map(([key, values]) => [key, Object.fromEntries(Object.entries(values)
    .map(([name, floats]) => [name, new Uint32Array(new Float32Array(floats).buffer)]))]));
}

test('indexed spatial batches preserve every expanded float32 attribute and triangle order', () => {
  const reference = drawFixture(new TriangleInteriorBuilder());
  const indexed = drawFixture(new InteriorBuilder({ maxVertices: 17 }));
  assert.deepEqual(expandedAttributes(indexed), expandedAttributes(reference));
  const vertices = batches => batches.reduce((sum, batch) => sum + batch.positions.length / 3, 0);
  assert.ok(vertices(indexed) < vertices(reference));
  assert.ok(indexed.some(batch => batch.part > 0), 'exercise capacity splits inside a spatial cell');
  assert.ok(indexed.some(batch => batch.cellX < 0 && batch.cellZ < 0), 'negative cells use settlement-local z');
  for (const batch of indexed) {
    assert.ok(batch.positions.length / 3 <= 17);
    assert.ok(batch.indices.every(index => index < batch.positions.length / 3));
  }
});

test('interior capacity splitting keeps the uint16 primitive-restart index unused', () => {
  const builder = new InteriorBuilder();
  builder.enter({ x: 0, z: 0, yaw: 0 });
  for (let index = 0; index < 16383; index++) builder.slab(0, 1, 0, 1, 0, true, [1, 1, 1]);
  builder.tri([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 1, 1]);
  builder.slab(0, 1, 0, 1, 0, true, [1, 1, 1]);
  const batches = builder.arrays();
  assert.equal(batches.length, 2);
  assert.equal(batches[0].positions.length / 3, INTERIOR_BATCH_MAX_VERTICES);
  assert.ok(batches[0].indices.includes(65534));
  for (const batch of batches) {
    assert.ok(batch.indices instanceof Uint16Array);
    assert.ok(batch.indices.every(index => index !== 0xffff));
  }
});

function separatedRooms() {
  const builder = new InteriorBuilder();
  for (const z of [256, -256]) {
    builder.enter({ x: 0, z, yaw: 0 });
    builder.use('wood').box(-1, 1, -1, 1, 0, 3, [1, 1, 1]);
  }
  const batches = builder.arrays();
  for (const batch of batches) drainJob(prepareSurfaceJob(batch));
  return batches;
}

test('interior batches cull conservatively under a floating origin and share materials across slices', () => {
  const batches = separatedRooms(), materials = new Map();
  const meshes = batches.flatMap(batch => createInteriorMeshes([batch], null, materials));
  const root = new Group(); root.position.set(1000000, 0, -1000000); root.add(...meshes); root.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  camera.position.set(root.position.x, 2, root.position.z);
  camera.lookAt(root.position.x, 2, root.position.z - 1); camera.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
  try {
    assert.equal(meshes.length, 2);
    assert.equal(materials.size, 1);
    assert.equal(meshes[0].material, meshes[1].material);
    assert.deepEqual(meshes.map(mesh => frustum.intersectsObject(mesh)), [true, false]);
    for (const [index, mesh] of meshes.entries()) {
      assert.equal(mesh.geometry.index.array, batches[index].indices);
      assert.equal(mesh.geometry.attributes.position.array, batches[index].positions);
      assert.ok(mesh.frustumCulled && !mesh.castShadow && !mesh.receiveShadow);
    }
  } finally {
    for (const mesh of meshes) mesh.geometry.dispose();
    for (const material of materials.values()) material.dispose();
  }
});

for (const cancel of [false, true]) test(`interior site ${cancel ? 'cancellation' : 'publication'} disposes shared materials once`, () => {
  const scene = new Scene(), paving = new Group(); scene.add(paving);
  const preparation = new StreamedDrawPreparation({ scene, renderer: {}, settings: { enabled: true, meshesPerFrame: 1 }, render: () => {} });
  let released = 0;
  const site = Object.assign(Object.create(SettlementSite.prototype), { paving, pavingArrays: [], interiorArrays: separatedRooms(),
    surfaces: {}, disposed: false, job: null, releaseSurfaces: () => { released++; }, getDrawPreparation: () => preparation });
  site.installJob = site.installation();
  try {
    site.installJob.next(); site.installJob.next();
    const meshes = [...site.stagedMeshes];
    assert.equal(meshes[0].material, meshes[1].material);
    let materialDisposals = 0, geometryDisposals = 0;
    meshes[0].material.addEventListener('dispose', () => materialDisposals++);
    for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    assert.equal(site.installJob.next().value, WAIT_FOR_DRAW_PREPARATION);
    assert.equal(site.pavingReady, undefined);
    if (!cancel) {
      preparation.flush({});
      assert.equal(site.installJob.next().value, WAIT_FOR_DRAW_PREPARATION);
      preparation.flush({});
      assert.equal(site.installJob.next().done, true);
      site.installJob = null;
      assert.equal(site.pavingReady, true);
      assert.ok(meshes.every(mesh => mesh.parent === paving));
    }
    site.dispose(); site.dispose(); preparation.flush({});
    assert.equal(materialDisposals, 1);
    assert.equal(geometryDisposals, 2);
    assert.equal(released, 1);
    assert.equal(preparation.pending.size, 0);
    assert.equal(scene.children.length, 0);
    assert.equal(site.interiorArrays, null);
  } finally { site.dispose(); preparation.dispose(); }
});
