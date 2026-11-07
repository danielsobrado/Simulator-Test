import { drainJob } from '../world/settlements/SettlementArrayJobs.js';
import { townBoundsJob } from './TownBoundsJob.js';
import { writeTownInstanceRows } from './TownInstancePublication.js';
import * as THREE from 'three/webgpu';
import { markAttributeSubrangeUpdated } from '../stylized/attributeUpload.js';

import { TOWN_LOD_DEFAULTS, TOWN_LOD_FAR, TOWN_LOD_NEAR, TOWN_LOD_SPLIT } from './TownLod.js';
import { PlanGrid } from '../world/settlements/SettlementGeometry.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const scratchMatrix = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchPosition = new THREE.Vector3();

/** Matrix for a kit placement: position plus a yaw about +Y (shared scratch). */
export function composePlacement(x, y, z, yaw) {
  scratchPosition.set(x, y, z);
  scratchQuaternion.setFromAxisAngle(UP, yaw);
  return scratchMatrix.compose(scratchPosition, scratchQuaternion, ONE);
}

/**
 * A building seed in [0, 1) (plus 1 on a piece whose foot stands on the ground)
 * spread to three channels in [0.9, 1] for
 * instanceColor: TownKitMaterial reads them as render, timber and roof choices,
 * and three multiplies them in as a gentle per-building tone.
 */
export function seedColour(seed, out = [0, 0, 0]) {
  const grounded = seed >= 1;
  const roll = grounded ? seed - 1 : seed;
  const channel = (k, o) => 0.9 + 0.1 * ((roll * k + o) % 1);
  // Eight render tones (TownKitMaterial wants four), and half a step records a
  // ground-floor piece: a 0.6% tint nobody sees, and no eighth vertex buffer.
  out[0] = 0.9 + Math.floor(roll * 8) / 80 + (grounded ? 1 / 160 : 0);
  out[1] = channel(7.137, 0.31);
  out[2] = channel(13.71, 0.77);
  return out;
}

/**
 * Which placements a mesh set draws, each kept in its slot while it stays: one that
 * leaves hands its slot to the set's last placement, one that arrives takes the next.
 * A split town re-picked every few metres so changes, and uploads, only a few slots
 * instead of shifting the whole buffer behind the first change.
 */
class SlotSet {
  constructor(count) {
    this.slotOf = new Int32Array(count).fill(-1);
    this.placementAt = new Uint32Array(count);
    this.count = 0;
  }

  set(i, wanted, dirty) {
    const { slotOf, placementAt } = this;
    if (!wanted && slotOf[i] >= 0) {
      const slot = slotOf[i];
      const last = --this.count;
      const moved = placementAt[last];
      placementAt[slot] = moved;
      slotOf[moved] = slot;
      slotOf[i] = -1;
      if (slot !== last) dirty.push(slot);
    } else if (wanted && slotOf[i] < 0) {
      const slot = this.count++;
      placementAt[slot] = i;
      slotOf[i] = slot;
      dirty.push(slot);
    }
  }
}

/**
 * Every placement of one kit module in a town: its opaque geometry with the
 * town material and its window glass, at two levels of detail.
 *
 * `setLod` shows the near or far meshes. A module the far kit does not lighten
 * has no far level and stays near. Interior modules (`interior`) have only near
 * meshes and draw just the placements within a radius of the viewer
 * (`cull`), compacted to the front of their buffers — the same draw count as
 * before, only fewer instances; a far town hides them entirely. A big town draws
 * split (`split`): the near meshes hold the placements round the viewer and the far
 * meshes the rest, each compacted the same way.
 */
export class TownModuleInstances {
  /**
   * @param {object} options
   * @param {string} options.module kit module name
   * @param {Float32Array} options.values packed [x, y, z, yaw] placements
   * @param {Float32Array|null} options.seeds per-placement building seeds
   * @param {{opaque, glass}} options.near near-kit geometry
   * @param {{opaque, glass}|null} options.far far-kit geometry, or null
   * @param {boolean} options.interior draw only near the viewer
   * @param {number} [options.farReach] a split town's far meshes stop this far from the viewer
   * @param {(geometry, kind, count) => THREE.InstancedMesh} options.createMesh kind: 'kit' | 'glass'
   */
  constructor({ module, values, seeds, near, far, interior = false, farReach = Infinity, createMesh, deferred = false }) {
    this.values = values;
    this.farReach = farReach;
    this.count = values.length / 4;
    this.interior = interior;
    this.matrices = new Float32Array(this.count * 16);
    this.colours = new Float32Array(this.count * 3);
    this.spatial = new PlanGrid(32);
    this.nearMeshes = []; this.farMeshes = [];
    this.preparation = this.prepare({ module, seeds, near, far, interior, createMesh });
    if (!deferred) { drainJob(this.preparation); this.preparation = null; }
  }

