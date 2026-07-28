import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { createWorkshopMaterials } from '../src/editor/workshop/ProceduralWorkshopMaterials.js';
import { mortarProfile } from '../src/editor/construction/render/ConstructionMortarConfig.js';

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('workshop and construction soft limestone share surface response', () => {
  const workshop = createWorkshopMaterials({
    seed: 3141,
    irregularity: 0.36,
    detail: 2,
    style: 'soft-limestone',
    topStyle: 'slate',
    weathering: 0.25,
    albedo: null,
    archetype: 'manor',
    finish: 'masonry',
  });
  const construction = createConstructionMaterials(normalizeConstructionRecord({
    version: 1,
    id: 'construction-soft',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: 'soft-limestone-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([[0, 0], [8, 0], [16, 0], [24, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  }));

  assert.equal(workshop.stone.userData.stoneSurface.palette, 'soft-limestone');
  assert.equal(construction.stone.userData.stoneSurface.palette, 'soft-limestone');
  assert.equal(workshop.stone.bumpScale, construction.stone.bumpScale);
  assert.equal(
    workshop.stone.userData.stoneSurface.roughnessBase,
    construction.stone.userData.stoneSurface.roughnessBase,
  );
  assert.equal(
    workshop.stone.userData.stoneSurface.roughnessVariation,
    construction.stone.userData.stoneSurface.roughnessVariation,
  );
  assert.equal(
    workshop.stone.userData.stoneSurface.normalKind,
    construction.stone.userData.stoneSurface.normalKind,
  );
  assert.equal(workshop.stone.normalScale.x, construction.stone.normalScale.x);
  assert.equal(workshop.stone.envMapIntensity, construction.stone.envMapIntensity);

  const mortar = mortarProfile('soft-limestone-rubble');
  assert.ok(construction.mortar.color.equals(new THREE.Color(mortar.color)));
  assert.ok(workshop.mortar.color.equals(new THREE.Color(mortar.color)));

  for (const material of Object.values(workshop)) material.dispose();
});
