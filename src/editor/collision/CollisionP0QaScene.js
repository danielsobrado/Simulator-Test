import * as THREE from 'three/webgpu';
import { createCollisionP0QaFixture } from './CollisionP0QaFixture.js';

const COLORS = Object.freeze({
  tree: '#3d7a3c',
  rock: '#8b8f91',
  solid: '#bb8058',
  step: '#d1a565',
  ramp: '#5d8fb3',
  construction: '#a87fc2',
});

function createMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
  });
}

function addBox(root, entry, groundHeight, resources) {
  const geometry = new THREE.BoxGeometry(entry.width, entry.height, entry.depth);
  const material = createMaterial(
    entry.kind === 'construction'
      ? COLORS.construction
      : entry.kind === 'step'
        ? COLORS.step
        : entry.kind === 'ramp'
          ? COLORS.ramp
          : COLORS.solid,
  );
  const mesh = new THREE.Mesh(geometry, material);
  const baseHeight = entry.baseHeight ?? 0;
  mesh.position.set(entry.x, groundHeight + baseHeight + entry.height / 2, entry.z);
  if (entry.kind === 'ramp') {
    mesh.rotation.x = THREE.MathUtils.degToRad(entry.slopeDegrees);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `collision-p0-${entry.id}`;
  root.add(mesh);
  resources.geometries.add(geometry);
  resources.materials.add(material);
}

function addRock(root, entry, groundHeight, resources) {
  const geometry = new THREE.DodecahedronGeometry(entry.radius, 1);
  const material = createMaterial(COLORS.rock);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.y = entry.height / (entry.radius * 2);
  mesh.position.set(entry.x, groundHeight + entry.height / 2, entry.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `collision-p0-${entry.id}`;
  root.add(mesh);
  resources.geometries.add(geometry);
  resources.materials.add(material);
}

function addTree(root, entry, groundHeight, resources) {
  const trunkGeometry = new THREE.CylinderGeometry(entry.radius, entry.radius * 1.2, entry.height, 10);
  const trunkMaterial = createMaterial('#76543c');
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.set(entry.x, groundHeight + entry.height / 2, entry.z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.name = `collision-p0-${entry.id}-trunk`;

  const crownGeometry = new THREE.IcosahedronGeometry(entry.height * 0.38, 1);
  const crownMaterial = createMaterial(COLORS.tree);
  const crown = new THREE.Mesh(crownGeometry, crownMaterial);
  crown.position.set(entry.x, groundHeight + entry.height * 0.9, entry.z);
  crown.castShadow = true;
  crown.name = `collision-p0-${entry.id}-crown`;

  root.add(trunk, crown);
  resources.geometries.add(trunkGeometry);
  resources.geometries.add(crownGeometry);
  resources.materials.add(trunkMaterial);
  resources.materials.add(crownMaterial);
}

export function createCollisionP0QaScene({ terrainView, playerConfig, collisionConfig }) {
  if (!terrainView?.scene || !terrainView?.floatingOrigin) {
    throw new Error('Collision P0 QA scene requires an initialized terrain view.');
  }
  const stepHeight = playerConfig?.stepHeight;
  if (!(stepHeight > 0)) {
    throw new Error('Collision P0 QA scene requires a positive player.stepHeight.');
  }
  const descriptor = createCollisionP0QaFixture({
    stepHeight,
    maxSlopeDegrees: collisionConfig.player.maxSlopeDegrees,
    chunkWorldSize: terrainView.chunkWorldSize,
  });
  const root = new THREE.Group();
  root.name = 'collision-p0-qa-fixture';
  const resources = { geometries: new Set(), materials: new Set() };

  for (const entry of descriptor.entries) {
    const groundHeight = terrainView.getCanonicalHeight(entry.x, entry.z);
    if (entry.kind === 'tree') addTree(root, entry, groundHeight, resources);
    else if (entry.kind === 'rock') addRock(root, entry, groundHeight, resources);
    else addBox(root, entry, groundHeight, resources);
  }

  const positionRoot = () => {
    const origin = terrainView.floatingOrigin.getState();
    root.position.set(-origin.x, 0, -origin.z);
  };
  positionRoot();
  const unsubscribe = terrainView.floatingOrigin.subscribe(positionRoot);
  terrainView.scene.add(root);

  return Object.freeze({
    descriptor,
    root,
    dispose() {
      unsubscribe();
      terrainView.scene.remove(root);
      for (const geometry of resources.geometries) geometry.dispose();
      for (const material of resources.materials) material.dispose();
      root.clear();
    },
  });
}
