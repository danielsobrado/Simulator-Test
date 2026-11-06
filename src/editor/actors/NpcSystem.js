import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { calibrateLocomotionClip } from '../character/glb/locomotionCalibration.js';
import { createStandingClip } from '../character/glb/standingPose.js';
import { skinnedBounds } from '../character/glb/GlbCharacterView.js';
import { createSeededRandom } from '../wildlife/math.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

const ARRIVE_DISTANCE = 1.5, CLIP_FADE = 0.35, TURN_RATE = 6;
const LOD_DISTANCES = [0, 14, 32, 70], LOD_HYSTERESIS = 0.9;

/** Gods' End animation/wander/LOD behavior, owned by a bounded resident manifest. */
export class NpcSystem {
  constructor({ scene, terrainView, assets, onInstalled, canStand = () => true }) {
    Object.assign(this, { scene, terrainView, assets, onInstalled, canStand });
    this.entries = new Map(); this.pending = new Map(); this.desired = new Map();
    this.failed = new Set(); this.disposed = false;
    this.root = new THREE.Group(); this.root.name = 'settlement-residents'; scene.add(this.root);
  }
  setManifest(manifest) {
    this.desired = new Map(manifest.map(record => [record.id, record]));
    for (const [id, entry] of this.entries) if (!this.desired.has(id)) this.remove(id, entry);
    for (const record of manifest) {
      if (this.entries.has(record.id) || this.pending.has(record.id) || this.failed.has(record.id)) continue;
      // At most two model preparations join the queue in a frame.
      if (this.pending.size >= 2) break;
      const task = this.assets.load(record.kind).then(template => {
        if (!this.disposed && this.desired.has(record.id)) this.spawn(this.desired.get(record.id), template);
      }).catch(error => {
        if (!this.disposed) { this.failed.add(record.id); console.warn('Resident unavailable.', error); }
      }).finally(() => this.pending.delete(record.id));
      this.pending.set(record.id, task);
    }
  }
  spawn(record, { gltf, definition, lods }) {
    const model = clone(gltf.scene), meshes = [];
    model.traverse(object => {
      if (!object.isMesh) return;
      const stages = lods.get(object.geometry);
      if (stages) meshes.push({ mesh: object, stages });
      object.castShadow = true; object.receiveShadow = true; object.frustumCulled = true;
      object.computeBoundingSphere?.();
      if (object.boundingSphere) { object.boundingSphere = object.boundingSphere.clone(); object.boundingSphere.radius *= 1.4; }
    });
    // Measured as the hero is (skinnedBounds): a fresh clone's matrices are stale, and a
    // centimetre rig under a 0.01 armature (the radiant paladin) measured 100x off and
    // walked a capital's square as a giant.
    const bounds = skinnedBounds(model);
    model.scale.setScalar(definition.targetHeight / Math.max(0.001, bounds.max.y - bounds.min.y));
    model.position.y -= skinnedBounds(model).min.y;
    const root = new THREE.Group(); root.name = record.id; root.add(model); this.root.add(root);
    const mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations.map(clip => clip.name === definition.clips.walk || clip.name === definition.clips.run
      ? calibrateLocomotionClip(clip, definition.rootMotion) : clip);
    const walk = clips.find(clip => clip.name === definition.clips.walk);
    const idle = definition.clips.idle ? clips.find(clip => clip.name === definition.clips.idle) : walk && createStandingClip(model, walk);
    const actions = Object.fromEntries(clips.map(clip => [clip.name, mixer.clipAction(clip)]));
    if (idle) actions.idle = mixer.clipAction(idle);
    const entry = { record, model, root, mixer, actions, meshes, lodLevel: 0, current: null,
      x: record.x, z: record.z, random: createSeededRandom(record.seed), wait: 1,
      definition, target: { x: record.x, z: record.z }, speed: definition.targetHeight * 0.75 };
    this.entries.set(record.id, entry); this.fade(entry, 'idle'); this.place(entry);
    this.onInstalled?.(root);
  }
  fade(entry, name) {
    const next = entry.actions[name];
    if (!next || entry.current === next) return;
    next.reset().fadeIn(CLIP_FADE).play(); entry.current?.fadeOut(CLIP_FADE); entry.current = next;
  }
  pickTarget(entry) {
    const { record, random } = entry;
    for (let i = 0; i < 16; i++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * record.wander;
      const target = { x: record.x + Math.cos(angle) * radius, z: record.z + Math.sin(angle) * radius };
      let dry = true;
      for (let step = 0; step <= 6; step++) {
        const t = step / 6, x = entry.x + (target.x - entry.x) * t, z = entry.z + (target.z - entry.z) * t;
        const height = this.terrainView.getCanonicalHeight(x, z);
        if (!Number.isFinite(height) || !this.canStand(x, z)) { dry = false; break; }
        const water = this.terrainView.getCanonicalWater?.(x, z);
        if (water?.coverage > 0.5 && water.surfaceHeight > height + 0.2) { dry = false; break; }
      }
      if (dry) return target;
    }
    return { x: entry.x, z: entry.z };
  }
  place(entry) {
    const position = this.terrainView.floatingOrigin.toRender(entry.x, entry.z);
    entry.root.position.set(position.x, this.terrainView.getCanonicalHeight(entry.x, entry.z), position.z);
  }
  update(dt, camera) {
    const step = Math.min(Math.max(dt, 0), 0.1);
    for (const entry of this.entries.values()) {
      const dx = entry.target.x - entry.x, dz = entry.target.z - entry.z, distance = Math.hypot(dx, dz);
      if (distance <= ARRIVE_DISTANCE) {
        entry.wait -= step; this.fade(entry, 'idle');
        if (entry.wait <= 0) { entry.target = this.pickTarget(entry); entry.wait = 1 + entry.random() * 3; }
      } else {
        this.fade(entry, entry.definition.clips.walk);
        const advance = Math.min(distance, entry.speed * step);
        entry.x += dx / distance * advance; entry.z += dz / distance * advance;
        const heading = Math.atan2(dx, dz), turn = Math.atan2(Math.sin(heading - entry.root.rotation.y), Math.cos(heading - entry.root.rotation.y));
        entry.root.rotation.y += turn * Math.min(1, TURN_RATE * step);
      }
      this.place(entry);
      const range = camera.position.distanceTo(entry.root.position);
      let level = 0;
      while (level + 1 < LOD_DISTANCES.length && range >= LOD_DISTANCES[level + 1]) level++;
      if (level < entry.lodLevel && range >= LOD_DISTANCES[entry.lodLevel] * LOD_HYSTERESIS) level = entry.lodLevel;
      if (entry.lodLevel !== level) { entry.lodLevel = level; for (const { mesh, stages } of entry.meshes) mesh.geometry = stages[level]; }
      entry.mixer.update(step);
    }
    PerfCounters.set('residentNpcCount', this.entries.size);
  }
  shiftWorld() { for (const entry of this.entries.values()) this.place(entry); }
  clear() { for (const [id, entry] of this.entries) this.remove(id, entry); this.desired.clear(); this.failed.clear(); }
  remove(id, entry) {
    entry.mixer.stopAllAction(); entry.mixer.uncacheRoot(entry.model);
    entry.model.traverse(object => { if (object.isSkinnedMesh) object.skeleton.dispose(); });
    entry.root.removeFromParent(); this.entries.delete(id);
  }
  dispose() { this.disposed = true; this.clear(); this.root.removeFromParent(); this.assets.dispose(); }
}
