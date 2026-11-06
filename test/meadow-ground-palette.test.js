import assert from 'node:assert/strict';
import test from 'node:test';
import { Color } from 'three/webgpu';
import { createMeadowGroundPalette } from '../src/editor/stylized/meadow/meadowGroundPalette.js';
import { resolveMeadowGrassConfig } from '../src/editor/stylized/meadow/meadowGrassConfig.js';
import { resolveMeadowPalettes } from '../src/editor/stylized/meadow/meadowPalettes.js';
import { createTerrainMaterialFarStyle, encodeTerrainMaterialFarColor } from '../src/editor/materials/TerrainMaterialBakeFarColor.js';

const config = {
  grass: { system: 'meadow', meadow: {
    palette: { base: '#50852b', tip: '#a6bf65', brightness: 1.2,
      byTileId: { 3: { base: '#6a7a2c', tip: '#c9bd6a' }, 254: { base: '#34563a', tip: '#8fa77a' } } },
    appearance: { groundTipMix: 0.08 },
  } },
};

test('without substrate detail terrain roots match blade pigment in linear light for standard and custom biome IDs', () => {
  const plain = structuredClone(config);
  plain.grass.meadow.groundDetail = { enabled: false };
  const palette = createMeadowGroundPalette(plain);
  for (const id of [0, 3, 4, 12, 32, 254]) {
    const colors = config.grass.meadow.palette.byTileId[id] ?? config.grass.meadow.palette;
    const expected = new Color(colors.base).lerp(new Color(colors.tip), 0.08).multiplyScalar(1.2);
    const actual = palette.roots.subarray(id * 3, id * 3 + 3);
    expected.toArray().forEach((channel, index) => assert.ok(Math.abs(channel - actual[index]) < 1e-7));
  }
  assert.notDeepEqual(palette.roots.subarray(9, 12), palette.roots.subarray(12, 15));
  assert.equal(palette.roots.byteLength + palette.tips.byteLength, 6144);
});

test('non-meadow and shared-tuning configurations retain their terrain style', () => {
  assert.equal(createMeadowGroundPalette({}), null);
  assert.equal(createMeadowGroundPalette({ grass: { ...config.grass, system: 'clump' } }), null);
  assert.equal(createMeadowGroundPalette({ grass: { system: 'meadow', meadow: {} } }), null);
  assert.equal(createMeadowGroundPalette({ grass: { system: 'meadow', meadow: { ...config.grass.meadow, enabled: false } } }), null);
});

test('far color uses source biome alpha and preserves rock, snow and dirt weights', () => {
  const palette = createMeadowGroundPalette(config);
  const style = createTerrainMaterialFarStyle({
    grassBottomColor: '#ffffff', grassBrightness: 4, meadowGroundColors: palette.roots,
    dirtColor: '#806040', forestColor: '#273c25',
  }, {
    rockColor: '#808080', snowColor: '#ffffff', shorelineColor: '#806040',
    grassTintStrength: 0, wetDarkening: 0, shorelineStrength: 0, canopyStrength: 0,
  });
  const encode = (id, weights) => {
    const result = new Uint8Array(4);
    encodeTerrainMaterialFarColor(result, 0, new Uint8Array([255, 0, 255, id]), 0, style,
      ...weights, 1, 1, 1, 0, 0, 0, 1);
    return result;
  };
  for (const id of [3, 4, 254]) {
    const expected = new Color().fromArray(palette.roots, id * 3).getHexString();
    assert.deepEqual([...encode(id, [1, 0, 0, 0]).slice(0, 3)],
      [0, 2, 4].map(offset => Number.parseInt(expected.slice(offset, offset + 2), 16)));
  }
  assert.deepEqual(encode(3, [0, 0, 1, 0]), encode(4, [0, 0, 1, 0]));
  assert.deepEqual(encode(3, [0, 1, 0, 0]), new Uint8Array([128, 96, 64, 255]));
  assert.deepEqual(encode(3, [0, 0, 0, 1]), new Uint8Array([255, 255, 255, 255]));
});

