import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionJointProfile } from '../src/editor/construction/config/ConstructionJointProfiles.generated.js';
import {
  clampJointWidths,
  sampleJointWidths,
} from '../src/editor/construction/masonry/JointWidthField.js';

const soft = constructionJointProfile('soft-limestone-rubble');
const legacy = constructionJointProfile('default');

test('sampleJointWidths is deterministic', () => {
  const input = {
    profile: soft,
    seed: 3141,
    stableIndex: 42,
    lodBand: 'near',
  };
  assert.deepEqual(sampleJointWidths(input), sampleJointWidths(input));
});

test('stable indices vary within configured near ranges', () => {
  const heads = new Set();
  const beds = new Set();
  for (let index = 0; index < 64; index += 1) {
    const joints = sampleJointWidths({
      profile: soft,
      seed: 3141,
      stableIndex: index,
    });
    assert.ok(joints.head >= soft.headJoint.min - 1e-12);
    assert.ok(joints.head <= soft.headJoint.max + 1e-12);
    assert.ok(joints.bed >= soft.bedJoint.min - 1e-12);
    assert.ok(joints.bed <= soft.bedJoint.max + 1e-12);
    heads.add(joints.head.toFixed(6));
    beds.add(joints.bed.toFixed(6));
  }
  assert.ok(heads.size > 8);
  assert.ok(beds.size > 8);
});

test('head and bed use separate hash domains', () => {
  let matched = 0;
  const samples = 200;
  for (let index = 0; index < samples; index += 1) {
    const joints = sampleJointWidths({
      profile: soft,
      seed: 99,
      stableIndex: index,
    });
    const headT = (joints.head - soft.headJoint.min)
      / (soft.headJoint.max - soft.headJoint.min);
    const bedT = (joints.bed - soft.bedJoint.min)
      / (soft.bedJoint.max - soft.bedJoint.min);
    if (Math.abs(headT - bedT) < 1e-9) matched += 1;
  }
  assert.ok(matched < samples * 0.05, `correlated samples ${matched}/${samples}`);
});

test('coarse lod amplifies soft limestone ranges', () => {
  for (let index = 0; index < 32; index += 1) {
    const joints = sampleJointWidths({
      profile: soft,
      seed: 7,
      stableIndex: index,
      lodBand: 'coarse',
    });
    assert.ok(joints.head >= soft.headJoint.min * soft.coarseLodMultiplier - 1e-12);
    assert.ok(joints.head <= soft.headJoint.max * soft.coarseLodMultiplier + 1e-12);
    assert.ok(joints.bed >= soft.bedJoint.min * soft.coarseLodMultiplier - 1e-12);
    assert.ok(joints.bed <= soft.bedJoint.max * soft.coarseLodMultiplier + 1e-12);
  }
});

test('legacy profile reproduces current head and bed ranges', () => {
  for (let index = 0; index < 48; index += 1) {
    const joints = sampleJointWidths({
      profile: legacy,
      seed: 1,
      stableIndex: index,
    });
    assert.ok(joints.head >= 0.012 - 1e-12 && joints.head <= 0.03 + 1e-12);
    assert.ok(joints.bed >= 0.0084 - 1e-12 && joints.bed <= 0.021 + 1e-12);
  }
});

test('clampJointWidths protects minimum rendered size', () => {
  const sampled = { head: 0.08, bed: 0.06 };
  const face = { width: 0.16, height: 0.11 };
  const clamped = clampJointWidths(face, sampled, soft);
  assert.equal(clamped.head, face.width - soft.minimumRenderedWidth);
  assert.equal(clamped.bed, face.height - soft.minimumRenderedHeight);
  assert.equal(clamped.headClamped, true);
  assert.equal(clamped.bedClamped, true);
  assert.ok(face.width - clamped.head >= soft.minimumRenderedWidth - 1e-12);
  assert.ok(face.height - clamped.bed >= soft.minimumRenderedHeight - 1e-12);
});
