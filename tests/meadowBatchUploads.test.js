import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { MeadowGrassBatches } from '../src/editor/stylized/meadow/MeadowGrassBatches.js';
import { meadowPageTileCapacity } from '../src/editor/stylized/meadow/MeadowBandBatch.js';
import { createMeadowTemplate } from '../src/editor/stylized/meadow/meadowGrassGeometry.js';

function fixture(t, { dense = true } = {}) {
  const template = createMeadowTemplate({ detail: 2, count: 16, tileSize: 8 });
  const denseTemplate = dense ? createMeadowTemplate({ detail: 2, count: 20000, tileSize: 8 }) : null;
  const material = new MeshBasicNodeMaterial();
  const batches = new MeadowGrassBatches({ scene: new Scene(),
    templates: { low: template, ...(denseTemplate ? { high: denseTemplate } : {}) }, material, name: 'uploads' });
  t.after(() => { batches.dispose(); template.dispose(); denseTemplate?.dispose(); material.dispose(); });
  const tile = count => ({ buildId: 1, renderX: 8, renderZ: -8,
    output: { count, position: new Float32Array(count * 4).fill(1),
      rotation: new Float32Array(count * 2).fill(2), data: new Float32Array(count * 4).fill(3) } });
  const commit = tiles => {
    batches.begin();
    for (const item of tiles) batches.add('low', item);
    batches.commit();
  };
  const band = batches.batches.get('low');
  const geometry = band.pages?.[0].geometry ?? band.geometry;
  const attributes = ['instancePosition', 'instanceRotation', 'instanceData', 'instanceTile']
    .map(name => geometry.getAttribute(name));
  const uploaded = attributes.map(attribute => attribute.array.slice());
  const flush = () => {
    for (let i = 0; i < attributes.length; i += 1) {
      const attribute = attributes[i];
      for (const range of attribute.updateRanges) {
        uploaded[i].set(attribute.array.subarray(range.start, range.start + range.count), range.start);
      }
      attribute.clearUpdateRanges();
    }
  };
  return { batches, tile, commit, geometry, attributes, uploaded, flush };
}

test('meadow uploads and draws only populated stems after a density change', t => {
  const f = fixture(t);
  const tile = f.tile(7);
  f.commit([tile]);
  assert.deepEqual(f.attributes.map(a => a.updateRanges), [
    [{ start: 0, count: 28 }], [{ start: 0, count: 14 }],
    [{ start: 0, count: 28 }], [{ start: 0, count: 28 }],
  ]);
  f.flush();
  tile.buildId += 1;
  tile.output = f.tile(3).output;
  f.commit([tile]);
  assert.deepEqual(f.attributes[0].updateRanges, [{ start: 0, count: 12 }]);
  assert.deepEqual(f.attributes.slice(1).map(a => a.updateRanges), [
    [{ start: 0, count: 6 }], [{ start: 0, count: 12 }], [{ start: 0, count: 12 }],
  ]);
  f.flush();
  assert.equal(f.geometry.instanceCount, 3);
  assert.deepEqual(f.uploaded[0].subarray(0, 12), tile.output.position);
});

test('removing a meadow tile repacks all companion attributes together', t => {
  const f = fixture(t);
  const a = f.tile(7), b = f.tile(5);
  b.renderX = -16;
  b.output.position.fill(5);
  b.output.rotation.fill(6);
  b.output.data.fill(7);
  f.commit([a, b]);
  f.flush();
  f.commit([b]);
  assert.equal(f.geometry.instanceCount, 5);
  assert.deepEqual(f.attributes[0].updateRanges, [{ start: 0, count: 20 }]);
  f.flush();
  assert.deepEqual(f.uploaded[1].subarray(0, 10), b.output.rotation);
  assert.deepEqual(f.uploaded[2].subarray(0, 20), b.output.data);
  const c = f.tile(4);
  c.renderX = 24;
  f.commit([b, c]);
  f.flush();
  assert.equal(f.geometry.instanceCount, 9);
  assert.deepEqual(f.uploaded[0].subarray(5 * 4, 9 * 4), c.output.position);
  assert.equal(f.uploaded[3][0], b.renderX);
  assert.equal(f.uploaded[3][5 * 4], 24);
});

