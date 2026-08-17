import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStoneTopology } from '../src/editor/construction/compile/ConstructionStoneTopologyResolver.js';
import { constructionJointProfile } from '../src/editor/construction/config/ConstructionJointProfiles.generated.js';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneLodProfile } from '../src/editor/construction/config/ConstructionStoneLodProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import {
  CONSTRUCTION_MORTAR_CONFIG,
  mortarProfile,
} from '../src/editor/construction/render/ConstructionMortarConfig.js';
import { stoneSurfaceProfile } from '../src/editor/workshop/ProceduralWorkshopStoneSurfaceConfig.js';

test('coursed rubble uses the soft hand-cut stone appearance pipeline', () => {
  const style = constructionStyle('coursed-rubble');
  const relief = constructionStoneReliefProfile(style.key);
  const edgeWear = constructionStoneEdgeWearProfile(style.key);
  const lod = constructionStoneLodProfile(style.key);
  const surface = stoneSurfaceProfile(style.stonePalette);

  assert.equal(style.stonePalette, 'soft-limestone');
  assert.ok(style.irregularity >= 0.56);
  assert.ok(style.faceOffsetAmplitude >= 0.018);
  assert.ok(style.depthScaleMin <= 0.92);
  assert.ok(style.depthScaleMax >= 1.02);

  assert.equal(relief.enabled, true);
  assert.equal(relief.grid.columns, 3);
  assert.equal(relief.grid.rows, 2);
  assert.ok(relief.recession.ratioMax >= 0.046);
  assert.ok(relief.asymmetry >= 0.32);

  assert.equal(edgeWear.enabled, true);
  assert.ok(edgeWear.bevel.widthRatio.max >= 0.13);
  assert.ok(edgeWear.cornerVariation.amount >= 0.3);
  assert.ok(edgeWear.edgeVariation.amount >= 0.18);
  assert.ok(edgeWear.cornerFlattening.chance >= 0.24);

  assert.equal(lod.near.mode, 'soft');
  assert.equal(lod.near.bevelRings, 2);
  assert.equal(lod.near.edgeMidpoints, true);
  assert.equal(lod.near.cornerFlattening, true);
  assert.equal(lod.coarse.mode, 'soft-coarse');
  assert.equal(lod.coarse.edgeMidpoints, false);

  assert.ok(surface.unitShading.brightnessMin <= 0.945);
  assert.ok(surface.unitShading.brightnessMax >= 1.055);
  assert.ok(surface.material.bumpScale <= 0.02);
  assert.ok(surface.material.constructionNormalScale <= 0.22);
  assert.ok(surface.material.constructionEnvMapIntensity >= 0.64);
});

test('coursed rubble keeps readable recessed joints and contact shadow', () => {
  const joints = constructionJointProfile('coursed-rubble');
  const mortar = mortarProfile('coursed-rubble');

  assert.ok(joints.headJoint.min >= 0.02);
  assert.ok(joints.bedJoint.min >= 0.015);
  assert.ok(joints.headJoint.max <= 0.05);
  assert.ok(joints.bedJoint.max <= 0.04);
  assert.ok(CONSTRUCTION_MORTAR_CONFIG.faceRecess >= 0.04);
  assert.equal(mortar.color, '#66645d');
});

test('soft stone topology adds inward-only hand-cut edge midpoints', () => {
  const wearSide = Object.freeze({
    enabled: true,
    cornerWidth: Object.freeze([0.05, 0.052, 0.048, 0.051]),
    cornerDepth: Object.freeze([0.03, 0.032, 0.029, 0.031]),
    edgeMidpointScale: Object.freeze([1.18, 0.84, 1.12, 0.88]),
    cornerFlattening: Object.freeze([0, 0, 0, 0]),
    safeguards: Object.freeze({
      minimumFaceAreaRatio: 0.58,
      minimumEdgeLength: 0.06,
      maximumInsetEdgeRatio: 0.28,
      maximumDepthFraction: 0.35,
      maximumMortarFraction: 0.65,
    }),
  });
  const reliefSide = Object.freeze({ enabled: true, edgeRecession: 0.01 });
  const topology = resolveStoneTopology({
    stoneShape: {
      corners: [
        [-0.5, -0.25],
        [0.5, -0.25],
        [0.5, 0.25],
        [-0.5, 0.25],
      ],
      width: 1,
      height: 0.5,
      depth: 0.4,
    },
    faceRelief: { front: reliefSide, back: reliefSide },
    edgeWear: { front: wearSide, back: wearSide },
    mortarConfig: CONSTRUCTION_MORTAR_CONFIG,
    bevelRings: 2,
    allowCornerFlattening: false,
  });

  assert.equal(topology.valid, true);
  assert.equal(topology.diagnostics.edgeMidpointsApplied, true);
  assert.equal(topology.front.sourceLoop.length, 8);
  assert.equal(topology.front.shoulderLoop.length, 8);
  assert.equal(topology.front.faceLoop.length, 8);
  assert.equal(topology.front.outerDepths.length, 8);

  // The worn bottom midpoint moves into the stone, never outside the solved
  // lattice footprint where it could collide with its neighbour.
  assert.ok(topology.front.sourceLoop[1][1] > -0.25);
  assert.ok(topology.front.sourceLoop[1][1] < topology.front.faceLoop[1][1]);
  assert.ok(topology.front.sourceLoop[1][0] >= -0.5);
  assert.ok(topology.front.sourceLoop[1][0] <= 0.5);
});
