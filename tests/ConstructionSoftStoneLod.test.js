import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneLodProfile } from '../src/editor/construction/config/ConstructionStoneLodProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import { reduceStoneAppearanceForLod } from '../src/editor/construction/compile/ConstructionStoneLodReducer.js';
import {
  buildSoftStoneGeometry,
  estimateSoftStoneTopology,
} from '../src/editor/construction/compile/ConstructionSoftStoneGeometry.js';
import { resolveStoneTopology } from '../src/editor/construction/compile/ConstructionStoneTopologyResolver.js';
import {
  createStoneAppearanceDescriptor,
  topologyInputsFromAppearance,
} from '../src/editor/construction/masonry/StoneAppearanceDescriptor.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../src/editor/construction/render/ConstructionMortarConfig.js';

function rectangle(width, height) {
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
}

function bounds(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

function triangleCount(geometry) {
  return (geometry.index?.count ?? geometry.attributes.position.count) / 3;
}

function buildPair() {
  const width = 0.7;
  const height = 0.36;
  const depth = 0.8;
  const corners = rectangle(width, height);
  const lodProfile = constructionStoneLodProfile('soft-limestone-rubble');
  const appearance = createStoneAppearanceDescriptor({
    faceReliefProfile: constructionStoneReliefProfile('soft-limestone-rubble'),
    edgeWearProfile: constructionStoneEdgeWearProfile('soft-limestone-rubble'),
    seed: 3141,
    stableIndex: 21,
    category: 'field',
    width,
    height,
    depth,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
  });
  const stoneShape = {
    corners,
    width,
    height,
    depth,
    bevelRatio: 0.09,
    detail: 2,
    position: [0, 1, 0],
    rotation: [0, 0.1, 0],
  };

  const buildTier = (lodBand) => {
    const reduced = reduceStoneAppearanceForLod({ appearance, lodProfile, lodBand });
    const inputs = topologyInputsFromAppearance(reduced);
    const relief = Object.freeze({
      ...inputs.relief,
      front: Object.freeze({
        ...inputs.relief.front,
        columns: reduced.faceGrid.columns || 1,
        rows: reduced.faceGrid.rows || 1,
      }),
      back: Object.freeze({
        ...inputs.relief.back,
        columns: reduced.faceGrid.columns || 1,
        rows: reduced.faceGrid.rows || 1,
      }),
    });
    const topology = resolveStoneTopology({
      stoneShape,
      faceRelief: relief,
      edgeWear: inputs.edgeWear,
      mortarConfig: CONSTRUCTION_MORTAR_CONFIG,
      bevelRings: reduced.bevelRings,
      allowCornerFlattening: lodBand === 'near',
    });
    return buildSoftStoneGeometry({
      topology,
      stoneShape,
      geometryTier: reduced.geometryTier,
    });
  };

  return { near: buildTier('near'), coarse: buildTier('coarse'), appearance };
}

test('estimateSoftStoneTopology returns fixed buffer sizes', () => {
  const near = estimateSoftStoneTopology({
    faceGrid: { columns: 3, rows: 2 },
    bevelRings: 2,
  });
  const coarse = estimateSoftStoneTopology({
    faceGrid: { columns: 1, rows: 1 },
    bevelRings: 1,
  });
  assert.ok(coarse.triangles < near.triangles);
  assert.ok(coarse.triangles >= 32);
  assert.ok(coarse.triangles <= 48);
});

test('near and coarse soft stones share outer bounds', () => {
  const { near, coarse } = buildPair();
  assert.equal(near.reliefApplied, true);
  assert.equal(coarse.reliefApplied, true);
  assert.equal(near.geometryTier, 'near');
  assert.equal(coarse.geometryTier, 'coarse');

  const nearBounds = bounds(near.geometry);
  const coarseBounds = bounds(coarse.geometry);
  for (const axis of [0, 1, 3, 4]) {
    assert.ok(
      Math.abs(nearBounds[axis] - coarseBounds[axis]) < 1e-4,
      `xy axis ${axis}: ${nearBounds[axis]} vs ${coarseBounds[axis]}`,
    );
  }
  // Depth bounds stay within a millimetre-scale band: coarse reduces bevel
  // variation so max |z| can shift slightly while the footprint stays locked.
  for (const axis of [2, 5]) {
    assert.ok(
      Math.abs(nearBounds[axis] - coarseBounds[axis]) < 0.0025,
      `z axis ${axis}: ${nearBounds[axis]} vs ${coarseBounds[axis]}`,
    );
  }

  const nearTris = triangleCount(near.geometry);
  const coarseTris = triangleCount(coarse.geometry);
  assert.ok(coarseTris < nearTris);
  assert.ok(coarseTris > 12, 'coarse retains soft faces, not a flat box');
  assert.ok(coarseTris / nearTris <= 0.55);
});