  *prepare({ module, seeds, near, far, interior, createMesh }) {
    const values = this.values;
    const rgb = [0, 0, 0];
    for (let i = 0; i < this.count; i += 1) {
      this.spatial.insert(i, values[i * 4], values[i * 4 + 2], 0);
      composePlacement(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3])
        .toArray(this.matrices, i * 16);
      this.colours.set(seedColour(seeds ? seeds[i] : 0.5, rgb), i * 3);
      if (i % 64 === 63) yield;
    }
    const build = (geometry, level) => {
      const list = [];
      if (geometry.opaque) list.push(this.mesh(createMesh(geometry.opaque, 'kit', this.count), module, level, true));
      for (const glass of geometry.glass) list.push(this.mesh(createMesh(glass, 'glass', this.count), module, level, false));
      // The far kit starts past the sun's shadow range (TownLod.splitRadius), so
      // casting only drew the whole city again into every cascade.
      if (level === 'far') for (const mesh of list) mesh.castShadow = false;
      return list;
    };
    this.nearMeshes = build(near, 'near');
    this.farMeshes = far && !interior ? build(far, 'far') : [];
    this.visibleIndices = interior ? new Uint32Array(this.count) : null;
    // Interior culling: what the near meshes last held. Split drawing: stable slots.
    this.shown = new Map();
    this.nearSlots = null; this.farSlots = null;
    this.lod = TOWN_LOD_NEAR;
    for (const mesh of this.meshes) yield* townBoundsJob(mesh);
    this.setLod(TOWN_LOD_NEAR);
  }

  mesh(mesh, module, level, coloured) {
    mesh.name = `${module}:${level}`;
    mesh.instanceMatrix.array.set(this.matrices);
    mesh.instanceMatrix.needsUpdate = true;
    if (coloured) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.colours), 3);
    }
    return mesh;
  }

  get meshes() {
    return [...this.nearMeshes, ...this.farMeshes];
  }

  setLod(lod) {
    this.lod = lod;
    if (lod === TOWN_LOD_SPLIT && this.farMeshes.length > 0) {
      for (const mesh of this.meshes) mesh.visible = mesh.count > 0;
      return;
    }
    const far = lod === TOWN_LOD_FAR && this.farMeshes.length > 0;
    for (const mesh of this.nearMeshes) mesh.visible = !far && !(this.interior && lod === TOWN_LOD_FAR) && mesh.count > 0;
    for (const mesh of this.farMeshes) mesh.visible = far;
  }

  /**
   * Copy the placements `indices[0..count)` to the front of every mesh in `meshes`,
   * copying only changed slots and uploading their separate contiguous runs.
   */
  writeSubset(meshes, indices, count) {
    const previous = this.shown.get(meshes) ?? { indices: new Uint32Array(this.count).fill(0xffffffff), count: -1 };
    const dirty = [];
    for (let k = 0; k < count; k++) {
      if (previous.indices[k] === indices[k] && k < previous.count) continue;
      dirty.push(k);
    }
    writeTownInstanceRows(meshes, this.matrices, this.colours, indices, count, dirty);
    for (const slot of dirty) previous.indices[slot] = indices[slot];
    previous.count = count;
    this.shown.set(meshes, previous);
  }

  /**
   * Big towns: near meshes draw the placements within `radius` of town-local (x, z),
   * far meshes the rest. A module without a far level, or an interior one, keeps its
   * own behaviour (all near; interiors use `cull`).
   */
  split(x, z, radius) {
    drainJob(this.splitJob(x, z, radius));
  }

  *splitJob(x, z, radius) {
    if (this.interior || this.farMeshes.length === 0) return;
    const initial = !this.nearSlots;
    this.nearSlots ??= new SlotSet(this.count);
    this.farSlots ??= new SlotSet(this.count);
    const radiusSq = radius * radius;
    // A building already drawn near keeps the near kit a band further out, or one on
    // the ring swaps kits (detail to blocks and back) every time the viewer re-picks.
    const keep = radius + TOWN_LOD_DEFAULTS.hysteresis;
    const keepSq = keep * keep;
    const values = this.values;
    const next = new Set();
    let units = 0;
    for (const i of this.spatial.near(x, z, keep)) {
      const dx = values[i * 4] - x;
      const dz = values[i * 4 + 2] - z;
      if (dx * dx + dz * dz <= (this.nearSlots.slotOf[i] >= 0 ? keepSq : radiusSq)) next.add(i);
      PerfCounters.inc('townLodPlacementsEvaluated');
      if (++units % 64 === 0) yield;
    }
    // Past farReach a prop is a few pixels: it leaves the far meshes as well.
    let reached = null;
    if (Number.isFinite(this.farReach)) {
      reached = new Set();
      const stay = this.farReach + TOWN_LOD_DEFAULTS.hysteresis;
      for (const i of this.spatial.near(x, z, stay)) {
        const dx = values[i * 4] - x;
        const dz = values[i * 4 + 2] - z;
        const limit = this.farSlots.slotOf[i] >= 0 ? stay : this.farReach;
        if (dx * dx + dz * dz <= limit * limit) reached.add(i);
        if (++units % 64 === 0) yield;
      }
    }
    const wantsFar = (i) => !next.has(i) && (!reached || reached.has(i));
    const nearDirty = [], farDirty = [];
    if (initial) {
      for (let i = 0; i < this.count; i++) {
        this.nearSlots.set(i, next.has(i), nearDirty);
        this.farSlots.set(i, wantsFar(i), farDirty);
        if (++units % 64 === 0) yield;
      }
    } else {
      const drawn = (slots) => [...slots.placementAt.subarray(0, slots.count)];
      const toNear = [...next].filter(i => this.nearSlots.slotOf[i] < 0).sort((a, b) => a - b);
      const leftNear = drawn(this.nearSlots).filter(i => !next.has(i)).sort((a, b) => a - b);
      const leftFar = reached ? drawn(this.farSlots).filter(i => !wantsFar(i)).sort((a, b) => a - b) : toNear;
      const toFar = reached ? [...reached].filter(i => wantsFar(i) && this.farSlots.slotOf[i] < 0).sort((a, b) => a - b) : leftNear;
      for (const [slots, dirty, remove, add] of [[this.nearSlots, nearDirty, leftNear, toNear], [this.farSlots, farDirty, leftFar, toFar]]) {
        for (const i of remove) { slots.set(i, false, dirty); if (++units % 64 === 0) yield; }
        for (const i of add) { slots.set(i, true, dirty); if (++units % 64 === 0) yield; }
      }
    }
    // The initial split is prepared before the town enters the scene. Later
    // commits copy only changed local slots, keeping both tiers coherent.
    yield;
    this.writeSlots(this.nearMeshes, this.nearSlots, nearDirty);
    this.writeSlots(this.farMeshes, this.farSlots, farDirty);
    this.setLod(TOWN_LOD_SPLIT);
  }

  /** Turn one placement in place (a swinging door), in whichever meshes draw it. */
  setYaw(i, yaw) {
    const v = this.values;
    composePlacement(v[i * 4], v[i * 4 + 1], v[i * 4 + 2], yaw).toArray(this.matrices, i * 16);
    for (const [meshes, slots] of [[this.nearMeshes, this.nearSlots], [this.farMeshes, this.farSlots]]) {
      const slot = slots ? slots.slotOf[i] : i;
      if (slot < 0) continue;
      for (const mesh of meshes) {
        mesh.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), slot * 16);
        markAttributeSubrangeUpdated(mesh.instanceMatrix, slot, slot);
      }
    }
  }

  /** Write the changed slots of a slot set into its meshes, uploading each run of them. */
  writeSlots(meshes, slots, dirty) {
    const live = [...new Set(dirty.filter(slot => slot < slots.count))].sort((a, b) => a - b);
    writeTownInstanceRows(meshes, this.matrices, this.colours, slots.placementAt, slots.count, live);
  }

  /** Interior modules: draw only placements within `radius` of town-local (x, z). */
  cull(x, z, radius) {
    drainJob(this.cullJob(x, z, radius));
  }

  *cullJob(x, z, radius) {
    if (!this.interior) return;
    let count = 0, units = 0;
    for (const i of this.spatial.near(x, z, radius)) {
      const dx = this.values[i * 4] - x, dz = this.values[i * 4 + 2] - z;
      if (dx * dx + dz * dz <= radius * radius) this.visibleIndices[count++] = i;
      PerfCounters.inc('townLodPlacementsEvaluated');
      if (++units % 64 === 0) yield;
    }
    this.visibleIndices.subarray(0, count).sort();
    yield;
    this.writeSubset(this.nearMeshes, this.visibleIndices, count);
    this.setLod(this.lod);
  }
}
