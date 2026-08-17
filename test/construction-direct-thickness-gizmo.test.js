import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import { CONSTRUCTION_DIRECT_GIZMO_CONFIG } from '../src/editor/construction/config/ConstructionDirectGizmoConfig.generated.js';

const source = yaml.load(readFileSync(
  new URL('../src/editor/construction/config/direct-gizmo.yml', import.meta.url),
  'utf8',
));

test('direct construction gizmo exposes a bounded wall thickness handle', () => {
  assert.deepEqual(CONSTRUCTION_DIRECT_GIZMO_CONFIG.thickness, source.thickness);
  assert.equal(CONSTRUCTION_DIRECT_GIZMO_CONFIG.render.thicknessColor, source.render.thicknessColor);
  assert.equal(CONSTRUCTION_DIRECT_GIZMO_CONFIG.thickness.minimum, 0.1);
  assert.equal(CONSTRUCTION_DIRECT_GIZMO_CONFIG.thickness.maximum, 10);
  assert.ok(CONSTRUCTION_DIRECT_GIZMO_CONFIG.thickness.pickRadius > CONSTRUCTION_DIRECT_GIZMO_CONFIG.thickness.radius);
  assert.ok(CONSTRUCTION_DIRECT_GIZMO_CONFIG.thickness.precisionMultiplier > 0);
  assert.ok(CONSTRUCTION_DIRECT_GIZMO_CONFIG.thickness.precisionMultiplier < 1);
});
