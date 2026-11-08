import * as THREE from 'three/webgpu';
import { createWeatherController } from '../../weather/weather_controller.js';
import { PostProcessingController } from '../../../render/postprocessing/PostProcessingController.js';
import { createPostProcessingSettings } from '../../../render/postprocessing/PostProcessingSettings.js';
import { installUnusedSamplerPruning } from '../../../render/UnusedSamplerBindings.js';

// Use the real weather systems in both single-output and four-output scene passes.
THREE.Node.captureStackTrace = false;
const renderer = new THREE.WebGPURenderer({ antialias: false });
installUnusedSamplerPruning(renderer);
await renderer.init();
renderer.setSize(1280, 720);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8faec1');
const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 200);
camera.position.set(0, 2, 5);
camera.lookAt(0, 2, 0);
camera.updateMatrixWorld();
const settings = { weatherMode: 'off', weatherIntensity: 0.8 };
const weather = createWeatherController({
  scene, camera, isWebGpu: true, worldCells: 1024,
  getSettings: () => settings,
  samplers: { surfaceHeight: () => 0, surfaceNormal: () => [0, 1, 0],
    waterSample: () => ({ depth: 0, bodyMask: 0, waterY: 0 }) },
});
const post = new PostProcessingController({ renderer, scene, postProcessingStore: createPostProcessingSettings() });
const report = { backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl', cases: [] };
window.__renderFixture = { report };
try {
  await weather.precompile(renderer, camera);
  for (const mode of ['meadow', 'rain', 'snow', 'sandstorm', 'storm', 'wind']) {
    window.__renderFixture.current = mode;
    document.querySelector('#status').textContent = mode;
    settings.weatherMode = mode;
    weather.applySettings({ snap: true });
    weather.update(1 / 60, 1, camera.position, camera.position);
    // Include episodic impacts and shafts even between their scheduled events.
    const names = [];
    scene.traverse(object => {
      if (object.material?.isNodeMaterial && object.parent.visible) {
        object.visible = true;
        object.frustumCulled = false;
        if (object.geometry.isInstancedBufferGeometry) object.geometry.instanceCount = Math.max(1, object.geometry.instanceCount);
        names.push(object.material.name);
      }
    });
    renderer.render(scene, camera);
    await renderer.backend.device.queue.onSubmittedWorkDone();
    post.render(camera);
    await renderer.backend.device.queue.onSubmittedWorkDone();
    report.cases.push({ id: mode, materials: names, failure: post.lastFailure?.message ?? null });
  }
} catch (error) { report.failure = error.stack; }
finally { weather.dispose(); post.dispose(); }
report.done = true;
document.querySelector('#status').textContent = report.failure ? 'Failed' : 'Complete';
