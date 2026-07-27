import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import {
  GRASS_COLOR_SETTINGS,
  GRASS_SCALAR_SETTINGS,
  GrassTuning,
} from '../src/editor/stylized/GrassTuning.js';

function shippedSurface() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'))
    .stylizedSurface;
}

test('every tunable resolves from the shipped config, not from its fallback', () => {
  // A setting whose config path is wrong silently falls back to its default, and the
  // slider then edits a value the YAML never mentions. That is invisible at runtime
  // — the field just does not respond the way the config says it should.
  const surface = shippedSurface();
  const tuning = new GrassTuning(surface);
  for (const { key, path, fallback } of GRASS_SCALAR_SETTINGS) {
    if (!path) continue;
    const configured = path.reduce((node, step) => node?.[step], surface);
    assert.equal(typeof configured, 'number', `${key} is missing from editor.config.yaml`);
    assert.equal(tuning.getSettings()[key], configured, `${key} did not read its config value`);
    void fallback;
  }
  for (const { key, path } of GRASS_COLOR_SETTINGS) {
    const configured = path.reduce((node, step) => node?.[step], surface);
    assert.equal(typeof configured, 'string', `${key} is missing from editor.config.yaml`);
    assert.equal(tuning.getSettings()[key], configured, `${key} did not read its config value`);
  }
});

test('setting a value writes the uniform the material reads', () => {
  const tuning = new GrassTuning(shippedSurface());
  tuning.setSettings({ windStrength: 0.42 });
  assert.equal(tuning.uniforms.windStrength.value, 0.42);
  assert.equal(tuning.getSettings().windStrength, 0.42);
});

test('colour settings keep their hex but drive a linear uniform', () => {
  const tuning = new GrassTuning(shippedSurface());
  tuning.setSettings({ colorTop: '#ffffff' });
  // The hex round-trips for the YAML export...
  assert.equal(tuning.getSettings().colorTop, '#ffffff');
  // ...while the uniform carries the converted colour the shader wants.
  assert.equal(tuning.uniforms.colorTop.value.r, 1);
});

test('junk input cannot corrupt a uniform', () => {
  const tuning = new GrassTuning(shippedSurface());
  const before = tuning.getSettings();
  tuning.setSettings({ windStrength: 'not a number', unknownSetting: 1, colorTop: 42 });
  assert.deepEqual(tuning.getSettings(), before);
});

test('reset restores the values the config booted with', () => {
  const tuning = new GrassTuning(shippedSurface());
  const original = tuning.getSettings().brightness;
  tuning.setSettings({ brightness: 1.9 });
  tuning.reset();
  assert.equal(tuning.getSettings().brightness, original);
  assert.equal(tuning.uniforms.brightness.value, original);
});

test('the YAML export parses back into the shape it came from', () => {
  // The export exists so a tuning session becomes a config change instead of being
  // lost on reload; a fragment that does not parse defeats the point.
  const tuning = new GrassTuning(shippedSurface());
  tuning.setSettings({ brightness: 0.66, colorTop: '#123456' });
  const parsed = yaml.load(tuning.toYaml());
  assert.equal(parsed.stylizedSurface.color.brightness, 0.66);
  assert.equal(parsed.stylizedSurface.color.top, '#123456');
  assert.equal(parsed.stylizedSurface.wind.flutter.fadeEnd, shippedSurface().wind.flutter.fadeEnd);
});

test('width scale is exported as a note, because it has no config home', () => {
  // It is the live stand-in for the baked minWidth/maxWidth range, so writing it
  // into the YAML as a key would produce a setting nothing reads.
  const tuning = new GrassTuning(shippedSurface());
  assert.doesNotMatch(tuning.toYaml(), /widthScale/);
  tuning.setSettings({ widthScale: 1.5 });
  assert.match(tuning.toYaml(), /# widthScale 1\.500/);
  assert.equal(yaml.load(tuning.toYaml()).stylizedSurface.grass.minWidth, undefined);
});
