import * as THREE from 'three/webgpu';
import { cameraPosition, color, float, mix, normalView, normalWorldGeometry, positionWorld, smoothstep, normalize, uniform, uv, vec2, vec4 } from 'three/tsl';
import bakeSource from '../../../../config/terrain-material-bake.yaml?compiled';
import { createTerrainMaterialBakeConfig } from '../../materials/TerrainMaterialBakeConfig.js';
import { createTerrainMaterialBakedSurface } from '../../materials/TerrainMaterialBakedNodes.js';
import { createSnowDetailNodes } from '../../stylized/SnowDetailShading.js';
import { createSnowSurfaceNodes } from '../../stylized/SnowSurfaceShading.js';
import { applySnowLighting } from '../../stylized/SnowLightingModel.js';
import { resolveSnowSurfaceConfig } from '../../stylized/SnowSurfaceConfig.js';
import { acquireSnowTextures } from '../../assets/godsEnd/snowTextures.js';
import { worldWindUniforms } from '../../weather/wind/worldWindState.js';
import { skyLightUniforms } from '../../stylized/sky/skyLight.js';
import { createSnowBiomeFixtureEffects } from './SnowBiomeFixtureEffects.js';

const state = { ready: false };
window.__snowSurfaceFixture = state;
try {
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  await renderer.init();
  state.webgpu = renderer.backend.isWebGPUBackend === true;
  if (!state.webgpu) throw new Error('Snow surface acceptance requires WebGPU.');
  renderer.setSize(1280, 720); renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#a4b7ce');
  const camera = new THREE.PerspectiveCamera(58, 1280 / 720, 0.1, 200);
  const sun = new THREE.DirectionalLight('#fff0dc', 3); sun.position.set(15, 10, -25); scene.add(sun);
  const fill = new THREE.HemisphereLight('#dce6ff', '#e6ecf3', 0.85); scene.add(fill);
  worldWindUniforms.prevailing.value.set(-0.866, 0.5);
  const geometry = new THREE.PlaneGeometry(64, 64, 128, 128); geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const groundHeight = (x, z) => Math.sin(x * 0.16) * Math.sin(z * 0.13) * 0.65 + Math.max(0, Math.abs(x) - 10) * 0.7;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    positions.setY(i, groundHeight(x, z));
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry); scene.add(mesh);
  const center = uniform(new THREE.Vector2(320, 192));
  const snow = uniform(1), pressed = uniform(0), uvOffset = uniform(new THREE.Vector2());
  const terrainUv = uv().add(uvOffset);
  const path = smoothstep(0.8, 2, positionWorld.x.add(positionWorld.z.mul(0.12).sin()).abs()).oneMinus().mul(pressed);
  const bakeReady = uniform(1);
  const fixtureBakeSource = structuredClone(bakeSource);
  for (const key of ['features', 'genomes', 'weathering']) fixtureBakeSource.families[key].enabled = false;
  const bake = createTerrainMaterialBakeConfig(fixtureBakeSource);
  const geometryWorld = normalWorldGeometry;
  const octDenominator = geometryWorld.abs().x.add(geometryWorld.abs().y).add(geometryWorld.abs().z);
  const sampleBake = name => {
    if (name === 'materialWeights') return vec4(0, 0, 0, 1);
    if (name === 'macroTint') return vec4(0.5);
    if (name === 'farNormal') return vec4(geometryWorld.x.div(octDenominator), geometryWorld.z.div(octDenominator), 0, 1);
    if (name === 'farColor') return vec4(color('#e8eef2'), 1);
    return vec4(0);
  };
  const bakedSurface = createTerrainMaterialBakedSurface({ terrainUv, tileColor: color('#e8eef2'), heightShade: float(1),
    cameraDistance: cameraPosition.distance(positionWorld), proceduralColor: color('#e8eef2'),
    worldXZ: vec2(0), terrainHeight: positionWorld.y, familyAtlas: null,
    gpuState: { ready: bakeReady, blend: uniform(1), stale: uniform(0), sampleTexture: sampleBake, loadTexture: sampleBake },
    stylizedConfig: { materialBake: bake, color: { bottom: '#e8eef2', brightness: 1 }, dirt: { color: '#66584c' } } });
  const makeMaterial = (settings, lighting = true, inputNormal = normalView) => {
    const material = new THREE.MeshStandardNodeMaterial();
    const detail = createSnowDetailNodes({ terrainUv, chunkWorldSize: 64, chunkCenter: center, snow,
      material, groundHeight: positionWorld.y, pathMask: path, baseNormal: inputNormal, reliefEnabled: true, settings,
      sun: normalize(uniform(sun.position.clone().normalize())) });
    const baseNormal = detail.normal(inputNormal).toVar();
    const surface = createSnowSurfaceNodes({ terrainUv, chunkWorldSize: 64, chunkCenter: center, snow,
      stylizedConfig: { sky: {} }, sunDirection: sun.position.clone().normalize(), baseNormal, pathMask: path, settings });
    const detailedColor = detail.color(mix(color('#66584c'), color('#e8eef2'), snow));
    material.colorNode = lighting ? surface.apply(detailedColor) : detailedColor;
    material.normalNode = baseNormal;
    material.roughnessNode = detail.roughness(float(0.78));
    if (lighting) {
      applySnowLighting(material, surface.sunResponse);
      material.emissiveNode = detail.shade;
    }
    return material;
  };
  const settings = resolveSnowSurfaceConfig();
  const effects = await createSnowBiomeFixtureEffects({ renderer, scene, sun, fill, groundHeight });
  const materials = {
    powder: makeMaterial(settings),
    worked: makeMaterial({ ...settings, calmCoverage: 0 }),
    detail: makeMaterial(settings, false),
    baked: makeMaterial(settings, true, bakedSurface.normal),
  };
  state.capture = async kind => {
    snow.value = kind.startsWith('snowless') ? 0 : 1; pressed.value = kind.includes('packed') ? 1 : 0;
    mesh.material = kind.includes('worked') ? materials.worked : kind.startsWith('detail') ? materials.detail : materials.powder;
    if (kind.startsWith('baked')) mesh.material = materials.baked;
    bakeReady.value = kind === 'baked-pending' ? 0 : 1;
    center.value.set(320, 192); uvOffset.value.set(0, 0); mesh.position.set(0, 0, 0);
    camera.position.set(0, 3.2, 18); camera.lookAt(0, 0, -8);
    if (kind === 'negative') center.value.set(-320, -192);
    if (kind === 'detail-adjacent-chunk') { center.value.x += 64; uvOffset.value.x -= 1; }
    if (kind === 'rebased') { mesh.position.x -= 4096; camera.position.x -= 4096; camera.lookAt(-4096, 0, -8); }
    const night = kind.includes('night');
    scene.background.set(night ? '#040914' : '#a4b7ce');
    sun.intensity = night ? 0 : 3; fill.intensity = night ? 0.025 : 0.85;
    skyLightUniforms.brightness.value = night ? 0.02 : 1;
    skyLightUniforms.sunColor.value.setRGB(night ? 0 : 1, night ? 0 : 1, night ? 0 : 1);
    if (kind.startsWith('powder-kick')) { camera.position.set(0, 1.4, 3); camera.lookAt(0, 0.3, 0); }
    state.effects = effects.capture(kind, camera);
    renderer.render(scene, camera); await renderer.backend.device.queue.onSubmittedWorkDone();
  };
  const maps = acquireSnowTextures();
  try {
    const deadline = performance.now() + 30000;
    while (maps.ready.value < 1) {
      if (performance.now() > deadline) throw new Error('Snow detail maps failed to become ready.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (const kind of ['open', 'worked', 'detail', 'baked']) {
      await state.capture(kind); await renderer.compileAsync(scene, camera);
    }
    state.ready = true;
  } finally { maps.release(); }
} catch (error) { state.failure = error.stack; }
