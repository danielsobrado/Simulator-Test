import assert from 'node:assert/strict';
import test from 'node:test';
import { ALPINE_ROCK_KINDS, alpineRocksInCell } from '../src/editor/stylized/alpine/alpineRockField.js';
import { createAlpineRockGeometry } from '../src/editor/stylized/alpine/alpineRockGeometry.js';
import { CellResidency } from '../src/editor/stylized/lod/CellResidency.js';
import { ridgeFineHeight, ridgedField } from '../src/editor/world/MountainRidges.js';

const across = (ground) => {
  const found = [];
  for (let x = -60; x < 60; x += 1) for (let z = -60; z < 60; z += 1) found.push(...(alpineRocksInCell(x, z, ground) ?? []));
  return found;
};

test('steep ground grows single crags and flats grow clusters, nothing where it is not allowed', () => {
  const steep = across(() => ({ allowed: true, slope: 0.9 }));
  const flat = across(() => ({ allowed: true, slope: 0.1 }));
  assert.ok(steep.length > 5000 && steep.every((rock) => rock.scale >= 5));
  assert.ok(flat.length > 800 && flat.some((rock) => rock.scale > 2.2) && flat.some((rock) => rock.scale < 1));
  assert.equal(across(() => ({ allowed: false, slope: 0.9 })).length, 0);
  assert.equal(across(() => ({ allowed: true, slope: 0.4 })).length, 0, 'mid slopes stay clean');
  assert.deepEqual(alpineRocksInCell(3, 4, () => ({ allowed: true, slope: 0.9 })), alpineRocksInCell(3, 4, () => ({ allowed: true, slope: 0.9 })));
});

test('every rock shape is a closed irregular solid', () => {
  for (let kind = 0; kind < ALPINE_ROCK_KINDS; kind += 1) {
    const geometry = createAlpineRockGeometry(kind);
    assert.ok(geometry.attributes.normal.count > 500);
    assert.ok(Number.isFinite(geometry.boundingSphere.radius));
  }
});

test('residency works cells off a budget and reports settled changes once', () => {
  const residency = new CellResidency({ cellMeters: 10, reachCells: 1, cellsPerFrame: 4 });
  residency.refocus(5, 5);
  assert.equal(residency.step(() => ({})), false);
  assert.equal(residency.step(() => ({})), false);
  assert.equal(residency.step(() => ({})), true);
  assert.equal(residency.values().length, 9);
  residency.refocus(15, 5);
  assert.equal(residency.cells.size, 6);
  assert.equal(residency.step(() => null), true, 'losing cells is a change too');
  assert.equal(residency.step(() => null), false);
});

test('fine relief stays off without a depth, and ridges stay in range once warped', () => {
  const ridges = { startRelief: 0.3, fullRelief: 0.65 };
  assert.equal(ridgeFineHeight(10, 10, 1, 0.9, ridges), 0);
  assert.ok(Math.abs(ridgeFineHeight(10, 10, 1, 0.9, { ...ridges, fineMeters: 16 })) <= 16 * 1.35);
  for (let i = 0; i < 400; i += 1) {
    const value = ridgedField(i * 37.3, i * 11.7, 5);
    assert.ok(value >= 0 && value <= 1);
  }
});
