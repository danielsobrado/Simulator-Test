import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkshopCompositionParts } from '../src/editor/workshop/ProceduralWorkshopCompositionGenerator.js';
import { buildWallBufferGeometry, buildWallMeshData } from '../src/editor/workshop/geometry/wall/WallBuilder.js';
import { registerWallCommands } from '../src/editor/workshop/geometry/wall/WallCommands.js';
import { planWall, planWallEntity } from '../src/editor/workshop/geometry/wall/WallPlanner.js';
import { WorkshopCommandBus } from '../src/editor/workshop/kernel/WorkshopCommandBus.js';
import {
  createWorkshopDocumentFromRecipe,
  resolveWorkshopRecipe,
} from '../src/editor/workshop/kernel/WorkshopRecipeBridge.js';
import { projectWorkshopComposition } from '../src/editor/workshop/model/composition/WorkshopCompositionProjection.js';
import { workshopEntitySpatialBounds } from '../src/editor/workshop/spatial/WorkshopSpatialBounds.js';

function curvedWall(entity) {
  return {
    ...entity.properties.wall,
    path: {
      version: 1,
      id: 'curve-wall',
      closed: false,
      points: [
        { id: 'p-1', position: [0, 0] },
        { id: 'p-2', position: [4, 0] },
      ],
      segments: [{
        id: 's-1',
        kind: 'arc',
        startId: 'p-1',
        endId: 'p-2',
        center: [2, 0],
        clockwise: false,
      }],
    },
  };
}

function disposeParts(parts) {
  const materials = new Set();
  for (const part of parts) {
    part.geometry.dispose();
    materials.add(part.material);
  }
  for (const material of materials) material.dispose();
}

test('curved semantic wall plans, invalidates, bounds, and renders through one pipeline', async () => {
  const document = createWorkshopDocumentFromRecipe({
    archetype: 'wall',
    composition: { version: 1, primitives: [{
      id: 'curve-wall',
      kind: 'wall',
      points: [[0, 0], [4, 0]],
      elevation: 0,
      height: 4,
      thickness: 0.5,
      topFamily: 'plain',
    }] },
  });
  const bus = new WorkshopCommandBus(document);
  registerWallCommands(bus);
  const result = bus.dispatch({
    type: 'wall.set-definition',
    entityId: 'composition:curve-wall',
    wall: curvedWall(document.getEntity('composition:curve-wall')),
  });

  assert.deepEqual(result.dirty.entities, ['composition:curve-wall']);
  assert.ok(result.dirty.domains.includes('TOPOLOGY'));
  assert.ok(result.dirty.domains.includes('GEOMETRY'));
  const entity = bus.document.getEntity('composition:curve-wall');
  const plan = planWallEntity(entity);
  assert.equal(plan.wallId, 'curve-wall');
  assert.equal(plan.path.segments[0].kind, 'arc');
  assert.ok(plan.sections.length > 2);
  assert.ok(plan.rpg.collisionSlabs.length > 1);

  const legacy = resolveWorkshopRecipe(bus.document).composition.primitives[0];
  assert.equal(legacy.kind, 'wall');
  assert.ok(legacy.points.length > 2 && legacy.points.length <= 64);

  const bounds = workshopEntitySpatialBounds(entity);
  assert.ok(bounds.min[1] < -1.9);
  assert.ok(bounds.max[0] >= 4);

  const mesh = buildWallMeshData(plan);
  assert.ok(mesh.positions.length > 0);
  assert.ok(mesh.positions.every(Number.isFinite));
  assert.ok(mesh.indices.every(Number.isSafeInteger));
  assert.ok(mesh.groups.some(({ regionId }) => regionId === 'curve-wall:s-1:bottom'));
  assert.ok(Math.max(...mesh.uvs) > 5);

  const coarseMesh = buildWallMeshData(planWall(entity.properties.wall, { sampleSpacing: 0.7 }));
  assert.ok(Math.abs(Math.max(...mesh.uvs) - Math.max(...coarseMesh.uvs)) < 1e-9);

  const rendered = await buildWallBufferGeometry(plan);
  assert.equal(rendered.geometry.userData.workshopWallId, 'curve-wall');
  assert.ok(rendered.geometry.getAttribute('position').count > 0);
  rendered.geometry.dispose();

  const projection = projectWorkshopComposition(bus.document);
  const runtimeParts = createWorkshopCompositionParts(projection.recipe, {
    wallPlans: projection.wallPlans,
  });
  try {
    const semanticParts = runtimeParts.filter((part) => (
      part.geometry.userData.workshopWallPlanId === 'curve-wall'
    ));
    assert.ok(semanticParts.length > 0);
    assert.ok(semanticParts.some((part) => part.geometry.userData.workshopSurfaceId === 'curve-wall:s-1:top'));
    assert.ok(semanticParts.some((part) => part.geometry.userData.workshopSurfaceId === 'curve-wall:s-1:bottom'));
  } finally {
    disposeParts(runtimeParts);
  }

  const quadraticPlan = planWallEntity({
    id: 'composition:curve-wall',
    type: 'composition-wall',
    properties: {
      wall: {
        ...entity.properties.wall,
        path: {
          version: 1,
          id: 'curve-wall',
          closed: false,
          points: [
            { id: 'p-1', position: [0, 0] },
            { id: 'p-2', position: [4, 0] },
          ],
          segments: [{
            id: 's-1',
            kind: 'quadratic',
            startId: 'p-1',
            endId: 'p-2',
            control: [2, 2],
          }],
        },
      },
    },
  });
  assert.equal(quadraticPlan.path.segments[0].kind, 'quadratic');
  assert.ok(buildWallMeshData(quadraticPlan).positions.every(Number.isFinite));

  const beforeStyleProjection = projectWorkshopComposition(bus.document);
  const styleResult = bus.dispatch({
    type: 'wall.set-definition',
    entityId: 'composition:curve-wall',
    wall: { ...entity.properties.wall, style: 'granite' },
  });
  assert.ok(styleResult.dirty.domains.includes('STYLE'));
  assert.ok(styleResult.dirty.domains.includes('MATERIAL'));
  assert.equal(styleResult.dirty.domains.includes('TOPOLOGY'), false);
  assert.notEqual(projectWorkshopComposition(bus.document).revisionKey, beforeStyleProjection.revisionKey);
});
