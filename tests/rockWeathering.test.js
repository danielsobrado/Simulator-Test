import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import {
  DEFAULT_ROCK_WEATHERING,
  applyRockWeathering,
  resolveRockWeathering,
} from '../src/editor/stylized/rockWeathering.js';

function shippedRocks() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'))
    .stylizedSurface.rocks;
}

function rockMaterial({ map = null, roughnessMap = null, color = 0xffffff } = {}) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.color = new THREE.Color(color);
  material.roughness = 1;
  material.flatShading = true;
  if (map) material.map = map;
  if (roughnessMap) material.roughnessMap = roughnessMap;
  return material;
}

function surfaceTexture() {
  const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  texture.needsUpdate = true;
  return texture;
}

test('the shipped config resolves, and disabling it resolves to nothing', () => {
  const settings = resolveRockWeathering(shippedRocks().weathering);
  assert.equal(settings.enabled, true);
  assert.equal(settings.toning, 0.92);
  assert.equal(settings.waterlineHeight, 1.2);
  assert.equal(resolveRockWeathering({ enabled: false }), null);
  // Absent config means the defaults, not no weathering — a world that never
  // mentions it still gets stones that sit in the grass.
  assert.deepEqual(resolveRockWeathering(undefined), DEFAULT_ROCK_WEATHERING);
});

test('an out-of-range strength fails loudly rather than washing the rocks out', () => {
  // A strength of 2 is a stone that has been mossed into a green blob; the ranges
  // are the only thing keeping a typo out of a material.
  assert.throws(() => resolveRockWeathering({ moss: 2 }), /must be within \[0, 1\]/);
  assert.throws(() => resolveRockWeathering({ toning: -0.1 }), /must be within \[0, 1\]/);
  assert.throws(() => resolveRockWeathering({ undersideShade: 1.1 }), /must be within \[0, 1\]/);
  assert.throws(() => resolveRockWeathering({ waterlineHeight: 0 }), /must be positive/);
});

test('the waterline carries algae, and can be switched off on its own', () => {
  // The donor darkens the band; the green above it is what makes the waterline read
  // as a tide mark rather than as shadow. It is its own strength because a lake
  // stone wants the wet band without the sea's algae.
  const settings = resolveRockWeathering(shippedRocks().weathering);
  assert.ok(settings.algae > 0, 'the shipped config should grow algae');
  assert.equal(settings.algaeColor, '#4a5a2a');
  for (const algae of [0, 1, 2]) {
    if (algae > 1) {
      assert.throws(() => resolveRockWeathering({ algae }), /must be within \[0, 1\]/);
      continue;
    }
    const material = rockMaterial();
    applyRockWeathering(material, {
      settings: resolveRockWeathering({ ...shippedRocks().weathering, algae }),
      seaLevel: 40,
    });
    assert.ok(material.colorNode, `algae ${algae} should still assemble`);
    material.dispose();
  }
});

test('the weathering graph assembles against a bare material', () => {
  // Built in Node so a TSL mistake fails here rather than as white plastic rocks
  // in a browser.
  const material = rockMaterial();
  applyRockWeathering(material, {
    settings: resolveRockWeathering(shippedRocks().weathering),
    seaLevel: 40,
  });
  assert.ok(material.colorNode, 'the weathered albedo should replace the base colour');
  assert.ok(material.roughnessNode, 'the weather should bring its own roughness');
  material.dispose();
});

test('it assembles with a source map and roughness map, and without a sea', () => {
  const material = rockMaterial({ map: surfaceTexture(), roughnessMap: surfaceTexture() });
  applyRockWeathering(material, {
    settings: resolveRockWeathering(shippedRocks().weathering),
    seaLevel: null,
  });
  assert.ok(material.colorNode);
  // No sea level means no splash line, not a splash line at zero: a world with no
  // finite sea level would otherwise wet every stone below the origin.
  assert.ok(material.roughnessNode);
  material.dispose();
});

test('snow country assembles the deposition mask with a ground line', () => {
  const material = rockMaterial();
  applyRockWeathering(material, {
    settings: resolveRockWeathering(shippedRocks().weathering),
    biomeLook: true,
    ground: { groundY: 0.1, height: 1.2, centre: [0, 0.5, 0] },
  });
  assert.ok(material.colorNode);
  material.dispose();
});

test('switching it off leaves the clone untouched', () => {
  const material = rockMaterial();
  const before = { color: material.colorNode, roughness: material.roughnessNode };
  applyRockWeathering(material, { settings: resolveRockWeathering({ enabled: false }) });
  assert.equal(material.colorNode, before.color);
  assert.equal(material.roughnessNode, before.roughness);
  material.dispose();
});