test('dry-patch settings reject invalid colors, reversed thresholds and unbounded strength', () => {
  for (const appearance of [{ dryColor: 'green' }, { dryStart: 0.9 }, { dryStrength: 1.1 }, { dryPatchScale: -1 }]) {
    assert.throws(() => resolveMeadowGrassConfig({ appearance }), /Invalid editor configuration/);
  }
  assert.equal(resolveMeadowGrassConfig({ appearance: { dryStrength: 0 } }).appearance.dryStrength, 0);
});

test('shipped woodland and tundra pigments remain distinct within the eight-palette limit',async()=>{
 const {readFileSync}=await import('node:fs');const {load}=await import('js-yaml');
 const surface=load(readFileSync(new URL('../editor.config.yaml',import.meta.url),'utf8')).stylizedSurface;
 const settings=resolveMeadowGrassConfig(surface.grass.meadow),colors=createMeadowGroundPalette(surface);
 const index=id=>Math.floor(settings.shapeTable[id]/3)%8;
 assert.equal(index(5),index(6));
 assert.notEqual(index(5),index(4));
 assert.notEqual(index(7),index(5));
 assert.notEqual(index(8),index(7));
 assert.deepEqual(settings.palette.palettes[index(10)],{base:'#666746',tip:'#a3a07a',lush:1});
 assert.equal(settings.palette.palettes.length,8);
 assert.notDeepEqual(colors.roots.subarray(10*3,11*3),colors.roots.subarray(9*3,10*3));
});

test('canopy colour sits between blade root and tip, and its strength follows stand density', () => {
  const plain = structuredClone(config);
  plain.grass.meadow.groundDetail = { enabled: false };
  plain.grass.meadow.appearance = { groundTipMix: 0.08, canopyTipMix: 0.4, canopyStrength: 0.8 };
  const palette = createMeadowGroundPalette(plain);
  const growth = resolveMeadowGrassConfig(plain.grass.meadow).growth;
  for (const id of [3, 4, 9, 254]) {
    const colors = config.grass.meadow.palette.byTileId[id] ?? config.grass.meadow.palette;
    const root = new Color(colors.base).lerp(new Color(colors.tip), 0.08).multiplyScalar(1.2);
    const tip = new Color(colors.tip).multiplyScalar(1.2);
    const expected = root.clone().lerp(tip, 0.4).toArray();
    const canopy = palette.canopies.subarray(id * 4, id * 4 + 4);
    expected.forEach((channel, index) => assert.ok(Math.abs(channel - canopy[index]) < 1e-6));
    const density = growth.profiles[growth.table[id]].density;
    assert.ok(Math.abs(canopy[3] - 0.8 * density) < 1e-6);
    // The far bake is the ground at a grazing view: root leaning to canopy by that strength.
    for (let channel = 0; channel < 3; channel++) {
      const root = palette.roots[id * 3 + channel];
      assert.ok(Math.abs(palette.far[id * 3 + channel] - (root + (canopy[channel] - root) * canopy[3])) < 1e-6);
    }
  }
});

test('zero canopy strength keeps the far bake on the substrate root', () => {
  const off = structuredClone(config);
  off.grass.meadow.appearance = { groundTipMix: 0.08, canopyStrength: 0 };
  const palette = createMeadowGroundPalette(off);
  assert.deepEqual([...palette.far], [...palette.roots]);
});

test('a palette lush share is validated, defaults to 1 and keeps otherwise equal palettes apart',()=>{
 const p=resolveMeadowPalettes({base:'#000000',tip:'#ffffff',byTileId:{3:{base:'#111111',tip:'#222222',lush:0},4:{base:'#111111',tip:'#222222'}}},'p');
 assert.equal(p.palettes[p.table[3]].lush,0);assert.equal(p.palettes[p.table[4]].lush,1);assert.notEqual(p.table[3],p.table[4]);
 assert.throws(()=>resolveMeadowPalettes({base:'#000000',tip:'#ffffff',byTileId:{3:{base:'#111111',tip:'#222222',lush:2}}},'p'),/lush/);
});
