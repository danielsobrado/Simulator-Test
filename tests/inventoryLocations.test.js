import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bagLocation,
  parseLocation,
  serializeLocation,
  weaponLocation,
} from '../src/editor/inventory/inventoryLocations.js';

test('parseLocation rejects empty and negative bag indices', () => {
  assert.equal(parseLocation('bag:'), null);
  assert.equal(parseLocation('bag:-1'), null);
  assert.equal(parseLocation('bag:1.5'), null);
  assert.equal(parseLocation('bag:abc'), null);
  assert.deepEqual(parseLocation('bag:0'), bagLocation(0));
  assert.deepEqual(parseLocation('bag:12'), bagLocation(12));
});

test('parseLocation rejects malformed weapon keys', () => {
  assert.equal(parseLocation('weapon:'), null);
  assert.equal(parseLocation('weapon:1:'), null);
  assert.equal(parseLocation('weapon:-1:mainHand'), null);
  assert.deepEqual(parseLocation('weapon:1:mainHand'), weaponLocation(1, 'mainHand'));
});

test('serializeLocation round-trips valid locations', () => {
  assert.equal(serializeLocation(bagLocation(3)), 'bag:3');
  assert.deepEqual(parseLocation(serializeLocation(weaponLocation(2, 'offHand'))), weaponLocation(2, 'offHand'));
});
