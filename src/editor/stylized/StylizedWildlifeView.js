import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import {
  createFlockMembers,
  createOrbitFlightPlan,
  sampleOrbitFlight,
  sampleWingFlap,
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
  const flatPose = [
    0, 0.05, 0, -1.2, 0.05, 0, -0.12, -0.12, 0,
    0, 0.05, 0, 0.12, -0.12, 0, 1.2, 0.05, 0,
    -0.1, 0.08, 0, 0.1, 0.08, 0, 0, -0.58, 0,
  ];
  const upstroke = new Array(flatPose.length).fill(0);
  const downstroke = new Array(flatPose.length).fill(0);
  upstroke[4] = 0.48;
  upstroke[16] = 0.48;
  downstroke[4] = -0.34;
  downstroke[16] = -0.34;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(flatPose, 3));
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute(upstroke, 3),
    new THREE.Float32BufferAttribute(downstroke, 3),
  ];
  geometry.morphTargetsRelative = true;
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

export class DistantBirdFlockTier {
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
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wingMorph = { morphTargetInfluences: [0, 0] };
    // InstancedMesh lazily sizes morphTexture from the current draw count.
    // Prime it while count still equals the full capacity; the first flock is
    // otherwise written while count is zero and creates a zero-length texture.
    this.mesh.setMorphAt(0, this.wingMorph);
    this.mesh.morphTexture.needsUpdate = true;
    this.mesh.count = 0;
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
    const elapsedSeconds = (timestamp - this.active.startedAt) / 1000;
    this.active.members.forEach((member, index) => {
      const wingPose = sampleWingFlap(member, elapsedSeconds);
      SCRATCH.position.set(
        sample.x + sample.tangentX * member.along - sample.tangentZ * member.side - origin.x,
        sample.y + member.height,
        sample.z + sample.tangentZ * member.along + sample.tangentX * member.side - origin.z,
      );
      SCRATCH.scale.set(
        this.config.size * member.scale,
        this.config.size * member.scale,
        this.config.size * member.scale,
      );
      SCRATCH.matrix.compose(
        SCRATCH.position,
        cameraQuaternion,
        SCRATCH.scale,
      );
      this.mesh.setMatrixAt(index, SCRATCH.matrix);
      this.wingMorph.morphTargetInfluences[0] = Math.max(0, wingPose);
      this.wingMorph.morphTargetInfluences[1] = Math.max(0, -wingPose);
      this.mesh.setMorphAt(index, this.wingMorph);
    });
    this.mesh.count = this.active.members.length;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.morphTexture.needsUpdate = true;
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
