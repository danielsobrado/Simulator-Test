import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three';
import { resolveBiomeLooks, biomeSnowCover, biomeRockLook, NEUTRAL_ROCK_LOOK } from '../src/editor/biomes/BiomeLooks.js';
import { applyBiomeLooks, frostMeadowPalette, settleMeadowGrowth } from '../src/editor/biomes/applyBiomeLooks.js';
import { createTerrainMaterialBakeConfig } from '../src/editor/materials/TerrainMaterialBakeConfig.js';
import { resolveMeadowPalettes } from '../src/editor/stylized/meadow/meadowPalettes.js';
import { biomeCanopySnowAt, createCanopySnowResolver } from '../src/editor/stylized/forest/canopySnow.js';
import { packImpostorWidth, unpackImpostorWidth } from '../src/editor/stylized/forest/TreeAppearance.js';
import { snowCountryWeight } from '../src/editor/stylized/sky/SnowCountryWeight.js';
import { loadBiomeLooks } from '../tests/helpers/biomeLooks.js';

const loadYaml = (path) => yaml.load(readFileSync(new URL(path, import.meta.url), 'utf8'));
const LOOKS = loadBiomeLooks();
const TUNDRA = 10;
const TAIGA = 9;
const GLACIER = 11;
const COLD_DESERT = 2;

