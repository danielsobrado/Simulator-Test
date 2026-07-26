import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import {
  createFlockMembers,
  createOrbitFlightPlan,
  sampleOrbitFlight,
  wildlifeDelaySeconds,
  wildlifeRange,
} from './ambientWildlifeMath.js';

const SCRATCH = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  matrix: new THREE.Matrix4(),
};

function createBirdSilhouetteGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.05, 0, -1.2, 0.42, 0, -0.12, -0.12, 0,
    0, 0.05, 0, 0.12, -0.12, 0, 1.2, 0.42, 0,
    -0.1, 0.08, 0, 0.1, 0.08, 0, 0, -0.58, 0,
  ], 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function canonicalCameraPosition(terrainView, camera) {
  const origin = terrainView.floatingOrigin.getState();
  return {
    x: camera.position.x + origin.x,
    z: camera.position.z + origin.z,
  };
}

class DistantBirdFlockTier {
  constructor({ terrainView, config, seed, root }) {
    this.terrainView = terrainView;
    this.config = config;
    this.seed = seed;
    this.eventIndex = 0;
    this.nextSpawnAt = null;
    this.active = null;
    this.geometry = createBirdSilhouetteGeometry();
    this.material = new THREE.MeshBasicMaterial({
      color: config.color,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, config.maxBirds);
    this.mesh.name = 'stylized-distant-bird-flocks';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(this.mesh);
  }

  schedule(timestamp, initial = false) {
    this.nextSpawnAt = timestamp + wildlifeDelaySeconds(
      this.config,
      this.seed,
      this.eventIndex,
      initial,
    ) * 1000;
  }

  spawn(timestamp, camera) {
    const center = canonicalCameraPosition(this.terrainView, camera);
    const baseY = this.terrainView.getCanonicalHeight(center.x, center.z);
    const count = Math.min(
      this.config.maxBirds,
      Math.round(wildlifeRange(
        this.seed,
        this.eventIndex,
        10,
        this.config.flockSizeMin,
        this.config.flockSizeMax,
      )),
    );
    const plan = createOrbitFlightPlan({
      seed: this.seed,
      eventIndex: this.eventIndex,
      centerX: center.x,
      centerZ: center.z,
      baseY,
      config: this.config,
    });
    this.active = {
      startedAt: timestamp,
      plan,
      members: createFlockMembers({
        seed: this.seed,
        eventIndex: this.eventIndex,
        count,
      }),
    };
    this.eventIndex += 1;
    this.nextSpawnAt = null;
    PerfCounters.inc('distantBirdFlockSpawns');
  }

  update(timestamp, camera) {
    if (this.nextSpawnAt === null && !this.active) this.schedule(timestamp, true);
    if (!this.active && timestamp >= this.nextSpawnAt) this.spawn(timestamp, camera);
    if (!this.active) {
      this.mesh.count = 0;
      this.mesh.visible = false;
      PerfCounters.set('distantBirdInstances', 0);
      return;
    }

    const progress = (timestamp - this.active.startedAt)
      / (this.active.plan.durationSeconds * 1000);
    if (progress >= 1) {
      this.active = null;
      this.mesh.count = 0;
      this.mesh.visible = false;
      this.schedule(timestamp);
      PerfCounters.set('distantBirdInstances', 0);
      return;
    }

    const sample = sampleOrbitFlight(this.active.plan, progress);
    const origin = this.terrainView.floatingOrigin.getState();
    const cameraQuaternion = camera.getWorldQuaternion(SCRATCH.quaternion);
    this.active.members.forEach((member, index) => {
      const flap = 0.84 + Math.sin(timestamp * 0.006 + member.phase) * 0.16;
      SCRATCH.position.set(
        sample.x + sample.tangentX * member.along - sample.tangentZ * member.side - origin.x,
        sample.y + member.height,
        sample.z + sample.tangentZ * member.along + sample.tangentX * member.side - origin.z,
      );
      SCRATCH.scale.set(
        this.config.size * member.scale,
        this.config.size * member.scale * flap,
        this.config.size * member.scale,
      );
      SCRATCH.matrix.compose(
        SCRATCH.position,
        cameraQuaternion,
        SCRATCH.scale,
      );
      this.mesh.setMatrixAt(index, SCRATCH.matrix);
    });
    this.mesh.count = this.active.members.length;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    PerfCounters.set('distantBirdInstances', this.mesh.count);
  }

  dispose(root) {
    root.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class StylizedWildlifeView {
  constructor({
    terrainView,
    config,
    baseUrl = '/',
    loader = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.root = new THREE.Group();
    this.root.name = 'stylized-wildlife';
    terrainView.scene.add(this.root);
    this.disposed = false;
    const seed = terrainView.worldStore.generatorConfig?.seed
      ?? terrainView.worldStore.seed
      ?? 918273;
    this.distantTier = config.distant.enabled
      ? new DistantBirdFlockTier({
        terrainView,
        config: config.distant,
        seed: seed ^ 0x51a7f10c,
        root: this.root,
      })
      : null;
    this.authoredTier = null;
    this.ready = config.authored.enabled
      ? import('./StylizedAuthoredBirdTier.js').then(async ({ StylizedAuthoredBirdTier }) => {
        if (this.disposed) return;
        this.authoredTier = new StylizedAuthoredBirdTier({
          terrainView,
          config: config.authored,
          definitions: config.variants,
          seed: seed ^ 0x2c0f4ea1,
          root: this.root,
          baseUrl,
          renderer: terrainView.renderer,
          loader,
        });
        await this.authoredTier.ready;
        if (this.disposed) {
          this.authoredTier.dispose();
          this.authoredTier = null;
        }
      })
      : Promise.resolve();
  }

  update(timestamp, camera) {
    this.distantTier?.update(timestamp, camera);
    this.authoredTier?.update(timestamp, camera);
  }

  dispose() {
    this.disposed = true;
    this.distantTier?.dispose(this.root);
    this.authoredTier?.dispose();
    this.terrainView.scene.remove(this.root);
  }
}