test('a meadow rebase uploads tile origins without resending stem data', t => {
  const f = fixture(t);
  const tile = f.tile(7);
  f.commit([tile]);
  f.flush();
  const versions = f.attributes.slice(0, 3).map(a => a.version);
  tile.renderX -= 4096;
  tile.renderZ += 4096;
  f.commit([tile]);
  assert.deepEqual(f.attributes.slice(0, 3).map(a => a.version), versions);
  assert.deepEqual(f.attributes[3].updateRanges, [{ start: 0, count: 28 }]);
  f.flush();
  assert.equal(f.uploaded[3][0], tile.renderX);
  assert.equal(f.uploaded[3][1], tile.renderZ);
});

test('meadow retains pending upload ranges until a draw consumes them', t => {
  const f = fixture(t);
  const a = f.tile(7), b = f.tile(5);
  f.commit([a, b]);
  f.flush();
  a.buildId += 1;
  a.output.position.fill(4);
  f.commit([a, b]);
  b.buildId += 1;
  b.output.position.fill(5);
  f.commit([a, b]);
  f.flush();
  assert.deepEqual(f.uploaded[0].subarray(0, 28), a.output.position);
  assert.deepEqual(f.uploaded[0].subarray(7 * 4, 12 * 4), b.output.position);
});

test('meadow pages bound buffer capacity and reuse storage through tile churn', t => {
  const f = fixture(t);
  const tiles = Array.from({ length: 13 }, (_, i) => {
    const tile = f.tile(3 + i % 5);
    tile.renderX = i * 8;
    tile.renderZ = -24;
    tile.output.position.fill(i + 1);
    tile.output.rotation.fill(i + 2);
    tile.output.data.fill(i + 3);
    return tile;
  });
  f.commit(tiles);
  const band = f.batches.batches.get('low');
  const pages = band.meshes.map(mesh => mesh.geometry);
  assert.equal(pages.length, Math.ceil(tiles.length / meadowPageTileCapacity(16)));
  assert.ok(pages.every(geometry => geometry.getAttribute('instancePosition').count === meadowPageTileCapacity(16) * 16));
  assert.equal(band.pages.reduce((sum, page) => sum + page.members.length, 0), tiles.length);
  // Each publication keeps its origin and all three companion attributes in
  // the same slot, irrespective of which page owns it.
  for (const tile of tiles) {
    const page = band.slots.get(tile), slot = page.slots.get(tile);
    const offset = slot.ranges[0].start;
    for (const [name, field, width] of [['instancePosition', 'position', 4],
      ['instanceRotation', 'rotation', 2], ['instanceData', 'data', 4]]) {
      assert.deepEqual(page.geometry.getAttribute(name).array.subarray(offset * width,
        (offset + tile.output.count) * width), tile.output[field]);
    }
    assert.equal(page.geometry.getAttribute('instanceTile').array[offset * 4], tile.renderX);
  }
  for (let round = 0; round < 10; round += 1) {
    f.commit(tiles.slice(round % 5, round % 5 + 8));
    f.commit(tiles);
  }
  assert.deepEqual(band.meshes.map(mesh => mesh.geometry), pages, 'churn reuses pages without reallocating');
  f.commit([]);
  assert.ok(band.meshes.every(mesh => !mesh.visible && mesh.geometry.instanceCount === 0));
});

