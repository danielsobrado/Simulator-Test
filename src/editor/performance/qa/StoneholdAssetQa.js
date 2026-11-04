import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { TownKitAssets } from '../../towns/TownKitAssets.js';
import { createTownKitMaterial } from '../../towns/TownKitMaterial.js';
import { resolveLook } from '../../towns/TownMaterialPalette.js';

const NAMES = [
  'Stonehold_Ledge_Small', 'Stonehold_Ledge_Large', 'Stonehold_Twin_Outcrop',
  'Stonehold_Vent_Crater', 'Stonehold_Caldera_Basin', 'Stonehold_Fang_Shrine',
  'Stonehold_Cavern_Maw', 'Stonehold_Horned_Sanctum', 'Mine_Vent_Stack',
  'Mountain_Cliff_Wall', 'Mountain_Gate_Massif', 'Mountain_Cavern_Vault',
];
const query = new URLSearchParams(location.search);
const controls = Object.fromEntries(['module', 'lod', 'light', 'view'].map(id => [id, document.getElementById(id)]));
for (const name of NAMES) controls.module.add(new Option(name.replaceAll('_', ' '), name));
for (const [key, input] of Object.entries(controls)) if (query.has(key)) input.value = query.get(key);
if (!NAMES.includes(controls.module.value)) controls.module.value = 'Stonehold_Twin_Outcrop';
const status = document.getElementById('status');

async function main() {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  document.body.prepend(renderer.domElement);
  await renderer.init();
  const assets = new TownKitAssets();
  await assets.ensure();
  if (assets.failed) throw assets.failed;
  const material = createTownKitMaterial(assets.atlas, resolveLook({
    skin: 'heartland', stone: 'granite', finish: 'masonry', family: 'Stonehold',
    thatch: false, banner: [0.11, 0.18, 0.32],
  }));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#52677b');
  scene.fog = new THREE.FogExp2('#52677b', 0.0025);
  const sky = new THREE.HemisphereLight('#bed7f0', '#51453b', 2.1);
  scene.add(sky);
  const sun = new THREE.DirectionalLight('#ffe2b8', 3.2);
  sun.position.set(-20, 35, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 0.1, far: 140 });
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#aacaf1', 1.0);
  rim.position.set(15, 15, -20);
  scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardNodeMaterial({ color: '#3a454b', roughness: 0.96 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.18;
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1500);
  const orbit = new OrbitControls(camera, renderer.domElement);
  let mesh;
  function update() {
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    const far = controls.lod.value === '1';
    const geometry = (far ? assets.farModules : assets.modules).get(controls.module.value)?.opaque;
    if (!geometry) throw new Error(`Missing ${controls.module.value} at LOD ${controls.lod.value}`);
    const copies = Math.min(16, Math.max(1, Number(query.get('copies')) || 1));
    mesh = new THREE.InstancedMesh(geometry, material, copies);
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
    for (let i = 0; i < copies; i += 1) {
      mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation((i % 4) * (size.x + 4), 0, Math.floor(i / 4) * (size.z + 4)));
      mesh.setColorAt(i, new THREE.Color(0.95, 0.95, 0.95));
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const reach = Math.max(size.x, size.y, size.z) * (copies > 1 ? 3 : 1);
    if (copies > 1) centre.add(new THREE.Vector3(size.x * 1.5, 0, size.z * 1.5));
    if (controls.view.value === 'detail') {
      centre.y += size.y * 0.10;
      camera.position.copy(centre).add(new THREE.Vector3(0, reach * 0.08, reach * 0.62));
    } else {
      const direction = controls.view.value === 'front' ? new THREE.Vector3(0, 0.12, 1) : new THREE.Vector3(-0.4, 0.62, 1);
      camera.position.copy(centre).add(direction.normalize().multiplyScalar(reach * 2));
    }
    orbit.target.copy(centre);
    orbit.update();
    const dusk = controls.light.value === 'dusk';
    sky.intensity = dusk ? 0.65 : 2.1;
    sun.intensity = dusk ? 0.65 : 3.2;
    rim.intensity = dusk ? 0.8 : 1.0;
    status.textContent = `${controls.module.value.replaceAll('_', ' ')} · ${Math.round(geometry.index.count / 3).toLocaleString()} triangles · ${size.x.toFixed(1)} × ${size.z.toFixed(1)} × ${size.y.toFixed(1)} m · drag to orbit`;
    window.__stoneholdQa.current = { module: controls.module.value, lod: Number(controls.lod.value), copies, triangles: geometry.index.count / 3 };
  }
  window.__stoneholdQa = { ready: false, renderer, assets, scene, camera, update, frameTimes: [] };
  update();
  for (const input of Object.values(controls)) input.addEventListener('change', update);
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  await renderer.compileAsync(scene, camera);
  let previous = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const state = window.__stoneholdQa;
    if (state.measuring) state.frameTimes.push(now - previous);
    previous = now;
    renderer.render(scene, camera);
    state.ready = true;
  });
}

main().catch(error => { status.textContent = error.message; console.error(error); });
