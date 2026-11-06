import * as THREE from 'three/webgpu';
import { markAttributeSubrangeUpdated } from '../attributeUpload.js';
import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { MeadowPageBounds } from './MeadowPageBounds.js';
import { meadowPageUpdatePlan } from './MeadowPageUpdatePlan.js';

// Sparse bands can share more tiles without enlarging a dense page. This keeps
// CPU draw submission bounded while the stem ceiling still bounds allocation.
export const MEADOW_TILES_PER_PAGE = 16;
// Dense bands need smaller pages: otherwise first use of a new page allocates
// and uploads several megabytes in one render, even for a single live tile.
const PAGE_STEMS = 65536;
export function meadowPageTileCapacity(stride) {
  return Math.max(1, Math.min(MEADOW_TILES_PER_PAGE, Math.floor(PAGE_STEMS / stride)));
}
const INSTANCE_ATTRIBUTES = Object.freeze([
  ['instancePosition', 'position', 4],
  ['instanceRotation', 'rotation', 2],
  ['instanceData', 'data', 4],
]);

/**
 * A persistent small GPU page containing only completed, populated stems.
 * Repacking stays within each affected page. Unchanged stems remain resident,
 * a tile may span several runs, and unused capacity never enters the draw.
 * Stem ranks, local positions,
 * wind data and publication fades are copied together without resampling.
 */
export class MeadowBandBatch {
  constructor({ scene, template, material, name, renderOrder = 0, boundsPadding = null, getDrawPreparation = () => null }) {
    this.getDrawPreparation = getDrawPreparation;
    this.stride = Math.max(1, template.instanceCount);
    this.slotCapacity = meadowPageTileCapacity(this.stride);
    this.slots = new Map();
    this.present = new Set();
    this.order = [];
    this.geometry = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'uv', 'bladeSide']) {
      this.geometry.setAttribute(name, template.getAttribute(name));
    }
    this.geometry.index = template.index;
    this.geometry.instanceCount = 0;
    const capacity = this.slotCapacity * this.stride;
    this.initialUploadBytes = capacity * 14 * 4;
    for (const [name, , width] of [...INSTANCE_ATTRIBUTES, ['instanceTile', null, 4]]) {
      this.geometry.setAttribute(name,
        new THREE.InstancedBufferAttribute(new Float32Array(capacity * width), width));
    }
    PerfCounters.inc('meadowBufferAllocationBytes', capacity * 14 * 4);
    this.bounds = boundsPadding === null ? null
      : new MeadowPageBounds(this.geometry, template.userData.meadow.tileSize, boundsPadding);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = name;
    this.mesh.renderOrder = renderOrder;
    // Empty pages have no spatial bounds yet. Bootstrap still compiles their
    // material through a temporary draw before the first tile is published.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  markRange(name, start, count) {
    const bytes = markAttributeSubrangeUpdated(
      this.geometry.getAttribute(name), start, start + count - 1,
    );
    PerfCounters.inc('meadowAttributeBytesUploaded', bytes);
  }

  setTemplate(template) {
    for (const name of ['position', 'uv', 'bladeSide']) {
      this.geometry.setAttribute(name, template.getAttribute(name));
    }
    this.geometry.index = template.index;
  }

  writeSource(tile, { start, count, offset }) {
    for (const [name, source, width] of INSTANCE_ATTRIBUTES) {
      this.geometry.getAttribute(name).array.set(
        tile.output[source].subarray(offset * width, (offset + count) * width), start * width,
      );
      this.markRange(name, start, count);
    }
  }

  writeOrigins(tile, { start, count }) {
    const origins = this.geometry.getAttribute('instanceTile').array;
    for (let i = start; i < start + count; i += 1) {
      origins[i * 4] = tile.renderX;
      origins[i * 4 + 1] = tile.renderZ;
      origins[i * 4 + 2] = tile.revealTime ?? -1;
      origins[i * 4 + 3] = tile.revealRank ?? 16777216;
    }
    this.markRange('instanceTile', start, count);
  }

  rebase(dx, dz, budget) {
    if ((!dx && !dz) || !this.geometry.instanceCount) return;
    const origins = this.geometry.getAttribute('instanceTile').array;
    for (const slot of this.slots.values()) { slot.renderX += dx; slot.renderZ += dz; }
    for (let i = 0; i < this.geometry.instanceCount; i++) {
      origins[i * 4] += dx; origins[i * 4 + 1] += dz;
    }
    this.markRange('instanceTile', 0, this.geometry.instanceCount);
    budget?.rebase(this.geometry.instanceCount * 16);
    // Bounds follow the same translated rows, even if optional repacking waits.
    this.bounds?.translate(dx, dz);
  }

  update(tiles, budget = null) {
    const plan = meadowPageUpdatePlan(this, tiles);
    // Three creates new buffers from their full arrays, ignoring partial update ranges.
    const bytes = plan.count > 0 ? Math.max(plan.bytes, this.initialUploadBytes) : plan.bytes;
    if (budget && !budget.take(bytes)) {
      this.pending = true;
      PerfCounters.inc('meadowPageCommitsDeferred');
      return this.geometry.instanceCount;
    }
    this.pending = false;
    this.present = plan.present;
    this.order = plan.order;
    for (const tile of this.slots.keys()) if (!plan.present.has(tile)) this.slots.delete(tile);
    let changed = this.geometry.instanceCount !== plan.count;
    for (const { tile, count, source, ranges, sourceRanges, metadata } of plan.writes) {
      for (const range of sourceRanges) this.writeSource(tile, range);
      for (const range of metadata ? ranges : sourceRanges) this.writeOrigins(tile, range);
      changed ||= metadata;
      const slot = this.slots.get(tile) ?? {};
      Object.assign(slot, { ranges, count, source, renderX: tile.renderX, renderZ: tile.renderZ,
        revealTime: tile.revealTime, revealRank: tile.revealRank });
      this.slots.set(tile, slot);
    }
    PerfCounters.inc('meadowRepackBytes', plan.repackBytes);
    this.geometry.instanceCount = plan.count;
    if (plan.count > 0 && this.initialUploadBytes > 0) {
      this.getDrawPreparation()?.register(this.mesh, { uploadBytes: this.initialUploadBytes });
      this.initialUploadBytes = 0;
    }
    const preparation = this.getDrawPreparation();
    const ready = !preparation || preparation.isMaterialReady(this.mesh, this.mesh.material);
    this.mesh.visible = plan.count > 0 && ready;
    this.pending = plan.count > 0 && !ready;
    if (changed) this.bounds?.update(this.order);
    this.mesh.frustumCulled = this.bounds !== null && !this.bounds.ground.isEmpty();
    return plan.count;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
  }
}
