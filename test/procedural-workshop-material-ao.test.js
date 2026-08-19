import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const configSource = fs.readFileSync(
  new URL('../src/editor/workshop/ProceduralWorkshopMaterialConfig.js', import.meta.url),
  'utf8',
);
const controllerSource = fs.readFileSync(
  new URL('../src/editor/workshop/ProceduralWorkshopMaterialController.js', import.meta.url),
  'utf8',
);
const partsSource = fs.readFileSync(
  new URL('../src/editor/workshop/ProceduralWorkshopComponentParts.js', import.meta.url),
  'utf8',
);

test('workshop full-PBR presets expose ambient occlusion strength', () => {
  assert.match(configSource, /aoStrength:/);
  assert.match(configSource, /Material ambient occlusion strength/);
  assert.match(controllerSource, /data-material-field="aoStrength"/);
  assert.match(controllerSource, /result\.aoMapIntensity\s*=\s*preset\.aoStrength/);
});

test('workshop packed ORM drives AO, roughness and metalness', () => {
  assert.match(partsSource, /result\.aoMap\s*=\s*orm/);
  assert.match(partsSource, /result\.aoMapIntensity\s*=\s*preset\.aoStrength/);
  assert.match(partsSource, /result\.roughnessMap\s*=\s*orm/);
  assert.match(partsSource, /result\.metalnessMap\s*=\s*orm/);
});
