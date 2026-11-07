import * as THREE from 'three/webgpu';
import { createStylizedSceneLoader } from '/src/editor/stylized/StylizedSceneAssetCache.js';
import { uniform } from 'three/tsl';
import yaml from 'js-yaml';
import editorSource from '/editor.config.yaml?raw';
import { GrassTuning } from '/src/editor/stylized/GrassTuning.js';
import { createMeadowTemplate, hash2d } from '/src/editor/stylized/meadow/meadowGrassGeometry.js';
import { createMeadowBladeMaterial } from '/src/editor/stylized/meadow/meadowBladeMaterial.js';
import { resolveMeadowGrassConfig } from '/src/editor/stylized/meadow/meadowGrassConfig.js';
import { createMeadowUniforms } from '/src/editor/stylized/meadow/meadowUniforms.js';
import { addGardenFlowers } from './ConstructionGardenFlowers.js';

export const gardenHeightAt = (x, z) => 0.08 * Math.sin(x * 0.27) * Math.sin(z * 0.31);

/** Semantic wall footprints, never inferred from the finished masonry. */
function wallDistanceSampler(walls) {
  const buckets = new Map();
  for (const { record, arcTable } of walls) {
    for (let s = 0; s < arcTable.totalLength + 0.12; s += 0.12) {
      const point = { ...arcTable.frameAt(s), radius: record.dimensions.thickness / 2 };
      const key = `${Math.floor(point.x)}:${Math.floor(point.z)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(point);
    }
  }
  return (x, z) => {
    let distance = 2;
    const cellX = Math.floor(x), cellZ = Math.floor(z);
    for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
      for (const point of buckets.get(`${cellX + dx}:${cellZ + dz}`) ?? []) {
        distance = Math.min(distance, Math.hypot(x - point.x, z - point.z) - point.radius);
      }
    }
    return distance;
  };
}

/** Uses production grass shaders/templates in a fixed, bounded comparison scene. */
export async function addConstructionGardenEnvironment(scene, { walls, path, sun, hemisphere, renderer, trees = null, showTrees = true }) {
  const config = yaml.load(editorSource).stylizedSurface;
  // Freeze weather effects for reproducible captures; keep production grass tuning.
  const frozen = { ...config, sky: { ...config.sky, cloudShadows: { enabled: false } }, ambientEffects: { enabled: false } };
  const settings = resolveMeadowGrassConfig({ ...config.grass.meadow, far: { enabled: false }, interaction: { enabled: false } });
  const tuning = new GrassTuning(config);
  const uniforms = createMeadowUniforms(settings);
  uniforms.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
  uniforms.skyColor.value.copy(hemisphere.color).multiplyScalar(hemisphere.intensity / Math.PI);
  const count = 129600;
  const wallDistance = wallDistanceSampler(walls);
  const geometry = createMeadowTemplate({ detail: 3, count, tileSize: 36 });
  // This fixed field is one band; retain every surviving stem at all camera poses.
  for (const band of uniforms.lodBands.array) band.set(1000, count, count, 1);
  geometry.setAttribute('instanceTile', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  const positions = geometry.getAttribute('instancePosition').array;
  const data = geometry.getAttribute('instanceData').array;
  let kept = 0;
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 4], z = positions[i * 4 + 2];
    const distance = wallDistance(x, z);
    if (distance < 0.08) continue;
    const pathDistance = path ? Math.abs(x - path.center[0]) - path.radius : Infinity;
    const worn = path && z > -2 && z < 13;
    if (worn && pathDistance < -0.2) continue;
    positions.copyWithin(kept * 4, i * 4, i * 4 + 4);
    data.copyWithin(kept * 4, i * 4, i * 4 + 4);
    geometry.getAttribute('instanceRotation').array.copyWithin(kept * 2, i * 2, i * 2 + 2);
    positions[kept * 4 + 1] = gardenHeightAt(x, z);
    positions[kept * 4 + 3] = distance < 0.5 ? 0.65 + distance * 0.7 : 1;
    data[kept * 4] = worn && pathDistance < 0.4 ? 0.6 : 0;
    kept += 1;
  }
  geometry.instanceCount = kept;
  const material = createMeadowBladeMaterial({ uniforms, tuning: tuning.uniforms, config: frozen,
    sunDirection: uniform(sun.position.clone().normalize()), bandCount: 1, tileSize: 36 });
  const grass = new THREE.Mesh(geometry, material);
  grass.frustumCulled = false;
  grass.receiveShadow = true;
  scene.add(grass);
  const flowers = addGardenFlowers(scene, { wallDistance, groundHeightAt: gardenHeightAt, path });

  const groundGeometry = new THREE.PlaneGeometry(60, 60, 100, 100);
  groundGeometry.rotateX(-Math.PI / 2);
  const groundPositions = groundGeometry.getAttribute('position');
  const colors = new Float32Array(groundPositions.count * 3);
  const base = new THREE.Color('#69813d'), dry = new THREE.Color('#9c915f');
  for (let i = 0; i < groundPositions.count; i += 1) {
    const x = groundPositions.getX(i), z = groundPositions.getZ(i);
    groundPositions.setY(i, gardenHeightAt(x, z) - 0.02);
    const wear = path && z > -2 && z < 13
      ? Math.max(0, 1 - Math.abs(x - path.center[0]) / (path.radius + 0.4)) : 0;
    const shade = base.clone().lerp(dry, wear).multiplyScalar(0.94 + hash2d(x * 0.1, z * 0.1) * 0.12);
    colors.set([shade.r, shade.g, shade.b], i * 3);
  }
  groundGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeometry.computeVertexNormals();
  const groundMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);

  const { loader, release } = createStylizedSceneLoader({ renderer });
  let tree;
  try { tree = (await loader.loadAsync('/assets/trees/meadow/tree7.glb')).scene; }
  finally { release(); }
  const bounds = new THREE.Box3().setFromObject(tree);
  const scale = (trees?.height ?? 9.5) / (bounds.max.y - bounds.min.y);
  const root = new THREE.Group();
  root.add(tree);
  tree.position.x -= (bounds.min.x + bounds.max.x) / 2;
  tree.position.z -= (bounds.min.z + bounds.max.z) / 2;
  tree.position.y -= bounds.min.y;
  root.scale.setScalar(scale);
  for (const [i, [x, z]] of (trees?.positions ?? [[-10, -8], [-5, -12], [1, -13], [8, -10], [12, -4]]).entries()) {
    const instance = root.clone(true);
    instance.position.set(x, gardenHeightAt(x, z), z);
    instance.rotation.y = i * 1.7;
    instance.scale.multiplyScalar(0.85 + i * 0.07);
    instance.visible = showTrees;
    instance.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    scene.add(instance);
  }
  return {
    stats: { grassStems: kept, grassTriangles: kept * 5, flowers: flowers.count, flowerTriangles: flowers.triangles,
      trees: showTrees ? 5 : 0, treeAsset: '/assets/trees/meadow/tree7.glb', terrain: 'fixed-undulating-meadow', grassMaterial: material.name },
    dispose() {
      material.dispose(); groundMaterial.dispose(); flowers.dispose();
      const materials = new Set();
      tree.traverse(object => {
        for (const mat of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) materials.add(mat);
      });
      for (const mat of materials) {
        for (const value of Object.values(mat)) if (value?.isTexture) value.dispose();
        mat.dispose();
      }
    },
  };
}
