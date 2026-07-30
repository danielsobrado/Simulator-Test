import assert from 'node:assert/strict';
import test from 'node:test';
import { cinematicDofCoCReference } from '../../src/render/postprocessing/nodes/CinematicDofNode.js';
import { vignetteFactorReference } from '../../src/render/postprocessing/nodes/LensEffectsNode.js';

test('vignette radii remain deterministic when crossed', () => {
  const ordered = vignetteFactorReference([0.95, 0.5], {
    intensity: 0.4,
    innerRadius: 0.3,
    outerRadius: 1.1,
  });
  const crossed = vignetteFactorReference([0.95, 0.5], {
    intensity: 0.4,
    innerRadius: 1.1,
    outerRadius: 0.3,
  });
  assert.equal(crossed, ordered);
});

test('DOF near and far thresholds remain deterministic when crossed', () => {
  const ordered = cinematicDofCoCReference(300, 20, {
    nearStartRatio: 0.55,
    nearFullRatio: 0.16,
    farStartMeters: 130,
    farFullMeters: 620,
  });
  const crossed = cinematicDofCoCReference(300, 20, {
    nearStartRatio: 0.16,
    nearFullRatio: 0.55,
    farStartMeters: 620,
    farFullMeters: 130,
  });
  assert.deepEqual(crossed, ordered);
});
