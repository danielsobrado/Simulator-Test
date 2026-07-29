import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionRuinProfile } from '../src/editor/construction/config/ConstructionRuinConfig.generated.js';
import { CONSTRUCTION_SUPPORT_ROLE } from '../src/editor/construction/masonry/ConstructionSupportRoles.js';
import { resolveArchCompression } from '../src/editor/construction/masonry/RuinArchCompression.js';

const profile = constructionRuinProfile('default');

function unit({
  id,
  s0,
  s1,
  bottom,
  top,
  role = CONSTRUCTION_SUPPORT_ROLE.ARCH,
  archOrdinal = 0,
  moduleId = 'm0',
  face = 0,
}) {
  return {
    _ruinId: id,
    moduleId,
    stableIndex: id,
    s: (s0 + s1) / 2,
    offsetNormal: face * 0.5,
    support: {
      role,
      span: [s0, s1],
      bottom,
      top,
      courseIndex: -1,
      archOrdinal,
      face,
      groupId: 'opening:door:arch',
    },
  };
}

function jamb({ id, s0, s1, bottom, top, side, jambOrdinal = 0 }) {
  return {
    _ruinId: id,
    moduleId: 'm0',
    stableIndex: id,
    s: (s0 + s1) / 2,
    support: {
      role: CONSTRUCTION_SUPPORT_ROLE.JAMB,
      span: [s0, s1],
      bottom,
      top,
      courseIndex: -1,
      jambOrdinal,
      side,
      groupId: `opening:door:${side < 0 ? 'left' : 'right'}-jamb`,
    },
  };
}

function survivorsOf(stones) {
  return new Map(stones.map((stone) => [stone._ruinId, stone]));
}

test('compression keeps a closed ring when both springs bear on jambs', () => {
  const leftJamb = jamb({ id: 1, s0: 0.4, s1: 0.55, bottom: 0.4, top: 1.2, side: -1 });
  const rightJamb = jamb({ id: 2, s0: 1.45, s1: 1.6, bottom: 0.4, top: 1.2, side: 1 });
  const left = unit({ id: 10, s0: 0.55, s1: 0.9, bottom: 1.2, top: 1.45 });
  const key = unit({
    id: 11,
    s0: 0.85,
    s1: 1.15,
    bottom: 1.4,
    top: 1.7,
    archOrdinal: 1,
    role: CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
  });
  const right = unit({ id: 12, s0: 1.1, s1: 1.45, bottom: 1.2, top: 1.45, archOrdinal: 2 });
  const survivors = survivorsOf([leftJamb, rightJamb, left, key, right]);

  const resolved = resolveArchCompression({
    arches: [left, key, right],
    leftJambs: [leftJamb],
    rightJambs: [rightJamb],
    fieldPool: [],
    survivors,
    profile,
  });
  assert.equal(resolved.leftSpringSupported, true);
  assert.equal(resolved.rightSpringSupported, true);
  assert.equal(resolved.remove.size, 0);
  assert.equal(resolved.kept, 3);
});

test('compression drops the keystone when only one spring bears', () => {
  const leftJamb = jamb({ id: 1, s0: 0.4, s1: 0.55, bottom: 0.4, top: 1.2, side: -1 });
  const left = unit({ id: 10, s0: 0.55, s1: 0.9, bottom: 1.2, top: 1.45 });
  const key = unit({
    id: 11,
    s0: 0.85,
    s1: 1.15,
    bottom: 1.4,
    top: 1.7,
    archOrdinal: 1,
    role: CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
  });
  const right = unit({ id: 12, s0: 1.1, s1: 1.45, bottom: 1.2, top: 1.45, archOrdinal: 2 });
  const survivors = survivorsOf([leftJamb, left, key, right]);

  const resolved = resolveArchCompression({
    arches: [left, key, right],
    leftJambs: [leftJamb],
    rightJambs: [],
    fieldPool: [],
    survivors,
    profile,
  });
  assert.equal(resolved.leftSpringSupported, true);
  assert.equal(resolved.rightSpringSupported, false);
  assert.ok(resolved.remove.has(11));
  assert.ok(resolved.remove.has(12));
});