test('the shipped table dresses every cold biome', () => {
  for (const tile of [COLD_DESERT, TAIGA, TUNDRA, GLACIER]) {
    assert.ok(LOOKS.snow.air[tile] > 0, `tile ${tile} has snow-country air`);
    assert.ok(LOOKS.snow.fall[tile] > 0, `tile ${tile} snows`);
    assert.ok(LOOKS.snow.ground[tile] > 0, `tile ${tile} carries ground snow`);
  }
  assert.equal(LOOKS.snow.ground[GLACIER], 1);
  assert.ok(LOOKS.snow.canopy[TUNDRA] > LOOKS.snow.canopy[TAIGA], 'tundra crowns carry more snow than taiga');
  for (const tile of [3, 4, 5, 6, 7, 8, 12]) {
    assert.equal(LOOKS.snow.air[tile], 0, `tile ${tile} is not snow country`);
    assert.match(LOOKS.canopy[tile], /^#[0-9a-f]{6}$/i);
  }
});

test('tile ids are Azgaar standard ids or the custom range', () => {
  const base = { snow: { color: '#ffffff', frost: '#eeeeee' } };
  assert.doesNotThrow(() => resolveBiomeLooks({ ...base, byTileId: { 12: {}, 32: { snow: { fall: 1 } }, 254: {} } }));
  for (const id of ['13', '31', '255', '-1', 'x']) {
    assert.throws(() => resolveBiomeLooks({ ...base, byTileId: { [id]: {} } }), /tile id/);
  }
  assert.throws(() => resolveBiomeLooks({ ...base, byTileId: { 9: { snow: { canopy: 2 } } } }), /\[0, 1\]/);
  assert.throws(() => resolveBiomeLooks({ ...base, byTileId: { 9: { snow: { hail: 1 } } } }), /not one of/);
  assert.throws(() => resolveBiomeLooks({ ...base, byTileId: { 9: { canopy: 'green' } } }), /colour/);
  assert.throws(() => resolveBiomeLooks({ byTileId: {} }), /snow.color/);
});

test('the terrain bake and the far terrain take ground snow from one column', () => {
  const editor = loadYaml('../editor.config.yaml');
  const bakeSource = loadYaml('../config/terrain-material-bake.yaml');
  assert.equal(bakeSource.classification.snowBiomeCover, undefined, 'no second copy in the bake yaml');
  assert.equal(editor.world.farTerrain.snowBiomeCover, undefined, 'no second copy in the far terrain');
  applyBiomeLooks(editor, bakeSource, LOOKS);
  const bake = createTerrainMaterialBakeConfig(bakeSource);
  assert.deepEqual({ ...bake.classification.snowBiomeCover }, biomeSnowCover(LOOKS, 'ground'));
  assert.deepEqual(editor.world.farTerrain.snowBiomeCover, biomeSnowCover(LOOKS, 'ground'));
  assert.equal(editor.stylizedSurface.biomeLooks, LOOKS);
});

test('grass frost leans a biome palette toward frost without adding palettes', () => {
  const editor = loadYaml('../editor.config.yaml');
  const palette = editor.stylizedSurface.grass.meadow.palette;
  const frosted = frostMeadowPalette(palette, LOOKS);
  assert.equal(frosted.base, palette.base, 'the default palette is untouched');
  assert.equal(frosted.tip, palette.tip);
  const frost = new THREE.Color(LOOKS.frostColor);
  const distance = (hex) => {
    const color = new THREE.Color(hex);
    return Math.hypot(color.r - frost.r, color.g - frost.g, color.b - frost.b);
  };
  for (const tile of [TAIGA, TUNDRA]) {
    assert.ok(distance(frosted.byTileId[tile].tip) < distance(palette.byTileId[tile].tip), `tile ${tile} tips frost`);
  }
  assert.deepEqual(frosted.byTileId[6], palette.byTileId[6], 'warm biomes keep their pigment');
  const before = resolveMeadowPalettes(palette, 'palette').palettes.length;
  assert.equal(resolveMeadowPalettes(frosted, 'palette').palettes.length, before);
});

test('snow settles a frosted stand and leaves warm biomes standing', () => {
  const growth = loadYaml('../editor.config.yaml').stylizedSurface.grass.meadow.growth;
  const settled = settleMeadowGrowth(growth, LOOKS);
  for (const tile of [TAIGA, TUNDRA]) {
    assert.ok(settled.byTileId[tile].tallHeight < growth.byTileId[tile].tallHeight, `tile ${tile} is shorter`);
    assert.equal(settled.byTileId[tile].density, growth.byTileId[tile].density, 'population is unchanged');
  }
  assert.deepEqual(settled.byTileId[6], growth.byTileId[6]);
});

test('a tree carries its biome canopy snow, or the snow band at its height', () => {
  const resolve = createCanopySnowResolver({ snowLine: 700, snowFade: 250 });
  const biome = (tile) => LOOKS.snow.canopy[tile];
  assert.equal(resolve(biome(6), 100, 0.5), 0, 'a lowland deciduous tree is bare');
  assert.ok(resolve(biome(TUNDRA), 100, 0.5) > 0.8, 'tundra crowns are capped');
  assert.ok(resolve(biome(TAIGA), 100, 0.5) > 0.5);
  assert.equal(resolve(biome(6), 1000, 0.5), 1, 'above the snow band every crown is white');
  assert.ok(resolve(biome(TAIGA), 100, 0) < resolve(biome(TAIGA), 100, 1), 'trees in a stand differ');
  assert.equal(resolve(Number.NaN, Number.NaN, Number.NaN), 0);
});

test('canopy snow ramps across a biome border like the ground snow', () => {
  // Taiga west of cell 0, deciduous forest east of it.
  const tileAt = (cellX) => (cellX < 0 ? TAIGA : 6);
  const at = (cellX) => biomeCanopySnowAt(LOOKS.snow.canopy, tileAt, cellX, 0);
  assert.equal(at(-20), LOOKS.snow.canopy[TAIGA]);
  assert.equal(at(20), 0);
  assert.ok(at(-1) > at(0) && at(0) > at(2) && at(2) > 0, 'a ramp, not a step');
  assert.equal(biomeCanopySnowAt(null, tileAt, 0, 0), 0);
});

test('impostor width and canopy snow share one channel', () => {
  for (const width of [0.4, 1, 1.37, 3.2]) {
    for (const snow of [0, 0.25, 0.731, 1]) {
      const unpacked = unpackImpostorWidth(Math.fround(packImpostorWidth(width, snow)));
      assert.ok(Math.abs(unpacked.width - width) < 1e-3, `width ${width} / ${snow}`);
      assert.ok(Math.abs(unpacked.snow - snow) <= 0.5 / 255 + 1e-6, `snow ${snow}`);
    }
  }
  assert.equal(packImpostorWidth(1.2, 0), 1.2, 'snowless crowns keep their plain width');
});

test('snow-country air and snowfall read their own columns', () => {
  const band = { groundHeight: 100, snowLine: 700, snowFade: 250 };
  const air = snowCountryWeight({ tiles: [TAIGA, TAIGA], ...band, byTile: LOOKS.snow.air });
  const fall = snowCountryWeight({ tiles: [TAIGA, TAIGA], ...band, byTile: LOOKS.snow.fall });
  assert.equal(air, LOOKS.snow.air[TAIGA]);
  assert.equal(fall, LOOKS.snow.fall[TAIGA]);
  assert.equal(snowCountryWeight({ tiles: [6], ...band, byTile: LOOKS.snow.fall }), 0);
});

test('the biomeSnow A/B control draws the biomes without biome snow', () => {
  const source = loadYaml('../config/biome-looks.yaml').biomeLooks;
  const bare = resolveBiomeLooks(source, { snow: false });
  for (const column of Object.values(bare.snow)) assert.ok(column.every((value) => value === 0));
  assert.deepEqual(bare.canopy, LOOKS.canopy, 'canopy hue is not snow');
});

test('a tree hands its canopy snow to both its crown and its trunk', async () => {
  const WebGpu = await import('three/webgpu');
  const { createInstancedRenderers, writeInstances } = await import('../src/editor/stylized/lod/StylizedLodRuntime.js');
  const part = (kind) => {
    const geometry = new WebGpu.BufferGeometry();
    geometry.setAttribute('position', new WebGpu.BufferAttribute(new Float32Array([0, 0, 0, 1, 2, 0, 0, 3, 1]), 3));
    geometry.setAttribute('normal', new WebGpu.BufferAttribute(new Float32Array(9), 3));
    return { kind, geometry, material: new WebGpu.MeshLambertNodeMaterial() };
  };
  const [[leaf, trunk]] = createInstancedRenderers({
    root: new WebGpu.Group(), partsByPrototype: [[part('leaf'), part('trunk')]],
    capacity: 2, name: 'snow', castShadow: false, tintLeaves: true,
  });
  writeInstances([[leaf, trunk]], [[{
    matrix: new WebGpu.Matrix4(), fade: 1, seed: 0.3, leafTint: [0.9, 1, 1.1], leafSnow: 0.75, morphology: [1.2, 1.1, 0.9],
  }]]);
  assert.deepEqual([...leaf.geometry.getAttribute('instanceLeafTint').array.slice(0, 4)].map((v) => +v.toFixed(3)), [0.9, 1, 1.1, 0.75]);
  assert.deepEqual([...leaf.geometry.getAttribute('instanceMorphology').array.slice(0, 3)].map((v) => +v.toFixed(3)), [1.2, 1.1, 0.9],
    'the crown keeps its scale');
  assert.deepEqual([...trunk.geometry.getAttribute('instanceMorphology').array.slice(0, 3)].map((v) => +v.toFixed(3)), [0.75, 1.1, 0.9],
    'the trunk reads only z, so x carries the snow');
});

test('taiga stays below the regional snowfall threshold', () => {
  // Snowfall over taiga cost ~20 % of the frame (docs/biome-looks.md); it snows
  // only where tundra or glacier, or the snow line, lift the weight.
  const { snowfall } = loadYaml('../config/weather-effects.yaml');
  assert.ok(LOOKS.snow.fall[TAIGA] < snowfall.regionalMinCoverage,
    `taiga fall ${LOOKS.snow.fall[TAIGA]} must stay below ${snowfall.regionalMinCoverage}`);
  assert.ok(LOOKS.snow.fall[TUNDRA] > snowfall.regionalMinCoverage, 'tundra still snows');
});

test('rock looks pack tint and tone into an albedo multiplier beside the moss scale', () => {
  const base = { snow: { color: '#ffffff', frost: '#eeeeee' } };
  const looks = resolveBiomeLooks({ ...base, byTileId: { 2: { rock: { tint: '#ff8000', tone: 2, moss: 0 } }, 32: { rock: { moss: 1.5 } } } });
  assert.deepEqual([...biomeRockLook(looks, 2)].map((v) => Math.round(v * 100) / 100), [2, 1, 0, 0]);
  assert.deepEqual([...biomeRockLook(looks, 32)], [1, 1, 1, 1.5]);
  assert.deepEqual([...biomeRockLook(looks, 4)], [...NEUTRAL_ROCK_LOOK], 'unlisted biomes keep the authored stone');
  assert.equal(biomeRockLook(null, 2), NEUTRAL_ROCK_LOOK);
  assert.equal(biomeRockLook(looks, undefined), NEUTRAL_ROCK_LOOK);
  for (const rock of [{ tone: 3 }, { moss: -1 }, { tint: 'red' }, { lichen: 1 }, 1]) {
    assert.throws(() => resolveBiomeLooks({ ...base, byTileId: { 2: { rock } } }), /rock/);
  }
  assert.equal(biomeRockLook(LOOKS, COLD_DESERT)[3], 0, 'the shipped cold desert grows no moss on its stones');
});
