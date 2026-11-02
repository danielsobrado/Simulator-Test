import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import {
  DEFAULT_BARK_WEATHERING,
  applyBarkWeathering,
  resolveBarkWeathering,
} from '../src/editor/stylized/barkWeathering.js';
import { createAuthoredTrunkMaterial } from '../src/editor/stylized/StylizedTreeMaterials.js';

function shippedSurface() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'))
    .stylizedSurface;
}

function shippedSnowBand() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'))
    .world.farTerrain;
}

test('the shipped config resolves, and takes the terrain snow band it is handed', () => {
  const surface = shippedSurface();
  const band = shippedSnowBand();
  const settings = resolveBarkWeathering(surface, { snow: band });
  assert.equal(settings.enabled, true);
  assert.equal(settings.moss, 1);
  // Snow on a trunk has to start where snow on the ground does. The band lives in
  // the world's configuration, so it is handed down rather than restated here —
  // there is exactly one snow line in the project.
  assert.ok(settings.snowBand, 'bark should take the band it is given');
  assert.equal(settings.snowBand.line, band.snowLine);
  assert.equal(settings.snowBand.fade, band.snowFade);
  assert.equal(settings.snowBand.color, band.snowColor);
});

test('with no band handed down, the snow term is off rather than guessed', () => {
  // The surface config has no snow line of its own, and a defaulted one would put
  // white trunks on a green hillside.
  const settings = resolveBarkWeathering(shippedSurface());
  assert.equal(settings.snowBand, null);
  assert.equal(settings.moss, 1, 'the rest of the weathering still applies');
});

test('a config may override the snow band, and cannot invent one', () => {
  const overridden = resolveBarkWeathering({
    trees: { weathering: { snowLine: 1200, snowFade: 300, snowColor: '#ffffff' } },
  });
  assert.deepEqual(overridden.snowBand, { line: 1200, fade: 300, color: '#ffffff' });
  // No band anywhere means no snow term, rather than snow starting at zero and
  // whitening every trunk in the world.
  const bare = resolveBarkWeathering({ trees: { weathering: {} } });
  assert.equal(bare.snowBand, null);
  const zeros = resolveBarkWeathering({ farTerrain: { snowLine: 0, snowFade: 0 } });
  assert.equal(zeros.snowBand, null);
});

test('out-of-range strengths fail loudly', () => {
  assert.throws(() => resolveBarkWeathering({ trees: { weathering: { moss: 1.5 } } }), /must be within \[0, 1\]/);
  assert.throws(() => resolveBarkWeathering({ trees: { weathering: { baseHeight: 0 } } }), /must be positive/);
  assert.equal(resolveBarkWeathering({ trees: { weathering: { enabled: false } } }), null);
  // Absent config still weathers: a world that never mentions bark keeps mossy
  // trunks rather than plastic ones.
  assert.equal(resolveBarkWeathering({}).moss, DEFAULT_BARK_WEATHERING.moss);
});

test('the weathering graph assembles on a trunk material', () => {
  // Assembled in Node so a TSL mistake fails here rather than as a trunk that
  // renders black or not at all.
  const material = createAuthoredTrunkMaterial({
    source: { color: '#6b4a30' },
    barkWeathering: resolveBarkWeathering(shippedSurface()),
  });
  assert.ok(material.colorNode, 'the weathered bark should replace the base colour');
  material.dispose();
});

test('a trunk with no snow band still assembles, and one with a map too', () => {
  const map = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  map.needsUpdate = true;
  const material = createAuthoredTrunkMaterial({
    source: { color: '#6b4a30' },
    sourceMap: map,
    barkWeathering: resolveBarkWeathering({ trees: { weathering: {} } }),
  });
  assert.ok(material.colorNode);
  material.dispose();
});

test('switching it off leaves the trunk material as authored', () => {
  const material = createAuthoredTrunkMaterial({
    source: { color: '#6b4a30' },
    barkWeathering: resolveBarkWeathering({ trees: { weathering: { enabled: false } } }),
  });
  // The un-weathered branch builds its colour straight from the source colour.
  assert.ok(material.colorNode);
  material.dispose();

  const bare = new THREE.MeshStandardNodeMaterial();
  const before = bare.colorNode;
  applyBarkWeathering(bare, { settings: null });
  assert.equal(bare.colorNode, before);
  bare.dispose();
});
