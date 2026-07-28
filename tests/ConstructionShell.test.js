import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import {
  buildShellGeometry,
  sampleShellPath,
  shellSectionPoints,
} from '../src/editor/construction/render/ConstructionShell.js';
import { ConstructionView } from '../src/editor/construction/render/ConstructionView.js';
import {
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';

function wallRecord() {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials: {} },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([[0, 0], [4, 0], [8, 0], [12, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
}

function createTerrainView() {
  const scene = new THREE.Scene();
  return {
    scene,
    floatingOrigin: {
      toRender: (x, z) => ({ x, z }),
      toCanonical: (x, z) => ({ x, z }),
    },
    getCanonicalHeight: () => 0,
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
    },
  };
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('adjacent shell sections meet on the same point', () => {
  const sampled = sampleShellPath(wallRecord());
  const left = shellSectionPoints(sampled, 0, 0.5);
  const right = shellSectionPoints(sampled, 0.5, 1);

  assert.ok(left.length >= 2);
  assert.ok(right.length >= 2);
  const seamLeft = left.at(-1);
  const seamRight = right[0];
  // A seam that is merely close is a visible crack in the ribbon.
  assert.equal(seamLeft.x, seamRight.x);
  assert.equal(seamLeft.z, seamRight.z);
  assert.equal(seamLeft.normalX, seamRight.normalX);
  assert.equal(seamLeft.normalZ, seamRight.normalZ);

  assert.equal(left[0].distance, sampled.points[0].distance);
  assert.equal(right.at(-1).distance, sampled.totalDistance);
});

test('a shell section spans only its own arc', () => {
  const record = wallRecord();
  const sampled = sampleShellPath(record);
  const section = buildShellGeometry(shellSectionPoints(sampled, 0, 0.25), {
    record,
    terrainView: createTerrainView(),
    origin: { x: 0, z: 0 },
  });
  const whole = buildShellGeometry(sampled.points, {
    record,
    terrainView: createTerrainView(),
    origin: { x: 0, z: 0 },
  });

  const sectionSpan = section.boundingBox.max.x - section.boundingBox.min.x;
  const wholeSpan = whole.boundingBox.max.x - whole.boundingBox.min.x;
  assert.ok(sectionSpan < wholeSpan * 0.4, `${sectionSpan} vs ${wholeSpan}`);

  section.dispose();
  whole.dispose();
});

test('a far module shell never covers a near module that is drawing masonry', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({
    terrainView: createTerrainView(),
    store,
    compilerClient: null,
  });
  const record = wallRecord();
  store.add(record);
  const entry = view.entries.get(record.id);

  view.applyPlan(record, {
    version: 1,
    constructionId: record.id,
    constructionRevision: record.revision,
    totalLength: 12,
    modules: [
      {
        id: 'module-0',
        contentHash: 'a',
        pathInterval: [0, 6],
        placements: null,
        bounds: { minX: 0, maxX: 6, minZ: -0.4, maxZ: 0.4 },
      },
      {
        id: 'module-1',
        contentHash: 'b',
        pathInterval: [6, 12],
        placements: null,
        bounds: { minX: 6, maxX: 12, minZ: -0.4, maxZ: 0.4 },
      },
    ],
  });

  const near = entry.modules.get('module-0');
  const far = entry.modules.get('module-1');
  assert.ok(near.shellMesh);
  assert.ok(far.shellMesh);

  // module-0 has masonry and is close; module-1 is in the far band.
  const masonry = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), entry.materials.stone);
  entry.group.add(masonry);
  near.meshes = [masonry];
  near.band = 'near';
  near.builtBand = 'near';
  far.meshes = [];
  far.band = 'shell';

  view.updateLod({ fov: 60, position: { x: 0, y: 2, z: 4 } }, 1080);

  assert.equal(masonry.visible, true);
  assert.equal(near.shellMesh.visible, false, 'near module must not draw its ribbon');
  assert.equal(far.shellMesh.visible, true, 'far module keeps its own ribbon');
  assert.equal(
    entry.shellMesh.visible,
    false,
    'the record-wide ribbon must not reappear across the near module',
  );

  view.dispose();
});
