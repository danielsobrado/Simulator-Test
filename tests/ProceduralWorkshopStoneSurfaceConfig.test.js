import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STONE_SURFACE_PROFILES,
  defineStoneSurfaceProfileForTest,
  stoneSurfaceProfile,
} from '../src/editor/workshop/ProceduralWorkshopStoneSurfaceConfig.js';

test('soft-limestone surface profile has the calm response values', () => {
  const profile = stoneSurfaceProfile('soft-limestone');
  assert.equal(profile.unitShading.brightnessMin, 0.97);
  assert.equal(profile.unitShading.brightnessMax, 1.025);
  assert.equal(profile.unitShading.weatheringStrength, 0.075);
  assert.equal(profile.proceduralAlbedo.broadCellSize, 24);
  assert.equal(profile.proceduralAlbedo.broadVariation, 7);
  assert.equal(profile.proceduralAlbedo.grainVariation, 3);
  assert.equal(profile.proceduralAlbedo.dampDarkening, 8);
  assert.equal(profile.proceduralAlbedo.dampGreenLift, 2);
  assert.equal(profile.material.bumpTextureScale, 0.55);
  assert.equal(profile.material.bumpScale, 0.028);
  assert.equal(profile.material.roughnessBase, 238);
  assert.equal(profile.material.roughnessVariation, 10);
  assert.equal(profile.material.roughnessBroadScale, 14);
  assert.equal(profile.material.normalKind, 'stoneBlock');
  assert.equal(profile.material.workshopNormalScale, 0.28);
  assert.equal(profile.material.constructionNormalScale, 0.28);
  assert.equal(profile.material.workshopEnvMapIntensity, 0.58);
  assert.equal(profile.material.constructionEnvMapIntensity, 0.58);
  assert.equal(profile.material.mortarColor, '#74746d');
});

test('legacy palettes fall back to the historical defaults', () => {
  for (const key of ['granite', 'limestone', 'sandstone', 'unknown-key', '']) {
    const profile = stoneSurfaceProfile(key);
    assert.equal(profile.unitShading.brightnessMin, 0.94);
    assert.equal(profile.unitShading.brightnessMax, 1.04);
    assert.equal(profile.unitShading.weatheringStrength, 0.14);
    assert.equal(profile.proceduralAlbedo.broadVariation, 15);
    assert.equal(profile.material.bumpScale, 0.055);
    assert.equal(profile.material.roughnessBase, 226);
    assert.equal(profile.material.workshopNormalScale, 0.55);
    assert.equal(profile.material.workshopEnvMapIntensity, 0.72);
    assert.equal(profile.material.mortarColor, null);
  }
});

test('resolved profiles are deeply frozen and stable', () => {
  const first = stoneSurfaceProfile('soft-limestone');
  const second = stoneSurfaceProfile('soft-limestone');
  assert.equal(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.unitShading), true);
  assert.equal(Object.isFrozen(first.proceduralAlbedo), true);
  assert.equal(Object.isFrozen(first.material), true);
  assert.equal(Object.isFrozen(STONE_SURFACE_PROFILES), true);
});

test('invalid surface profiles are rejected', () => {
  assert.throws(
    () => defineStoneSurfaceProfileForTest({
      key: 'bad-brightness',
      unitShading: { brightnessMin: 1.1, brightnessMax: 0.9 },
    }),
    /brightness range is reversed/,
  );
  assert.throws(
    () => defineStoneSurfaceProfileForTest({
      key: 'bad-bump',
      material: { bumpScale: -0.1 },
    }),
    /bumpScale/,
  );
  assert.throws(
    () => defineStoneSurfaceProfileForTest({
      key: 'bad-roughness',
      material: { roughnessBase: 300 },
    }),
    /roughnessBase/,
  );
  assert.throws(
    () => defineStoneSurfaceProfileForTest({
      key: 'bad-cell',
      proceduralAlbedo: { broadCellSize: 12.5 },
    }),
    /broadCellSize/,
  );
  assert.throws(
    () => defineStoneSurfaceProfileForTest({
      key: 'bad-normal',
      material: { normalKind: 'obsidian' },
    }),
    /normalKind/,
  );
  assert.throws(
    () => defineStoneSurfaceProfileForTest({
      key: 'bad-env',
      material: { workshopEnvMapIntensity: -1 },
    }),
    /workshopEnvMapIntensity/,
  );
});