test('field-bearing spring can replace a missing jamb crown', () => {
  const field = {
    _ruinId: 50,
    moduleId: 'm0',
    support: {
      role: CONSTRUCTION_SUPPORT_ROLE.FIELD,
      span: [0.5, 0.95],
      bottom: 0.8,
      top: 1.2,
      courseIndex: 2,
    },
  };
  const left = unit({ id: 10, s0: 0.55, s1: 0.9, bottom: 1.2, top: 1.45 });
  const rightJamb = jamb({ id: 2, s0: 1.45, s1: 1.6, bottom: 0.4, top: 1.2, side: 1 });
  const right = unit({ id: 12, s0: 1.1, s1: 1.45, bottom: 1.2, top: 1.45, archOrdinal: 1 });
  const survivors = survivorsOf([field, left, rightJamb, right]);

  const resolved = resolveArchCompression({
    arches: [left, right],
    leftJambs: [],
    rightJambs: [rightJamb],
    fieldPool: [field],
    survivors,
    profile,
  });
  assert.equal(resolved.leftSpringSupported, true);
  assert.equal(resolved.rightSpringSupported, true);
});

test('interleaved front and rear voussoirs resolve as separate compression chains', () => {
  const leftJamb = jamb({ id: 1, s0: 0.4, s1: 0.55, bottom: 0.4, top: 1.2, side: -1 });
  const rightJamb = jamb({ id: 2, s0: 1.45, s1: 1.6, bottom: 0.4, top: 1.2, side: 1 });
  const frontRight = unit({
    id: 20, s0: 1.1, s1: 1.45, bottom: 1.2, top: 1.45, archOrdinal: 0, face: 1,
  });
  const rearRight = unit({
    id: 21, s0: 1.1, s1: 1.45, bottom: 1.2, top: 1.45, archOrdinal: 1, face: -1,
  });
  const frontLeft = unit({
    id: 22, s0: 0.55, s1: 0.9, bottom: 1.2, top: 1.45, archOrdinal: 2, face: 1,
  });
  const rearLeft = unit({
    id: 23, s0: 0.55, s1: 0.9, bottom: 1.2, top: 1.45, archOrdinal: 3, face: -1,
  });
  const key = unit({
    id: 24,
    s0: 0.85,
    s1: 1.15,
    bottom: 1.4,
    top: 1.7,
    archOrdinal: 999,
    role: CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
  });
  const arches = [frontRight, rearRight, frontLeft, rearLeft, key];
  const survivors = survivorsOf([leftJamb, rightJamb, ...arches]);

  const resolved = resolveArchCompression({
    arches,
    leftJambs: [leftJamb],
    rightJambs: [rightJamb],
    fieldPool: [],
    survivors,
    profile,
  });
  assert.equal(resolved.leftSpringSupported, true);
  assert.equal(resolved.rightSpringSupported, true);
  assert.equal(resolved.remove.size, 0);
  assert.equal(resolved.kept, arches.length);
});

test('shared keystone is removed when either rendered face loses compression', () => {
  const leftJamb = jamb({ id: 1, s0: 0.4, s1: 0.55, bottom: 0.4, top: 1.2, side: -1 });
  const rightJamb = jamb({ id: 2, s0: 1.45, s1: 1.6, bottom: 0.4, top: 1.2, side: 1 });
  const frontLeft = unit({ id: 30, s0: 0.55, s1: 0.9, bottom: 1.2, top: 1.45, face: 1 });
  const frontRight = unit({ id: 31, s0: 1.1, s1: 1.45, bottom: 1.2, top: 1.45, face: 1 });
  const rearRight = unit({ id: 32, s0: 1.1, s1: 1.45, bottom: 1.2, top: 1.45, face: -1 });
  const key = unit({
    id: 33,
    s0: 0.85,
    s1: 1.15,
    bottom: 1.4,
    top: 1.7,
    role: CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
  });
  const arches = [frontLeft, frontRight, rearRight, key];
  const survivors = survivorsOf([leftJamb, rightJamb, ...arches]);

  const resolved = resolveArchCompression({
    arches,
    leftJambs: [leftJamb],
    rightJambs: [rightJamb],
    fieldPool: [],
    survivors,
    profile,
  });
  assert.ok(resolved.remove.has(key._ruinId));
});
