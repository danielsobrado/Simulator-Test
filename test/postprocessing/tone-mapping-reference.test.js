import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { PostProcessingController } from '../../src/render/postprocessing/PostProcessingController.js';
import {
  toneMappingAdjustmentsReference,
  toneMappingConstantForMode,
} from '../../src/render/postprocessing/nodes/ToneMappingNode.js';

function assertChannelsClose(actual, expected, epsilon = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((channel, index) => {
    assert.ok(
      Math.abs(channel - expected[index]) <= epsilon,
      `channel ${index}: expected ${expected[index]}, received ${channel}`,
    );
  });
}

test('tone mapping modes select the matching Three.js constants', () => {
  assert.equal(toneMappingConstantForMode('agx'), THREE.AgXToneMapping);
  assert.equal(toneMappingConstantForMode('aces'), THREE.ACESFilmicToneMapping);
  assert.equal(toneMappingConstantForMode('neutral'), THREE.NeutralToneMapping);
  assert.equal(toneMappingConstantForMode('none'), THREE.NoToneMapping);
});

test('exposure and bloom are combined in linear HDR', () => {
  assertChannelsClose(
    toneMappingAdjustmentsReference([0.2, 0.4, 0.8], {
      exposure: 2,
      bloom: [0.1, 0.2, 0.3],
      bloomIntensity: 0.5,
    }),
    [0.45, 0.9, 1.75],
  );
});

test('contrast pivots around middle grey', () => {
  assertChannelsClose(
    toneMappingAdjustmentsReference([0.18, 0.72, 0.045], {
      contrast: 2,
    }),
    [0.18, 2.88, 0.01125],
  );
});

test('zero saturation resolves every channel to luminance', () => {
  const adjusted = toneMappingAdjustmentsReference([1, 0.5, 0.25], {
    saturation: 0,
  });
  const luminance = 1 * 0.2126 + 0.5 * 0.7152 + 0.25 * 0.0722;
  assertChannelsClose(adjusted, [luminance, luminance, luminance]);
});

test('controller restores renderer tone mapping when post is disabled', () => {
  let publish;
  const renderer = {
    domElement: { clientWidth: 1280, clientHeight: 720, width: 1280, height: 720 },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.12,
    getPixelRatio: () => 1,
  };
  const postProcessingStore = {
    get: () => ({ enabled: true }),
    subscribe(listener) {
      publish = listener;
      return () => {};
    },
  };
  const controller = new PostProcessingController({
    renderer,
    scene: {},
    postProcessingStore,
  });

  assert.equal(renderer.toneMapping, THREE.NoToneMapping);
  assert.equal(renderer.toneMappingExposure, 1);

  publish({ enabled: false });
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(renderer.toneMappingExposure, 1.12);

  controller.dispose();
});
