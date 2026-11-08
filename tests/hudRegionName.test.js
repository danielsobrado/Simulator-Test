import assert from 'node:assert/strict';
import test from 'node:test';
import { createVectorMapModel } from '../src/editor/map/worldMapVector.js';
import { HudRegionMap } from '../src/editor/player/hud/HudRegionMap.js';

// Two triangles splitting a 100×100 Azgaar map along its diagonal: cell 0 is
// the upper-right half (province 10), cell 1 the lower-left (state 2 only).
const cartography = {
  width: 100,
  height: 100,
  vertexIds: Uint32Array.from([10, 20, 30, 40]),
  vertexPoints: Float32Array.from([0, 0, 100, 0, 100, 100, 0, 100]),
  cellIds: Uint32Array.from([5, 9]),
  cellCenters: Float32Array.from([66, 33, 33, 66]),
  vertexOffsets: Uint32Array.from([0, 3, 6]),
  cellVertexIds: Uint32Array.from([10, 20, 30, 10, 30, 40]),
  heights: Uint8Array.from([70, 50]),
  biomes: Uint8Array.from([6, 4]),
  features: Uint32Array.from([1, 1]),
  states: Uint32Array.from([1, 2]),
  provinces: Uint32Array.from([10, 0]),
  cultures: Uint32Array.from([0, 0]),
  religions: Uint32Array.from([0, 0]),
  burgs: Uint32Array.from([0, 0]),
};
const campaign = {
  states: [{ i: 1, name: 'Frostgard' }, { i: 2, name: 'Stonehold' }],
  provinces: [{ i: 10, name: 'Hlurtherise March' }],
  // World cells 0..99 map one-to-one onto the source; source y runs south.
  source: { target: { minCellX: 0, minCellZ: 0, widthCells: 100, heightCells: 100 }, sourceWidth: 100, sourceHeight: 100 },
};
const describe = (x, z) => HudRegionMap.prototype.describeRegion.call({
  resolveModel: () => createVectorMapModel(cartography, campaign, null),
  modelCampaign: campaign,
}, x, z);

test('names the province under the player, else its state', () => {
  assert.equal(describe(80, 80), 'Hlurtherise March'); // source (80.5, 19.5): upper-right
  assert.equal(describe(20, 20), 'Stonehold'); // source (20.5, 79.5): no province
});

test('has no region off the map', () => {
  assert.equal(describe(500, 500), null);
});
