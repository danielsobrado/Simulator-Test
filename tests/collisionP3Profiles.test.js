import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveTreeCollisionProfile,
  deriveTreeCollisionProfiles,
  treeCollisionProfileSignature,
} from '../src/editor/collision/providers/TreeCollisionProfiles.js';

function attribute(points) {
  return {
    count: points.length,
    getX: (index) => points[index][0],
    getY: (index) => points[index][1],
    getZ: (index) => points[index][2],
  };
}

function part(kind, points) {
  return {
    kind,
    geometry: {
      getAttribute: (name) => (name === 'position' ? attribute(points) : null),
    },
  };
}

function ring(y, radius, count = 8) {
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  });
}

const config = Object.freeze({
  minimumTrunkRadius: 0.16,
  prototypeOverrides: Object.freeze({}),
});

test('tree profile derives from lower trunk and ignores leaves and high branches', () => {
  const trunk = [
    [0, 0, 0],
    ...ring(1, 0.5),
    ...ring(2, 0.48),
    ...ring(3, 0.52),
    ...ring(8, 4),
    [0, 10, 0],
  ];
  const leaves = ring(6, 12, 16);
  const profile = deriveTreeCollisionProfile({
    parts: [part('trunk', trunk), part('leaf', leaves)],
    prototypeIndex: 0,
    config,
  });

  assert.ok(profile.radius > 0.45 && profile.radius < 0.6);
  assert.equal(profile.height, 10);
  assert.ok(Math.abs(profile.centerX) < 1e-9);
  assert.ok(Math.abs(profile.centerZ) < 1e-9);
  assert.equal(profile.baseY, 0);
});

test('sparse low-poly trunks use the complete lower-band fallback', () => {
  const profile = deriveTreeCollisionProfile({
    parts: [part('trunk', [
      [0, 0, 0],
      [0.4, 2, 0],
      [-0.2, 2, 0.3464101615],
      [-0.2, 2, -0.3464101615],
      [0, 10, 0],
    ])],
    prototypeIndex: 0,
    config,
  });
  assert.ok(profile.radius >= 0.39 && profile.radius <= 0.41);
});

test('two-ring cylinder trunks derive from the grounded ring', () => {
  const profile = deriveTreeCollisionProfile({
    parts: [part('trunk', [
      ...ring(0, 0.45),
      ...ring(10, 0.35),
    ])],
    prototypeIndex: 0,
    config,
  });
  assert.ok(profile.radius >= 0.44 && profile.radius <= 0.46);
  assert.equal(profile.baseY, 0);
  assert.equal(profile.height, 10);
});

test('invalid lower trunks require and accept explicit overrides', () => {
  const parts = [part('trunk', [[0, 0, 0], [0, 10, 0]])];
  assert.throws(
    () => deriveTreeCollisionProfile({ parts, prototypeIndex: 2, config }),
    /prototype override/,
  );

  const overridden = deriveTreeCollisionProfile({
    parts,
    prototypeIndex: 2,
    config: {
      minimumTrunkRadius: 0.16,
      prototypeOverrides: {
        'prototype:2': {
          radius: 0.35,
          height: 7,
          centerX: 0.1,
          centerZ: -0.2,
          baseY: 0.05,
        },
      },
    },
  });
  assert.deepEqual(overridden, {
    id: 'prototype:2',
    prototypeIndex: 2,
    radius: 0.35,
    height: 7,
    centerX: 0.1,
    centerZ: -0.2,
    baseY: 0.05,
  });
});

test('profile sets and signatures are deterministic and immutable', () => {
  const prototypes = [[part('trunk', [
    [0, 0, 0],
    ...ring(2, 0.4),
    [0, 8, 0],
  ])]];
  const profiles = deriveTreeCollisionProfiles({ prototypes, config });
  assert.equal(Object.isFrozen(profiles), true);
  assert.equal(Object.isFrozen(profiles[0]), true);
  assert.equal(treeCollisionProfileSignature(profiles), treeCollisionProfileSignature(profiles));
});
