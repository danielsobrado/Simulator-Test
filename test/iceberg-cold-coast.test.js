import test from 'node:test';
import assert from 'node:assert/strict';
import { IcebergView } from '../src/editor/stylized/ice/IcebergView.js';

const TUNDRA = 10;
const GRASSLAND = 4;
const snowGroundByTile = { [TUNDRA]: 0.95, [GRASSLAND]: 0 };

/** isColdCoast on a world laid out by `tileAt(x, z)`. */
function coldCoast(tileAt) {
  return IcebergView.prototype.isColdCoast.call({ tileAt, snowGroundByTile }, 0, 0);
}

test('a coast of mostly tundra calves icebergs', () => {
  assert.equal(coldCoast((x, z) => (x < 0 && Math.abs(z) < 10 ? GRASSLAND : TUNDRA)), true);
});

test('one snowy patch beside a temperate coast does not', () => {
  assert.equal(coldCoast((x, z) => (x > 1500 && Math.abs(z) < 10 ? TUNDRA : GRASSLAND)), false);
});

test('open sea in every direction is not a coast', () => {
  assert.equal(coldCoast(() => 0), false);
});
