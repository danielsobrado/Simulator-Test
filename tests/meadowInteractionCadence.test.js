import assert from 'node:assert/strict';
import test from 'node:test';
import { GRASS_MARK, MeadowInteractionMap } from '../src/editor/stylized/meadow/MeadowInteractionMap.js';

test('meadow interaction texture uploads follow the configured cadence', () => {
  const interaction = new MeadowInteractionMap({
    resolution: 32,
    worldSize: 8,
    bodyRadius: 0.5,
    uploadIntervalFrames: 2,
    getHeight: () => 0,
  });
  try {
    const initialVersion = interaction.texture.version;
    const body = { x: 0, y: 0, z: 0 };
    interaction.update(body);
    assert.equal(interaction.texture.version, initialVersion);
    interaction.update(body);
    assert.equal(interaction.texture.version, initialVersion + 1);
  } finally {
    interaction.dispose();
  }
});

test('elapsed recovery still publishes the final empty map between upload intervals',()=>{
 const map=new MeadowInteractionMap({resolution:32,worldSize:8,uploadIntervalFrames:2});
 try {
  map.pressDisc(0,0,2,.002);const version=map.texture.version;
  map.update(null,{dtSeconds:.1});
  assert.equal(map.peak,0);assert.equal(map.texture.version,version+1);assert.ok(map.press.every(v=>v===0));
  map.update(null,{dtSeconds:.1});assert.equal(map.texture.version,version+1);
 }finally{map.dispose();}
});

test('stationary slow-fading marks upload only on a pixel change at the existing cadence', () => {
  const map = new MeadowInteractionMap({ resolution: 32, worldSize: 8, uploadIntervalFrames: 2 });
  try {
    map.markDisc(0, 0, 2, GRASS_MARK.SCORCH);
    map.update(null);
    map.update(null);
    const version = map.texture.version;
    const pixels = map.pixels.slice();
    for (let frame = 3; frame <= 10; frame++) map.update(null);
    assert.deepEqual(map.pixels, pixels);
    assert.equal(map.texture.version, version, 'unchanged mark bytes need no uploads');
    map.update(null);
    assert.notDeepEqual(map.pixels, pixels, 'the original tenth-step fade still runs');
    assert.equal(map.texture.version, version, 'the fade waits for the configured upload frame');
    map.update(null);
    assert.equal(map.texture.version, version + 1);
  } finally {
    map.dispose();
  }
});

test('a body above the grass does not upload an empty interaction map', () => {
  const map = new MeadowInteractionMap({ resolution: 32, worldSize: 8, getHeight: () => 0 });
  try {
    const version = map.texture.version;
    for (let frame = 0; frame < 12; frame++) map.update({ x: 0, y: 100, z: 0 });
    assert.equal(map.hasMarksOrPress(), false);
    assert.equal(map.texture.version, version);
    map.clearPress();
    assert.equal(map.texture.version, version, 'clearing an empty press is also a no-op');
  } finally {
    map.dispose();
  }
});

test('rebasing retains mark pixels and scrolling out of the window immediately uploads the clear', () => {
  const map = new MeadowInteractionMap({ resolution: 32, worldSize: 8, uploadIntervalFrames: 2 });
  try {
    const body = { x: 0, y: 0, z: 0 };
    map.markDisc(0, 0, 2, GRASS_MARK.SCORCH);
    map.update(body, { stamp: false });
    map.update(body, { stamp: false });
    const pixels = map.pixels.slice();
    const version = map.texture.version;
    map.shiftOrigin(128, -64);
    body.x -= 128;
    body.z += 64;
    map.update(body, { stamp: false });
    assert.deepEqual(map.pixels, pixels);
    assert.equal(map.texture.version, version);
    body.x += 20;
    map.update(body, { stamp: false });
    assert.equal(map.texture.version, version + 1);
    assert.equal(map.hasMarksOrPress(), false);
    assert.ok(map.pixels.every((value, index) => value === (index % 4 === 3 ? 255 : 0)));
  } finally {
    map.dispose();
  }
});
