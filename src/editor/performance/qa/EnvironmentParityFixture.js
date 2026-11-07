import * as THREE from 'three/webgpu';
import { texture, uv, vec3 } from 'three/tsl';
import { acquireKtx2Loader } from '../../assets/sharedKtx2Loader.js';
import { loadFoliageMipTexture } from '../../stylized/impostor/FoliageMipTexture.js';
import { createFrostShading, resolveFrost, frostUniforms } from '../../stylized/ambient/FrostShading.js';
import { installUnusedSamplerPruning } from '../../../render/UnusedSamplerBindings.js';
import { raiseDeviceLimits } from '../../../render/deviceLimits.js';
import { runReflectionReprojectionFixture } from './ReflectionReprojectionFixture.js';
import { runSeaSurfFixture } from './SeaSurfFixture.js';
import { runRiverAppearanceFixture } from './RiverAppearanceFixture.js';
import { runWaterBodyAppearanceFixture } from './WaterBodyAppearanceFixture.js';
import { runTerrainCoastAppearanceFixture } from './TerrainCoastAppearanceFixture.js';
import { runShoreDetailsAppearanceFixture } from './ShoreDetailsAppearanceFixture.js';
import { runUnderwaterWaterlineFixture } from './UnderwaterWaterlineFixture.js';

// A bounded render fixture. The world movement harness remains the performance authority.
const backend = new URLSearchParams(location.search).get('backend') ?? 'webgpu';
const requiredLimits = backend === 'webgpu' ? await raiseDeviceLimits({}, { powerPreference: 'high-performance' }) : {};
const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: backend === 'webgl', powerPreference: 'high-performance', requiredLimits });
const pruning = installUnusedSamplerPruning(renderer);
await renderer.init(); renderer.setSize(640, 480); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
document.body.append(renderer.domElement);
const actualBackend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl';
const state = { renderer, report: { backend: actualBackend, requestedBackend: backend, cases: [] }, pendingCapture: null };
window.__environmentFixture = state;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
camera.position.z = 10; camera.updateMatrixWorld();
const { loader, release: releaseKtx2 } = acquireKtx2Loader(renderer);
const owned = [];
async function capture(id, extra = {}) {
  renderer.render(scene, camera);
  if (renderer.backend.isWebGPUBackend) await renderer.backend.device.queue.onSubmittedWorkDone();
  await publishCapture(id, extra);
}
async function publishCapture(id, extra = {}) {
  state.report.cases.push({ id, ...extra });
  state.pendingCapture = id;
  await new Promise(resolve => { state.continue = resolve; });
  state.pendingCapture = null;
}
try {
  if (actualBackend !== backend) throw new Error(`Requested ${backend}, renderer selected ${actualBackend}.`);
  if (new URLSearchParams(location.search).has('waterline')) {
    await runUnderwaterWaterlineFixture(renderer, publishCapture);
  } else if (new URLSearchParams(location.search).has('shoreDetails')) {
    await runShoreDetailsAppearanceFixture(renderer, publishCapture);
  } else {
  const manifest = await (await fetch('/assets/impostors/trees/manifest.json')).json();
  const prototype = manifest.prototypes[0];
  if (!prototype.albedoKtx2) throw new Error('Compressed foliage fixture requires a published KTX2 atlas.');
  const [raw, compressed] = await Promise.all([loadFoliageMipTexture(prototype.albedoMips), loader.loadAsync(prototype.albedoKtx2)]);
  owned.push(raw, compressed);
  for (const map of owned) {
    map.colorSpace = THREE.SRGBColorSpace; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter; map.generateMipmaps = false; map.needsUpdate = true;
  }
  const materials = owned.map(map => {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.colorNode = texture(map, uv()).rgb;
    material.maskNode = texture(map, uv()).a.greaterThanEqual(0.5);
    return material;
  });
  const atlas = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.9), materials[0]); scene.add(atlas);
  for (const [distance, scale] of [['near', 1], ['far', 0.25]]) {
    atlas.scale.setScalar(scale);
    for (let index = 0; index < materials.length; index++) {
      atlas.material = materials[index];
      await capture(`foliage-${index ? 'compressed' : 'raw'}-${distance}`, {
        compressed: index === 1, format: owned[index].format, levels: owned[index].mipmaps.length,
        payloadBytes: owned[index].mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0),
      });
    }
  }
  scene.remove(atlas); atlas.geometry.dispose(); materials.forEach(material => material.dispose());
  const material = new THREE.MeshBasicNodeMaterial();
  const frost = createFrostShading({ normal: vec3(0, 1, 0), worldXZ: uv().mul(25), settings: resolveFrost({}) });
  material.colorNode = frost.applyColor(vec3(0.025, 0.09, 0.035));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), material); scene.add(floor);
  for (const enabled of [false, true]) {
    frostUniforms.cold.value = enabled ? 1 : 0;
    await capture(`frost-${enabled ? 'on' : 'off'}`);
  }
  scene.remove(floor); floor.geometry.dispose(); material.dispose();
  await runReflectionReprojectionFixture(renderer, publishCapture);
  await runSeaSurfFixture(renderer, publishCapture);
  await runRiverAppearanceFixture(renderer, publishCapture);
  await runWaterBodyAppearanceFixture(renderer, publishCapture);
  await runUnderwaterWaterlineFixture(renderer, publishCapture);
  await runTerrainCoastAppearanceFixture(renderer, publishCapture);
  }
} catch (error) { state.report.failure = error.stack; }
finally {
  owned.forEach(map => map.dispose()); releaseKtx2(); frostUniforms.cold.value = 0;
  state.report.done = true;
  // Keep the final canvas available to the browser runner until its context closes.
  pruning.dispose();
}
