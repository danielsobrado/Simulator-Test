/**
 * Minimal WebGPU harness: PassNode HDR scene + viewportOpaqueMipTexture + rapid resize.
 * Isolates three.js ViewportTextureNode shared-Source / size desync.
 */
import * as THREE from 'three/webgpu';
import {
  color,
  mrt,
  output,
  pass,
  screenUV,
  vec4,
  viewportDepthTexture,
  viewportOpaqueMipTexture,
} from 'three/tsl';

const status = document.getElementById('status');
const logEl = document.getElementById('log');
const params = new URLSearchParams(location.search);
const dpr = Number(params.get('dpr') || '1.5');
const iterations = Number(params.get('iterations') || '80');
const mode = params.get('mode') || 'dual'; // dual | pass
const auto = params.get('auto') !== '0';
const applyPatch = params.get('patch') === '1';

function log(line) {
  logEl.textContent += `${line}\n`;
}

if (applyPatch) {
  const { patchViewportFramebufferSources } = await import(
    '/src/render/patchViewportFramebufferSources.js'
  );
  patchViewportFramebufferSources();
  log('applied viewport framebuffer Source patch');
}

const errors = [];
const originalError = console.error.bind(console);
console.error = (...args) => {
  const text = args.map(String).join(' ');
  if (/CopyTextureToTexture|touches outside|GPUValidationError/i.test(text)) {
    errors.push(text.slice(0, 400));
  }
  originalError(...args);
};

const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(dpr);
document.body.prepend(renderer.domElement);
renderer.domElement.style.display = 'block';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x224466);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0, 0);

const floorMat = new THREE.MeshBasicNodeMaterial();
floorMat.colorNode = color(0x668855);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const waterMat = new THREE.MeshBasicNodeMaterial();
waterMat.transparent = true;
waterMat.depthWrite = false;
waterMat.fragmentNode = vec4(
  viewportOpaqueMipTexture(screenUV).rgb
    .mul(0.85)
    .add(color(0x2266aa).mul(0.15))
    .add(viewportDepthTexture(screenUV).xxx.mul(0.001)),
  1,
);
const water = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.05;
scene.add(water);

const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output }));
const outputTexture = scenePass.getTexture('output');
outputTexture.type = THREE.HalfFloatType;
outputTexture.format = THREE.RGBAFormat;

const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = scenePass.getTextureNode('output');

const heights = [629, 630, 628, 631, 627, 632];
let running = false;

function applySize(cssW, cssH) {
  renderer.setSize(cssW, cssH, false);
  const pixelW = Math.max(1, Math.floor(cssW * dpr));
  const pixelH = Math.max(1, Math.floor(cssH * dpr));
  scenePass.setSize(pixelW, pixelH);
  camera.aspect = cssW / Math.max(1, cssH);
  camera.updateProjectionMatrix();
  return {
    pixelW,
    pixelH,
    canvasW: renderer.domElement.width,
    canvasH: renderer.domElement.height,
  };
}

async function run() {
  if (running) return;
  running = true;
  status.textContent = 'initializing…';
  await renderer.init();
  applySize(1056, 629);
  for (let i = 0; i < 8; i += 1) {
    if (mode === 'dual') renderer.render(scene, camera);
    pipeline.render();
  }

  status.textContent = `running ${iterations} ${mode} frames @ dpr=${dpr}`;
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const h = heights[i % heights.length];
    const w = 1056 + (i % 3);
    const sized = applySize(w, h);
    // Grow/shrink alternating which target updates the shared Source first.
    if (mode === 'dual') {
      if (i % 2 === 0) {
        renderer.render(scene, camera);
        pipeline.render();
      } else {
        pipeline.render();
        renderer.render(scene, camera);
      }
    } else {
      pipeline.render();
    }
    if (i % 10 === 0) {
      samples.push({
        ...sized,
        passW: scenePass.renderTarget.width,
        passH: scenePass.renderTarget.height,
      });
    }
    await new Promise(requestAnimationFrame);
  }

  const report = {
    ok: errors.length === 0,
    mode,
    patch: applyPatch,
    errorCount: errors.length,
    firstError: errors[0] ?? null,
    samples,
    uniquePassHeights: [...new Set(samples.map((s) => s.passH))],
  };
  window.__resizeCopyReport = report;
  status.textContent = report.ok ? 'PASS — no copy errors' : `FAIL — ${errors.length} copy errors`;
  log(JSON.stringify(report, null, 2));
  running = false;
  return report;
}

window.__runResizeCopyRepro = run;
document.getElementById('run').addEventListener('click', () => { void run(); });
if (auto) void run();
