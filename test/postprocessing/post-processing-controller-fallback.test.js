import assert from 'node:assert/strict';
import test from 'node:test';
import { PostProcessingController } from '../../src/render/postprocessing/PostProcessingController.js';

function createController() {
  const settings = Object.freeze({ enabled: true });
  const renderer = {
    domElement: { clientWidth: 1280, clientHeight: 720, width: 1280, height: 720 },
    toneMapping: 7,
    toneMappingExposure: 1.12,
    getPixelRatio: () => 1,
  };
  const store = {
    get: () => settings,
    subscribe: () => () => {},
  };
  const controller = new PostProcessingController({
    renderer,
    scene: {},
    postProcessingStore: store,
    sunDirection: {},
  });
  return { controller, renderer };
}

function withoutConsoleError(callback) {
  const original = console.error;
  console.error = () => {};
  try {
    return callback();
  } finally {
    console.error = original;
  }
}

test('render failure restores renderer output and disables the failed topology', () => {
  const { controller, renderer } = createController();
  let finished = false;
  controller.ensureGraph = () => {
    controller.graph = {
      topologySignature: controller.topologySignature,
      render() {
        throw new Error('pipeline failed');
      },
    };
    return controller.graph;
  };
  controller.updateFrame = () => {};
  controller.finishFrame = (rendered) => {
    finished = true;
    assert.equal(rendered, false);
  };

  const rendered = withoutConsoleError(() => controller.render({}));

  assert.equal(rendered, false);
  assert.equal(finished, true);
  assert.equal(controller.isCurrentTopologyFailed(), true);
  assert.equal(renderer.toneMapping, 7);
  assert.equal(renderer.toneMappingExposure, 1.12);
  controller.dispose();
});

test('frame cleanup still runs when updateFrame throws', () => {
  const { controller } = createController();
  let finished = false;
  controller.ensureGraph = () => {
    controller.graph = { topologySignature: controller.topologySignature };
    return controller.graph;
  };
  controller.updateFrame = () => {
    throw new Error('uniform update failed');
  };
  controller.finishFrame = (rendered) => {
    finished = true;
    assert.equal(rendered, false);
  };

  const rendered = withoutConsoleError(() => controller.render({}));

  assert.equal(rendered, false);
  assert.equal(finished, true);
  controller.dispose();
});
