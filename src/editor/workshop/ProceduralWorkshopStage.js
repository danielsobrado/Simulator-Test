import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mixSeed } from './ProceduralRandom.js';

const STAGE_SEED = 4_817;
const PREVIEW_HALF_SIZE = 8;
const TERRAIN_SIZE = 72;
const TERRAIN_SEGMENTS = 88;
const TREE_COUNT = 24;
const ROCK_COUNT = 14;
const HILL_COUNT = 11;
const CLOUD_COUNT = 5;

function random01(seed, index) {
  return (mixSeed(seed, index) & 0xffff) / 0xffff;
}

function terrainHeightAt(x, z) {
  const radius = Math.hypot(x, z);
  const centerMask = THREE.MathUtils.smoothstep(radius, 5, 21);
  const broad = Math.sin(x * 0.105 + 0.8) * 0.78 + Math.cos(z * 0.088 - 0.45) * 0.72;
  const cross = Math.sin((x + z) * 0.052) * 0.66 + Math.cos((x - z) * 0.061) * 0.52;
  const fine = Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.12;
  const rim = Math.max(0, radius - 13) * 0.085;
  return (broad + cross) * centerMask * 0.56 + fine * 0.35 + rim;
}

function createSkyTexture() {
  const data = new Uint8Array(4 * 320 * 4);
  const zenith = new THREE.Color('#74b8f1');
  const upper = new THREE.Color('#b9ddf3');
  const horizon = new THREE.Color('#e7efcf');
  const ground = new THREE.Color('#86a96d');
  const color = new THREE.Color();

  for (let y = 0; y < 320; y += 1) {
    const vertical = 1 - y / 319;
    if (vertical < 0.63) {
      color.copy(zenith).lerp(upper, THREE.MathUtils.smoothstep(vertical, 0.08, 0.63));
    } else {
      color.copy(upper).lerp(horizon, THREE.MathUtils.smoothstep(vertical, 0.63, 0.82));
    }
    if (vertical > 0.82) {
      color.lerp(ground, THREE.MathUtils.smoothstep(vertical, 0.82, 1));
    }
    for (let x = 0; x < 4; x += 1) {
      const index = (y * 4 + x) * 4;
      data[index] = Math.round(color.r * 255);
      data[index + 1] = Math.round(color.g * 255);
      data[index + 2] = Math.round(color.b * 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, 4, 320, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createTerrain() {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const lush = new THREE.Color('#76aa4e');
  const dry = new THREE.Color('#a8c56a');
  const shadow = new THREE.Color('#557e42');
  const color = new THREE.Color();

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const height = terrainHeightAt(x, z);
    positions.setY(index, height);
    const noise = random01(STAGE_SEED + Math.floor(x * 11), index + Math.floor(z * 13));
    const slopeShade = THREE.MathUtils.smoothstep(Math.abs(height), 0.35, 2.4);
    color.copy(lush).lerp(dry, noise * 0.42).lerp(shadow, slopeShade * 0.2);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  return terrain;
}

function createPath() {
  const controlPoints = [
    new THREE.Vector3(-11.5, 0, 9.5),
    new THREE.Vector3(-6.5, 0, 4.8),
    new THREE.Vector3(-1.5, 0, 2.1),
    new THREE.Vector3(2.8, 0, -1.4),
    new THREE.Vector3(8.5, 0, -5.8),
  ];
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
  const segments = 44;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const point = curve.getPoint(progress);
    const tangent = curve.getTangent(progress).normalize();
    const normalX = -tangent.z;
    const normalZ = tangent.x;
    const width = 0.72 + Math.sin(progress * Math.PI) * 0.28;

    for (const side of [-1, 1]) {
      const x = point.x + normalX * width * side;
      const z = point.z + normalZ * width * side;
      positions.push(x, terrainHeightAt(x, z) + 0.035, z);
      uvs.push(progress * 5, side > 0 ? 1 : 0);
    }

    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const path = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: '#9b8254', roughness: 1, metalness: 0 }),
  );
  path.receiveShadow = true;
  return path;
}

function createBoundary() {
  const points = [];
  const steps = 12;
  const addEdge = (startX, startZ, endX, endZ) => {
    for (let index = 0; index < steps; index += 1) {
      const progress = index / steps;
      const x = THREE.MathUtils.lerp(startX, endX, progress);
      const z = THREE.MathUtils.lerp(startZ, endZ, progress);
      points.push(new THREE.Vector3(x, terrainHeightAt(x, z) + 0.055, z));
    }
  };
  addEdge(-PREVIEW_HALF_SIZE, -PREVIEW_HALF_SIZE, PREVIEW_HALF_SIZE, -PREVIEW_HALF_SIZE);
  addEdge(PREVIEW_HALF_SIZE, -PREVIEW_HALF_SIZE, PREVIEW_HALF_SIZE, PREVIEW_HALF_SIZE);
  addEdge(PREVIEW_HALF_SIZE, PREVIEW_HALF_SIZE, -PREVIEW_HALF_SIZE, PREVIEW_HALF_SIZE);
  addEdge(-PREVIEW_HALF_SIZE, PREVIEW_HALF_SIZE, -PREVIEW_HALF_SIZE, -PREVIEW_HALF_SIZE);
  points.push(points[0].clone());

  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: '#fff0b5',
      transparent: true,
      opacity: 0.32,
    }),
  );
}

