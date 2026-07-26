import * as THREE from 'three/webgpu';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { disposeScene, normalizeBaseUrl, resolveAssetUrl } from '../assets/assetUrl.js';
import { cellCenterToWorld, worldToCell } from '../world/WorldCoordinates.js';
import { createStylizedSceneLoader } from './StylizedSceneAssetCache.js';
import {
  chooseWeightedWildlife,
  createOrbitFlightPlan,
  sampleOrbitFlight,
  wildlifeDelaySeconds,
  wildlifeRandom01,
} from './ambientWildlifeMath.js';

const UP = new THREE.Vector3(0, 1, 0);
const POSITION = new THREE.Vector3();
const TARGET = new THREE.Vector3();
const LOOK_AT = new THREE.Matrix4();

function canonicalCameraPosition(terrainView, camera) {
  const origin = terrainView.floatingOrigin.getState();
  return {
    x: camera.position.x + origin.x,
    z: camera.position.z + origin.z,
  };
}

export class StylizedAuthoredBirdTier {
  constructor({
    terrainView,
    config,
    definitions,
    seed,
    root,
    baseUrl,
    renderer,
    loader = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.definitions = definitions;
    this.seed = seed;
    this.root = root;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    const configuredLoader = loader
      ? { loader, ktx2Loader: null }
      : createStylizedSceneLoader({ renderer, baseUrl: this.baseUrl });
    this.loader = configuredLoader.loader;
    this.ownedKtx2Loader = configuredLoader.ktx2Loader;
    this.species = [];
    this.active = [];
    this.eventIndex = 0;
    this.nextSpawnAt = null;
    this.lastTimestamp = null;
    this.ready = this.load();
  }

  async load() {
    const loaded = await Promise.all(this.definitions.map(async (definition) => {
      const gltf = await this.loader.loadAsync(resolveAssetUrl(this.baseUrl, definition.scene));
      const clip = gltf.animations.find((animation) => animation.name === definition.clip);
      if (!clip) {
        disposeScene(gltf.scene);
        throw new Error(`${definition.scene} is missing animation "${definition.clip}".`);
      }
      const slots = [];
      for (let index = 0; index < definition.maxActive; index += 1) {
        const flightRoot = new THREE.Group();
        const model = cloneSkeleton(gltf.scene);
        model.scale.setScalar(definition.scale);
        model.rotation.y = THREE.MathUtils.degToRad(definition.headingOffsetDegrees);
        model.traverse((node) => {
          if (!node.isMesh) return;
          node.castShadow = false;
          node.receiveShadow = false;
        });
        flightRoot.add(model);
        flightRoot.visible = false;
        this.root.add(flightRoot);
        const mixer = new THREE.AnimationMixer(model);
        slots.push({
          flightRoot,
          model,
          mixer,
          action: mixer.clipAction(clip),
          active: false,
        });
      }
      return {
        definition,
        sourceScene: gltf.scene,
        slots,
      };
    }));
    this.species = loaded;
  }

  findHabitatCenter(definition, camera, eventIndex) {
    const canonical = canonicalCameraPosition(this.terrainView, camera);
    const originCell = worldToCell(
      canonical.x,
      canonical.z,
      this.terrainView.worldStore.tileSize,
    );
    const eligible = new Set(definition.tileIds);
    const startAngle = wildlifeRandom01(this.seed, eventIndex, 30) * Math.PI * 2;

    for (let radius = 0; radius <= this.config.habitatSearchCells; radius += 1) {
      const samples = Math.max(1, radius * 8);
      for (let sample = 0; sample < samples; sample += 1) {
        const angle = startAngle + sample / samples * Math.PI * 2;
        const cellX = originCell.x + Math.round(Math.cos(angle) * radius);
        const cellZ = originCell.z + Math.round(Math.sin(angle) * radius);
        if (!eligible.has(this.terrainView.tileMap.get(cellX, cellZ))) continue;
        return cellCenterToWorld(cellX, cellZ, this.terrainView.worldStore.tileSize);
      }
    }
    return null;
  }

  schedule(timestamp, initial = false) {
    this.nextSpawnAt = timestamp + wildlifeDelaySeconds(
      this.config,
      this.seed,
      this.eventIndex,
      initial,
    ) * 1000;
  }

  spawn(timestamp, camera, preferredId = null) {
    if (this.active.length >= this.config.maxActive || this.species.length === 0) return false;
    const available = this.species.filter((record) => (
      record.slots.some((slot) => !slot.active)
      && (!preferredId || record.definition.id === preferredId)
    ));
    if (available.length === 0) return false;
    const first = chooseWeightedWildlife(
      available.map((record) => record.definition),
      wildlifeRandom01(this.seed, this.eventIndex, 31),
    );
    const ordered = [
      available.find((record) => record.definition === first),
      ...available.filter((record) => record.definition !== first),
    ].filter(Boolean);
    let selected = null;
    let center = null;
    for (const candidate of ordered) {
      center = this.findHabitatCenter(candidate.definition, camera, this.eventIndex);
      if (center) {
        selected = candidate;
        break;
      }
    }
    if (!selected || !center) return false;

    const slot = selected.slots.find((candidate) => !candidate.active);
    const baseY = this.terrainView.getCanonicalHeight(center.x, center.z);
    const plan = createOrbitFlightPlan({
      seed: this.seed,
      eventIndex: this.eventIndex,
      centerX: center.x,
      centerZ: center.z,
      baseY,
      config: this.config,
    });
    slot.active = true;
    slot.flightRoot.visible = true;
    slot.action.reset();
    slot.action.timeScale = selected.definition.animationTimeScale;
    slot.action.play();
    slot.action.time = wildlifeRandom01(this.seed, this.eventIndex, 32)
      * slot.action.getClip().duration;
    this.active.push({
      species: selected,
      slot,
      plan,
      startedAt: timestamp,
    });
    this.eventIndex += 1;
    this.schedule(timestamp);
    PerfCounters.inc('authoredBirdSpawns');
    PerfCounters.inc(`authoredBirdSpawns.${selected.definition.id}`);
    return true;
  }

  update(timestamp, camera) {
    const deltaSeconds = this.lastTimestamp === null
      ? 0
      : Math.min(0.1, Math.max(0, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    if (this.nextSpawnAt === null && this.active.length === 0) this.schedule(timestamp, true);
    if (this.nextSpawnAt !== null
        && timestamp >= this.nextSpawnAt
        && this.active.length < this.config.maxActive) {
      if (!this.spawn(timestamp, camera)) {
        this.eventIndex += 1;
        this.schedule(timestamp);
      }
    }

    const origin = this.terrainView.floatingOrigin.getState();
    this.active = this.active.filter((flight) => {
      const progress = (timestamp - flight.startedAt) / (flight.plan.durationSeconds * 1000);
      if (progress >= 1) {
        flight.slot.action.stop();
        flight.slot.flightRoot.visible = false;
        flight.slot.active = false;
        return false;
      }
      const sample = sampleOrbitFlight(flight.plan, progress);
      const next = sampleOrbitFlight(flight.plan, Math.min(1, progress + 0.002));
      flight.slot.flightRoot.position.set(
        sample.x - origin.x,
        sample.y,
        sample.z - origin.z,
      );
      LOOK_AT.lookAt(
        POSITION.set(sample.x, sample.y, sample.z),
        TARGET.set(next.x, next.y, next.z),
        UP,
      );
      flight.slot.flightRoot.quaternion.setFromRotationMatrix(LOOK_AT);
      flight.slot.mixer.update(deltaSeconds);
      return true;
    });
    if (this.active.length === 0 && this.nextSpawnAt === null) this.schedule(timestamp);
    PerfCounters.set('authoredBirdInstances', this.active.length);
  }

  dispose() {
    for (const record of this.species) {
      for (const slot of record.slots) {
        slot.action.stop();
        slot.mixer.stopAllAction();
        slot.mixer.uncacheRoot(slot.model);
        this.root.remove(slot.flightRoot);
      }
      disposeScene(record.sourceScene);
    }
    this.species.length = 0;
    this.active.length = 0;
    this.ownedKtx2Loader?.dispose();
    this.ownedKtx2Loader = null;
  }
}
