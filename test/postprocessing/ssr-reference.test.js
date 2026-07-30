import assert from 'node:assert/strict';
import test from 'node:test';
import { REFLECTION_CLASSES } from '../../src/render/postprocessing/PostProcessingMaterialData.js';
import { PostProcessingHistory } from '../../src/render/postprocessing/PostProcessingHistory.js';
import {
  ssrEligibilityReference,
  ssrFresnelF0Reference,
  ssrThicknessAcceptReference,
} from '../../src/render/postprocessing/nodes/SelectiveSsrNode.js';

test('SSR Fresnel F0 follows the material reflection classes', () => {
  assert.equal(ssrFresnelF0Reference(REFLECTION_CLASSES.NONE), 0);
  assert.equal(ssrFresnelF0Reference(REFLECTION_CLASSES.WATER), 0.020);
  assert.equal(ssrFresnelF0Reference(REFLECTION_CLASSES.ICE), 0.045);
  assert.equal(ssrFresnelF0Reference(REFLECTION_CLASSES.WET_STONE), 0.040);
  assert.equal(ssrFresnelF0Reference(REFLECTION_CLASSES.POLISHED_STONE), 0.060);
  assert.equal(ssrFresnelF0Reference(REFLECTION_CLASSES.MAGICAL_MIRROR), 0.100);
});

test('SSR eligibility rejects non-reflective, rough, background, and back-facing pixels', () => {
  const eligible = {
    reflectionClass: REFLECTION_CLASSES.WATER,
    roughness: 0.2,
    roughnessCutoff: 0.45,
    linearDepthMeters: 12,
    normalFacesReflection: true,
  };
  assert.equal(ssrEligibilityReference(eligible), true);
  assert.equal(ssrEligibilityReference({
    ...eligible,
    reflectionClass: REFLECTION_CLASSES.NONE,
  }), false);
  assert.equal(ssrEligibilityReference({ ...eligible, roughness: 0.6 }), false);
  assert.equal(ssrEligibilityReference({
    ...eligible,
    linearDepthMeters: Number.POSITIVE_INFINITY,
  }), false);
  assert.equal(ssrEligibilityReference({
    ...eligible,
    normalFacesReflection: false,
  }), false);
});

test('SSR thickness accepts only crossings inside the forward thickness interval', () => {
  assert.equal(ssrThicknessAcceptReference(10, 10, 0.35), true);
  assert.equal(ssrThicknessAcceptReference(10.35, 10, 0.35), true);
  assert.equal(ssrThicknessAcceptReference(10.36, 10, 0.35), false);
  assert.equal(ssrThicknessAcceptReference(9.99, 10, 0.35), false);
});

test('SSR history is ping-ponged and cleared by full invalidation', () => {
  const history = new PostProcessingHistory();
  history.ensureSsrResources(960, 540);
  const firstRead = history.ssrReadColourTarget;
  assert.equal(history.ssrWidth, 960);
  assert.equal(history.ssrHeight, 540);
  assert.notStrictEqual(firstRead, history.ssrWriteColourTarget);

  history.latchSsrFrame();
  assert.equal(history.ssrValid, true);
  assert.notStrictEqual(history.ssrReadColourTarget, firstRead);

  history.invalidate('SSR_TEST_RESET');
  assert.equal(history.ssrValid, false);
  assert.strictEqual(history.ssrReadColourTarget, firstRead);
  history.dispose();
});
