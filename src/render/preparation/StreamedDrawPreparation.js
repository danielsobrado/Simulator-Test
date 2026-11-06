import { withDrawPreparation, withPreparationFrame } from './DrawPreparation.js';
import { PerfCounters } from '../../editor/performance/qa/PerfCounters.js';
import { BudgetedAttributeInitialization } from './BudgetedAttributeInitialization.js';

const MAX_WAIT_FRAMES = 4;
export const INITIAL_UPLOAD_BYTES_PER_FRAME = 768 * 1024;

/** New renderers are staged on the same scene/pass cache before publication. */
export class StreamedDrawPreparation {
  constructor({ scene, renderer, settings, render, invalidateHistory }) {
    Object.assign(this, { scene, renderer, settings, render, invalidateHistory });
    this.prepared = new WeakSet();
    this.preparedVariants = new WeakMap();
    this.stagedMaterials = new Map();
    this.pending = new Set();
    this.initialUploadBytes = new Map();
    this.initialUploadAttributes = new Map();
    this.attributeInitialization = new BudgetedAttributeInitialization(renderer);
    this.hidden = new Map();
    this.disposed = false;
    this.waitFrames = 0;
    this.reservation = null;
  }
  beginFrame(budget) {
    this.revealPending();
    this.reservation?.cancel();
    this.reservation = null;
    if (this.disposed || !this.settings.enabled || this.pending.size === 0) {
      this.waitFrames = 0;
      return;
    }
    // Compilation runs late, after simulation and scene updates. Reserve a
    // turn before earlier queues spend the shared allowance; a perpetually
    // busy scene must not leave these meshes hidden indefinitely.
    if (++this.waitFrames >= MAX_WAIT_FRAMES) this.reservation = budget.reserve(6);
  }
  flushBudgeted(camera, budget) {
    const reservation = this.reservation;
    this.reservation = null;
    if (reservation) reservation.run(() => this.flush(camera));
    else budget.tryRun(() => this.flush(camera, budget.shouldYield), 6);
  }
  register(root, { uploadBytes = 0, uploadAttributes = null } = {}) {
    this.discover(root);
    if (uploadBytes > 0 && this.pending.has(root)) this.initialUploadBytes.set(root, uploadBytes);
    if (uploadAttributes && this.pending.has(root)) this.initialUploadAttributes.set(root, uploadAttributes);
  }
  discover(root = this.scene) {
    if (!this.settings.enabled || this.disposed) return;
    // Called after a variant/actor is installed, never scans the scene per frame.
    root.traverse(object => {
      if (!object.isMesh || this.prepared.has(object) || object.userData.skipWarmup) return;
      this.pending.add(object);
    });
  }
  markInitialScene() {
    this.scene.traverse(object => { if (object.isMesh) this.markPrepared(object, object.material); });
  }
  markPrepared(mesh, material) {
    this.prepared.add(mesh);
    let variants = this.preparedVariants.get(mesh);
    if (!variants) this.preparedVariants.set(mesh, variants = new Set());
    variants.add(material);
  }
  requestMaterial(mesh, material) {
    if (this.disposed || !this.settings.enabled || this.preparedVariants.get(mesh)?.has(material)) return false;
    this.stagedMaterials.set(mesh, material);
    this.pending.add(mesh);
    return true;
  }
  isMaterialReady(mesh, material) {
    return !this.settings.enabled || this.preparedVariants.get(mesh)?.has(material) === true;
  }
  flush(camera, shouldYield = null) {
    this.revealPending();
    if (shouldYield?.()) return;
    if (this.disposed || !this.settings.enabled || this.pending.size === 0) return;
    const targets = [];
    const materials = new Map();
    const started = performance.now();
    let uploadBytes = 0;
    const uploadStarted = performance.now();
    let budgetedBytes = 0;
    try {
      for (const mesh of this.pending) {
        let root = mesh;
        while (root.parent) root = root.parent;
        if (root !== this.scene) {
          this.attributeInitialization.cancel(this.initialUploadAttributes.get(mesh) ?? []);
          this.initialUploadAttributes.delete(mesh);
          this.pending.delete(mesh); this.stagedMaterials.delete(mesh); this.initialUploadBytes.delete(mesh); continue;
        }
        const attributes = this.initialUploadAttributes.get(mesh);
        const budgeted = attributes && this.attributeInitialization.supported;
        if (budgeted) {
          const result = this.attributeInitialization.advance(attributes,
            INITIAL_UPLOAD_BYTES_PER_FRAME - uploadBytes, shouldYield);
          uploadBytes += result.bytes;
          budgetedBytes += result.bytes;
          if (!result.ready) break;
        }
        const bytes = budgeted ? 0 : this.initialUploadBytes.get(mesh) ?? 0;
        // One oversized allocation may progress alone, never stacked with another draw.
        if (targets.length && uploadBytes + bytes > INITIAL_UPLOAD_BYTES_PER_FRAME) break;
        this.pending.delete(mesh);
        uploadBytes += bytes;
        targets.push(mesh);
        if (targets.length >= this.settings.meshesPerFrame || uploadBytes >= INITIAL_UPLOAD_BYTES_PER_FRAME) break;
      }
      PerfCounters.inc('streamedInitialUploadCpuMs', performance.now() - uploadStarted);
      PerfCounters.set('meadowInitialGpuUploadMaxFrameBytes',
        Math.max(PerfCounters.get('meadowInitialGpuUploadMaxFrameBytes'), budgetedBytes));
      if (budgetedBytes) PerfCounters.inc('streamedDrawInitialUploadBytes', budgetedBytes);
      if (targets.length === 0) return;
      this.waitFrames = 0;
      for (const mesh of targets) materials.set(mesh, mesh.material);
      for (const target of targets) target.material = this.stagedMaterials.get(target) ?? target.material;
      withPreparationFrame(this.renderer, null, () => withDrawPreparation(this.scene, targets, () => this.render(camera)));
      for (const target of targets) {
        this.markPrepared(target, target.material);
        this.stagedMaterials.delete(target);
        this.initialUploadBytes.delete(target);
        this.attributeInitialization.release(this.initialUploadAttributes.get(target) ?? []);
        this.initialUploadAttributes.delete(target);
      }
      this.invalidateHistory?.();
      PerfCounters.inc('streamedDrawsPrepared', targets.length);
      PerfCounters.inc('streamedDrawInitialUploadBytes', uploadBytes - budgetedBytes);
    } catch (error) {
      this.settings = { ...this.settings, enabled: false };
      this.pending.clear(); this.stagedMaterials.clear(); this.initialUploadBytes.clear();
      this.attributeInitialization.cancel(); this.initialUploadAttributes.clear();
      PerfCounters.inc('streamedDrawPreparationFailures');
      console.warn('Streamed draw preparation unavailable.', error);
    } finally {
      for (const [mesh, material] of materials) mesh.material = material;
      PerfCounters.inc('streamedDrawPreparationMs', performance.now() - started);
    }
  }
  hidePending() {
    for (const mesh of this.pending) {
      if (this.stagedMaterials.has(mesh) && this.prepared.has(mesh)) continue;
      if (!mesh.parent || !mesh.visible) continue;
      this.hidden.set(mesh, mesh.visible); mesh.visible = false;
    }
  }
  revealPending() {
    for (const [mesh, visible] of this.hidden) mesh.visible = visible;
    this.hidden.clear();
  }
  dispose() {
    this.reservation?.cancel(); this.reservation = null;
    this.revealPending(); this.disposed = true; this.pending.clear(); this.stagedMaterials.clear(); this.initialUploadBytes.clear();
    this.attributeInitialization.cancel(); this.initialUploadAttributes.clear();
  }
}
