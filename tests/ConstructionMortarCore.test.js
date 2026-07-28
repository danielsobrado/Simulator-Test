import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMortarCoreGeometry,
  expandCorners,
  mortarCoreDepth,
} from '../src/editor/construction/compile/ConstructionMortarCoreBuilder.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../src/editor/construction/render/ConstructionMortarConfig.js';

function assertFiniteAttribute(attribute, label) {
  const array = attribute.array;
  for (let index = 0; index < array.length; index += 1) {
    assert.ok(Number.isFinite(array[index]), `${label}[${index}] must be finite`);
  }
}

const UNIT_PRISM = Object.freeze({
  corners: [
    [-0.5, -0.25],
    [0.5, -0.25],
    [0.5, 0.25],
    [-0.5, 0.25],
  ],
  depth: 0.7,
  position: [0, 1, 0],
  rotation: [0, 0, 0],
});

test('one prism has the expected structure', () => {
  const geometry = buildMortarCoreGeometry([UNIT_PRISM]);
  assert.ok(geometry);
  assert.equal(geometry.getAttribute('position').count, 24);
  assert.equal(geometry.getAttribute('normal').count, 24);
  assert.equal(geometry.getAttribute('uv').count, 24);
  assert.equal(geometry.getIndex().count, 36);
  assert.equal(geometry.getIndex().count / 3, 12);
  assertFiniteAttribute(geometry.getAttribute('position'), 'position');
  assertFiniteAttribute(geometry.getAttribute('normal'), 'normal');
  assertFiniteAttribute(geometry.getAttribute('uv'), 'uv');
  geometry.dispose();
});

test('multiple prisms use one geometry', () => {
  const geometry = buildMortarCoreGeometry([
    UNIT_PRISM,
    { ...UNIT_PRISM, position: [1, 1, 0] },
    { ...UNIT_PRISM, position: [2, 1, 0] },
  ]);
  assert.equal(geometry.getAttribute('position').count, 72);
  assert.equal(geometry.getIndex().count, 108);
  assert.equal(geometry.type, 'BufferGeometry');
  geometry.dispose();
});

test('depth is recessed from both faces', () => {
  const stoneDepth = 0.8;
  const coreDepth = mortarCoreDepth(stoneDepth, CONSTRUCTION_MORTAR_CONFIG);
  assert.ok(coreDepth < stoneDepth);
  assert.ok(Math.abs(coreDepth - 0.73) < 1e-9);
});

test('backing expands in plane by absolute overlap', () => {
  const corners = [
    [-0.5, -0.25],
    [0.5, -0.25],
    [0.5, 0.25],
    [-0.5, 0.25],
  ];
  const expanded = expandCorners(corners, 0.024);
  const width = expanded[1][0] - expanded[0][0];
  const height = expanded[2][1] - expanded[1][1];
  assert.ok(Math.abs(width - 1.048) < 1e-9, `width=${width}`);
  assert.ok(Math.abs(height - 0.548) < 1e-9, `height=${height}`);
});

test('rotated prism bounds remain finite', () => {
  const geometry = buildMortarCoreGeometry([{
    ...UNIT_PRISM,
    rotation: [0.01, Math.PI / 3, -0.02],
  }]);
  assert.ok(geometry.boundingBox);
  assert.ok(geometry.boundingSphere);
  assert.ok(geometry.boundingSphere.radius > 0);
  assertFiniteAttribute(geometry.getAttribute('position'), 'position');
  for (const key of ['min', 'max']) {
    const corner = geometry.boundingBox[key];
    assert.ok(Number.isFinite(corner.x));
    assert.ok(Number.isFinite(corner.y));
    assert.ok(Number.isFinite(corner.z));
  }
  geometry.dispose();
});

test('invalid descriptor fails clearly with index', () => {
  const cases = [
    { descriptor: { depth: 0.5, position: [0, 0, 0] }, match: /descriptor 0/ },
    {
      descriptor: {
        corners: [[0, 0], [1, 0], [1, 1]],
        depth: 0.5,
        position: [0, 0, 0],
      },
      match: /descriptor 0/,
    },
    {
      descriptor: { ...UNIT_PRISM, depth: 0 },
      match: /descriptor 0/,
    },
    {
      descriptor: { ...UNIT_PRISM, position: [0, NaN, 0] },
      match: /descriptor 0/,
    },
    {
      descriptor: {
        corners: [[0, 0], [0, 0], [0, 0], [0, 0]],
        depth: 0.5,
        position: [0, 0, 0],
      },
      match: /descriptor 0/,
    },
  ];
  for (const { descriptor, match } of cases) {
    assert.throws(() => buildMortarCoreGeometry([descriptor]), match);
  }
  assert.throws(
    () => buildMortarCoreGeometry([UNIT_PRISM, { ...UNIT_PRISM, depth: -1 }]),
    /descriptor 1/,
  );
});

test('empty input returns null', () => {
  assert.equal(buildMortarCoreGeometry([]), null);
  assert.equal(buildMortarCoreGeometry(null), null);
});
