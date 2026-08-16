import assert from 'node:assert/strict';
import test from 'node:test';

import { constructionJointProfile } from '../src/editor/construction/config/ConstructionJointProfiles.generated.js';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneLodProfile } from '../src/editor/construction/config/ConstructionStoneLodProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import {
  CONSTRUCTION_MORTAR_CONFIG,
  mortarProfile,
} from '../src/editor/construction/render/ConstructionMortarConfig.js';

test('coursed rubble uses the soft hand-cut stone appearance pipeline', () => {
  const style = constructionStyle('coursed-rubble');
  const relief = constructionStoneReliefProfile(style.key);
  const edgeWear = constructionStoneEdgeWearProfile(style.key);
  const lod = constructionStoneLodProfile(style.key);

  assert.equal(style.stonePalette, 'soft-limestone');
  assert.ok(style.irregularity >= 0.5);
  assert.ok(style.faceOffsetAmplitude >= 0.014);
  assert.ok(style.depthScaleMin <= 0.93);
  assert.ok(style.depthScaleMax >= 1);

  assert.equal(relief.enabled, true);
  assert.equal(relief.grid.columns, 2);
  assert.equal(relief.grid.rows, 2);
  assert.equal(edgeWear.enabled, true);
  assert.ok(edgeWear.cornerVariation.amount >= 0.25);
  assert.ok(edgeWear.cornerFlattening.chance >= 0.18);

  assert.equal(lod.near.mode, 'soft');
  assert.equal(lod.near.bevelRings, 2);
  assert.equal(lod.near.cornerFlattening, true);
  assert.equal(lod.coarse.mode, 'soft-coarse');
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