function createMaterials() {
  return Object.freeze({
    trunk: new THREE.MeshStandardMaterial({ color: '#71513a', roughness: 1 }),
    conifer: new THREE.MeshStandardMaterial({ color: '#376f43', roughness: 0.96 }),
    broadleaf: new THREE.MeshStandardMaterial({ color: '#629548', roughness: 0.94 }),
    brightLeaf: new THREE.MeshStandardMaterial({ color: '#86b85b', roughness: 0.94 }),
    rock: new THREE.MeshStandardMaterial({ color: '#8f8c76', roughness: 0.99 }),
    cloud: new THREE.MeshStandardMaterial({
      color: '#f4f7e8',
      roughness: 1,
      emissive: '#d9e8ee',
      emissiveIntensity: 0.16,
    }),
    hills: [
      new THREE.MeshStandardMaterial({ color: '#71915e', roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: '#7e9b67', roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: '#658255', roughness: 1 }),
    ],
  });
}

function addConifer(group, materials, seed, x, z) {
  const trunkHeight = 1.45 + random01(seed, 1) * 1.3;
  const y = terrainHeightAt(x, z);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.19, trunkHeight, 7),
    materials.trunk,
  );
  trunk.position.set(x, y + trunkHeight / 2, z);
  trunk.castShadow = true;
  group.add(trunk);

  const layers = 3 + Math.round(random01(seed, 2) * 2);
  for (let layer = 0; layer < layers; layer += 1) {
    const progress = layer / Math.max(1, layers - 1);
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.85 - progress * 0.25, 1.45, 9),
      materials.conifer,
    );
    crown.position.set(x, y + trunkHeight * 0.62 + layer * 0.58, z);
    crown.rotation.y = random01(seed, 10 + layer) * Math.PI;
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);
  }
}

function addBroadleaf(group, materials, seed, x, z) {
  const trunkHeight = 1.6 + random01(seed, 1) * 1.6;
  const y = terrainHeightAt(x, z);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.22, trunkHeight, 7),
    materials.trunk,
  );
  trunk.position.set(x, y + trunkHeight / 2, z);
  trunk.castShadow = true;
  group.add(trunk);

  const crownMaterial = random01(seed, 2) > 0.58 ? materials.brightLeaf : materials.broadleaf;
  const clusters = 3 + Math.round(random01(seed, 3) * 2);
  for (let index = 0; index < clusters; index += 1) {
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.82 + random01(seed, 10 + index) * 0.5, 1),
      crownMaterial,
    );
    crown.scale.set(1.05, 0.9 + random01(seed, 20 + index) * 0.4, 1);
    crown.position.set(
      x + (random01(seed, 30 + index) - 0.5) * 1.1,
      y + trunkHeight + 0.45 + random01(seed, 40 + index) * 0.95,
      z + (random01(seed, 50 + index) - 0.5) * 1.1,
    );
    crown.rotation.y = random01(seed, 60 + index) * Math.PI;
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);
  }
}