test('dense meadow pages keep allocation below one large tile plus the stem ceiling', t => {
  const template = createMeadowTemplate({ detail: 2, count: 40401, tileSize: 8 });
  const sparse = createMeadowTemplate({ detail: 2, count: 16, tileSize: 8 });
  const material = new MeshBasicNodeMaterial();
  const batches = new MeadowGrassBatches({ scene: new Scene(), templates: { high: template, low: sparse }, material, name: 'dense' });
  t.after(() => { batches.dispose(); template.dispose(); sparse.dispose(); material.dispose(); });
  const tiles = Array.from({ length: 3 }, (_, i) => ({ buildId: 1, renderX: i * 8, renderZ: 0,
    output: { count: 2, position: new Float32Array(8).fill(i),
      rotation: new Float32Array(4), data: new Float32Array(8) } }));
  batches.begin();
  for (const tile of tiles) batches.add('high', tile);
  assert.equal(batches.commit().high, 6);
  const band = batches.batches.get('high');
  assert.equal(batches.batches.get('low').pageTileCapacity, meadowPageTileCapacity(16), 'dense families retain the bounded repacking policy in every band');
  assert.equal(band.pages.length, 3);
  assert.ok(band.pages.every(page => page.slotCapacity === 1));
  assert.ok(band.meshes.every(mesh => mesh.geometry.getAttribute('instancePosition').count === 40401));
  batches.begin();
  batches.add('high', tiles[2]);
  batches.commit();
  assert.equal(band.slots.get(tiles[2]), band.pages[2], 'a retained tile does not move or rewrite its buffer');
});

test('sparse pages draw only surviving stems after retirement and slot reuse', t => {
  const f = fixture(t, { dense: false });
  const a = f.tile(7), b = f.tile(5);
  b.output.position.fill(5);
  b.output.rotation.fill(6);
  b.output.data.fill(7);
  f.commit([a, b]);
  f.flush();
  f.commit([b]);
  f.flush();
  assert.equal(f.geometry.instanceCount, 5, 'retired slots and unused tails never enter the draw');
  assert.deepEqual(f.uploaded[0].subarray(0, 20), b.output.position);
  const c = f.tile(4);
  f.commit([b, c]);
  f.flush();
  assert.equal(f.geometry.instanceCount, 9);
  assert.deepEqual(f.uploaded[2].subarray(5 * 4, 9 * 4), c.output.data);
});

test('sparse page density shrink and rebase retain exact populated data', t => {
  const f = fixture(t, { dense: false });
  const tile = f.tile(7);
  f.commit([tile]);
  f.flush();
  tile.buildId += 1;
  tile.output = f.tile(3).output;
  f.commit([tile]);
  f.flush();
  assert.equal(f.geometry.instanceCount, 3);
  assert.deepEqual(f.uploaded[0].subarray(0, 12), tile.output.position);
  const versions = f.attributes.slice(0, 3).map(a => a.version);
  tile.renderX -= 4096;
  f.commit([tile]);
  assert.deepEqual(f.attributes.slice(0, 3).map(a => a.version), versions);
  f.flush();
  assert.equal(f.uploaded[3][0], tile.renderX);
});

test('sparse growth adds bounded pages while retaining existing geometry and pending writes', t => {
  const f = fixture(t, { dense: false });
  const tiles = Array.from({ length: 33 }, () => f.tile(5));
  f.commit(tiles.slice(0, 2));
  f.flush();
  tiles[0].buildId += 1;
  tiles[0].output.position.fill(8);
  f.commit(tiles.slice(0, 2));
  tiles[1].buildId += 1;
  tiles[1].output.position.fill(9);
  f.commit(tiles.slice(0, 2));
  f.flush();
  assert.deepEqual(f.uploaded[0].subarray(0, 20), tiles[0].output.position);
  assert.deepEqual(f.uploaded[0].subarray(20, 40), tiles[1].output.position);
  let disposed = 0;
  f.geometry.addEventListener('dispose', () => { disposed += 1; });
  f.commit(tiles);
  const band = f.batches.batches.get('low');
  assert.equal(band.pages[0].geometry, f.geometry);
  assert.equal(disposed, 0);
  assert.equal(band.pages.length, Math.ceil(tiles.length / meadowPageTileCapacity(16)));
  assert.equal(band.meshes.reduce((sum, mesh) => sum + mesh.geometry.instanceCount, 0), 33 * 5);
  assert.ok(band.pages.every(page => page.geometry.getAttribute('instancePosition').count === meadowPageTileCapacity(16) * 16));
  for (const tile of tiles) {
    const page = band.slots.get(tile), start = page.slots.get(tile).ranges[0].start * 4;
    assert.deepEqual(page.geometry.getAttribute('instancePosition').array.subarray(start, start + 20), tile.output.position);
  }
});
