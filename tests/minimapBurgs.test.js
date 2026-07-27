import assert from 'node:assert/strict';
import test from 'node:test';
import { selectMinimapBurgs } from '../src/editor/map/minimapBurgs.js';

// 1000×800 source pixels mapped onto a 1000×800 cell world centred on the
// origin, so one source pixel is one cell and burg positions are easy to read.
function createCampaign(burgs, states = []) {
  return {
    source: {
      sourceWidth: 1000,
      sourceHeight: 800,
      target: {
        minCellX: -500, minCellZ: -400, widthCells: 1000, heightCells: 800,
      },
    },
    states,
    burgs,
  };
}

test('a burg inside the window lands at its normalized window position', () => {
  const campaign = createCampaign([{ i: 1, name: 'Harborwatch', x: 550, y: 400 }]);
  const [marker] = selectMinimapBurgs({
    campaign,
    center: { x: 0, z: 0 },
    cells: 192,
  });
  assert.equal(marker.name, 'Harborwatch');
  assert.equal(marker.offscreen, false);
  // 50 cells east of centre, on the centre's Z row.
  assert.ok(Math.abs(marker.u - (0.5 + 50 / 192)) < 1e-9);
  assert.ok(Math.abs(marker.v - 0.5) < 1e-9);
});

test('a nearby burg outside the window is clamped to the rim and flagged offscreen', () => {
  const campaign = createCampaign([{ i: 1, name: 'Farhold', x: 650, y: 400 }]);
  const [marker] = selectMinimapBurgs({
    campaign,
    center: { x: 0, z: 0 },
    cells: 192,
  });
  assert.equal(marker.offscreen, true);
  assert.ok(Math.abs(marker.distanceCells - 150) < 1);
  // Due east, so it pins to the rim on the centre row.
  assert.ok(Math.abs(marker.u - 0.94) < 1e-6);
  assert.ok(Math.abs(marker.v - 0.5) < 1e-9);
});

test('burgs beyond the edge range are dropped', () => {
  const campaign = createCampaign([{ i: 1, name: 'Distant', x: 900, y: 400 }]);
  assert.deepEqual(
    selectMinimapBurgs({ campaign, center: { x: 0, z: 0 }, cells: 192 }),
    [],
  );
});

test('markers are ordered nearest first and capped', () => {
  const campaign = createCampaign([
    { i: 1, name: 'Far', x: 560, y: 400 },
    { i: 2, name: 'Near', x: 505, y: 400 },
    { i: 3, name: 'Middle', x: 530, y: 400 },
  ]);
  const markers = selectMinimapBurgs({
    campaign,
    center: { x: 0, z: 0 },
    cells: 192,
    maxMarkers: 2,
  });
  assert.deepEqual(markers.map((marker) => marker.name), ['Near', 'Middle']);
});

test('state colour is used when the burg belongs to one, and removed burgs are skipped', () => {
  const campaign = createCampaign(
    [
      { i: 1, name: 'Crownrest', x: 510, y: 400, state: 3, capital: 1 },
      { i: 2, name: 'Ruin', x: 512, y: 400, removed: true },
      { i: 3, name: 'Nowhere', x: Number.NaN, y: 400 },
    ],
    [{ i: 3, color: '#6a8fd0' }],
  );
  const markers = selectMinimapBurgs({ campaign, center: { x: 0, z: 0 }, cells: 192 });
  assert.equal(markers.length, 1);
  assert.equal(markers[0].color, '#6a8fd0');
  assert.equal(markers[0].capital, true);
});

test('worlds without an Azgaar campaign get no markers', () => {
  assert.deepEqual(selectMinimapBurgs({ campaign: null, center: { x: 0, z: 0 }, cells: 192 }), []);
  assert.deepEqual(
    selectMinimapBurgs({ campaign: { burgs: [] }, center: { x: 0, z: 0 }, cells: 192 }),
    [],
  );
});