function addTrees(group, materials) {
  for (let index = 0; index < TREE_COUNT; index += 1) {
    const seed = STAGE_SEED + 1_000 + index * 17;
    const angle = index / TREE_COUNT * Math.PI * 2 + random01(seed, 1) * 0.3;
    const radius = 12.5 + random01(seed, 2) * 12.5;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    if (random01(seed, 3) < 0.57) addConifer(group, materials, seed, x, z);
    else addBroadleaf(group, materials, seed, x, z);
  }
}

function addRocks(group, materials) {
  for (let index = 0; index < ROCK_COUNT; index += 1) {
    const seed = STAGE_SEED + 2_000 + index * 19;
    const angle = index / ROCK_COUNT * Math.PI * 2 + random01(seed, 1) * 0.42;
    const radius = 8.8 + random01(seed, 2) * 5.6;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const size = 0.38 + random01(seed, 3) * 0.88;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), materials.rock);
    rock.scale.set(1.25 + random01(seed, 4) * 0.45, 0.58 + random01(seed, 5) * 0.38, 0.9);
    rock.position.set(x, terrainHeightAt(x, z) + size * 0.36, z);
    rock.rotation.set(random01(seed, 6) * 0.3, random01(seed, 7) * Math.PI, 0);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }
}

function addDistantHills(group, materials) {
  for (let index = 0; index < HILL_COUNT; index += 1) {
    const seed = STAGE_SEED + 3_000 + index * 23;
    const angle = index / HILL_COUNT * Math.PI * 2 + random01(seed, 1) * 0.32;
    const radius = 27 + random01(seed, 2) * 7;
    const width = 5.5 + random01(seed, 3) * 6;
    const height = 3.8 + random01(seed, 4) * 5.2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(width, height, 7, 1, false),
      materials.hills[index % materials.hills.length],
    );
    hill.scale.z = 0.78 + random01(seed, 5) * 0.55;
    hill.position.set(x, terrainHeightAt(x, z) + height * 0.5 - 1.1, z);
    hill.rotation.y = random01(seed, 6) * Math.PI;
    hill.receiveShadow = true;
    group.add(hill);
  }
}

function addClouds(group, materials) {
  for (let cloudIndex = 0; cloudIndex < CLOUD_COUNT; cloudIndex += 1) {
    const seed = STAGE_SEED + 4_000 + cloudIndex * 29;
    const angle = cloudIndex / CLOUD_COUNT * Math.PI * 2 + random01(seed, 1) * 0.48;
    const radius = 22 + random01(seed, 2) * 16;
    const height = 12 + random01(seed, 3) * 7;
    const centerX = Math.sin(angle) * radius;
    const centerZ = Math.cos(angle) * radius;
    const lobes = 4 + Math.round(random01(seed, 4) * 3);

    for (let lobe = 0; lobe < lobes; lobe += 1) {
      const cloud = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.7 + random01(seed, 10 + lobe) * 1.7, 1),
        materials.cloud,
      );
      cloud.scale.set(1.55, 0.62 + random01(seed, 20 + lobe) * 0.25, 0.9);
      cloud.position.set(
        centerX + (lobe - (lobes - 1) / 2) * 2.15,
        height + Math.sin(lobe * 1.3) * 0.55,
        centerZ + (random01(seed, 30 + lobe) - 0.5) * 1.8,
      );
      group.add(cloud);
    }
  }
}

function createWildflowers() {
  const positions = [];
  const colors = [];
  const palette = ['#f5d45f', '#f3eee0', '#d8828c', '#84b9e4'].map((value) => new THREE.Color(value));

  for (let index = 0; index < 180; index += 1) {
    const x = (random01(STAGE_SEED + 5_000, index * 3) - 0.5) * 25;
    const z = (random01(STAGE_SEED + 5_000, index * 3 + 1) - 0.5) * 25;
    if (Math.abs(z + x * 0.55) < 1.3) continue;
    positions.push(x, terrainHeightAt(x, z) + 0.12, z);
    const color = palette[Math.floor(random01(STAGE_SEED + 5_000, index * 3 + 2) * palette.length)];
    colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 0.1, vertexColors: true, sizeAttenuation: true }),
  );
}

function bucketForMesh(buckets, mesh) {
  let materialBuckets = buckets.get(mesh.material);
  if (!materialBuckets) {
    materialBuckets = new Map();
    buckets.set(mesh.material, materialBuckets);
  }
  const key = `${mesh.castShadow ? 1 : 0}:${mesh.receiveShadow ? 1 : 0}`;
  let bucket = materialBuckets.get(key);
  if (!bucket) {
    bucket = {
      material: mesh.material,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      meshes: [],
    };
    materialBuckets.set(key, bucket);
  }
  bucket.meshes.push(mesh);
}

function mergeStaticMeshes(group) {
  const buckets = new Map();
  group.updateMatrixWorld(true);
  for (const child of group.children) {
    if (child.isMesh && !Array.isArray(child.material)) bucketForMesh(buckets, child);
  }

  const replacements = [];
  const consumed = [];
  try {
    for (const materialBuckets of buckets.values()) {
      for (const bucket of materialBuckets.values()) {
        if (bucket.meshes.length < 2) continue;
        const geometries = bucket.meshes.map((mesh) => {
          mesh.updateMatrix();
          return mesh.geometry.clone().applyMatrix4(mesh.matrix);
        });
        let merged;
        try {
          merged = mergeGeometries(geometries, false);
        } finally {
          geometries.forEach((geometry) => geometry.dispose());
        }
        if (!merged) throw new Error('The workshop could not batch its procedural background.');
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        const replacement = new THREE.Mesh(merged, bucket.material);
        replacement.castShadow = bucket.castShadow;
        replacement.receiveShadow = bucket.receiveShadow;
        replacements.push(replacement);
        consumed.push(...bucket.meshes);
      }
    }
  } catch (error) {
    replacements.forEach((mesh) => mesh.geometry.dispose());
    throw error;
  }

  const sourceGeometries = new Set();
  for (const mesh of consumed) {
    sourceGeometries.add(mesh.geometry);
    group.remove(mesh);
  }
  sourceGeometries.forEach((geometry) => geometry.dispose());
  replacements.forEach((mesh) => group.add(mesh));
}

function disposeGroup(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    for (const value of Object.values(material)) {
      if (value?.isTexture) value.dispose();
    }
    material.dispose();
  });
}

export function createWorkshopStage(scene) {
  const group = new THREE.Group();
  const materials = createMaterials();
  group.name = 'workshop-stage';
  scene.add(group);
  scene.background = createSkyTexture();
  scene.fog = new THREE.Fog('#bdd8b5', 38, 88);

  group.add(createTerrain(), createPath(), createBoundary(), createWildflowers());
  addDistantHills(group, materials);
  addTrees(group, materials);
  addRocks(group, materials);
  addClouds(group, materials);
  mergeStaticMeshes(group);

  const hemisphere = new THREE.HemisphereLight('#d9edff', '#5c7047', 2.25);
  group.add(hemisphere);

  const sun = new THREE.DirectionalLight('#fff1bd', 4.35);
  sun.position.set(-11, 19, 13);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.4;
  sun.target.position.set(0, 3, 0);
  group.add(sun, sun.target);

  const fill = new THREE.DirectionalLight('#9dc9ff', 0.92);
  fill.position.set(11, 8, -11);
  group.add(fill);

  return {
    group,
    dispose() {
      scene.background?.dispose?.();
      scene.background = null;
      scene.fog = null;
      disposeGroup(group);
      group.removeFromParent();
    },
  };
}
