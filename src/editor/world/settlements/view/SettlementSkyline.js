import * as THREE from 'three/webgpu';
import { abs, float, fract, mix, mx_noise_float, normalWorld, normalize, positionWorld, smoothstep, vec2, vertexColor } from 'three/tsl';
import { stagedDrawPublication, WAIT_FOR_DRAW_PREPARATION } from '../../../../render/preparation/StagedDrawPublication.js';
import { PerfCounters } from '../../../performance/qa/PerfCounters.js';
import { buildingShadeEmission } from '../../../stylized/forest/foliageLight.js';

export const SETTLEMENT_SKYLINE = Object.freeze({ radius: 3200, near: 560, maxTowns: 8 });

/**
 * A town's massing stands in for it until the town itself is drawn: hidden once its
 * site is ready (`isDrawn`), or, without one, inside SETTLEMENT_SKYLINE.near. A
 * population-sized city is wider than `near`, so the site, not the distance, decides.
 */

/**
 * The massing's flat colour, painted like the rocks: broad tonal breakup, and on
 * walls the rhythm of windows and floors, on roofs the courses of tiles, with a
 * darker foot. From world position alone, so it costs no geometry. A box of one
 * colour read as a white block standing in the street while a city loaded.
 */
function paintedMassing(base) {
  const p = positionWorld;
  const n = normalize(normalWorld);
  const roof = smoothstep(0.25, 0.45, n.y);
  // Along the wall: world xz projected on the face's horizontal tangent.
  const tangent = normalize(vec2(n.z, n.x.negate()).add(vec2(1e-4, 0)));
  const along = p.x.mul(tangent.x).add(p.z.mul(tangent.y));
  const bay = fract(along.div(2.6)), floor = fract(p.y.div(3.1));
  const window = smoothstep(0.32, 0.36, bay).mul(smoothstep(0.68, 0.64, bay))
    .mul(smoothstep(0.38, 0.42, floor)).mul(smoothstep(0.78, 0.74, floor));
  const band = smoothstep(0.02, 0.0, abs(floor.sub(0.06))).mul(0.12);
  const wall = base.mul(float(1).sub(window.mul(0.55)).sub(band));
  const course = smoothstep(0.55, 0.95, fract(p.y.mul(2.8))).mul(0.14);
  const roofed = base.mul(float(1).sub(course));
  const tone = mx_noise_float(p.mul(0.07)).mul(0.2).add(mx_noise_float(p.mul(0.6)).mul(0.08)).add(0.9);
  // Weathered toward the foot, as the real walls' damp band.
  const foot = smoothstep(0, 3, p.y.sub(p.y.div(40).floor().mul(40))).mul(0.1).add(0.9);
  return mix(wall.mul(foot), roofed, roof).mul(tone);
}

/** Worker-prepared massing; installation and shader preparation are deferred. */
export class SettlementSkyline {
  constructor({ scene, getDrawPreparation = () => null, isDrawn = null }) {
    this.root = new THREE.Group(); this.root.name = 'settlement-skylines'; scene.add(this.root);
    this.isDrawn = isDrawn;
    this.getDrawPreparation = getDrawPreparation;
    this.material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.94, metalness: 0,
      side: THREE.DoubleSide, flatShading: true });
    const painted = paintedMassing(vertexColor().rgb);
    this.material.colorNode = painted;
    // Half the buildings' fill: at full fill a limewashed box glowed white beside the street.
    this.material.emissiveNode = buildingShadeEmission(painted, { fill: 1.1, bounce: 1.3 });
    this.material.name = 'settlement-skyline';
    this.towns = new Map(); this.expected = new Map(); this.jobs = new Map(); this.failed = new Map();
    this.staged = new Map();
    this.origin = { x: 0, z: 0 }; this.focus = { x: 0, z: 0 };
  }

  refresh(field, focus, tileSize, getPlan = entry => entry.plan) {
    const near = field ? field.entriesNear(focus.x / tileSize, -focus.z / tileSize,
      SETTLEMENT_SKYLINE.radius / tileSize).slice(0, SETTLEMENT_SKYLINE.maxTowns) : [];
    this.expected = new Map(near.map(({ entry }) => [entry.settlement.id, entry]));
    for (const [id, town] of this.towns) if (!this.expected.has(id)) {
      town.mesh.geometry.dispose(); town.mesh.removeFromParent(); this.towns.delete(id);
    }
    for (const [id, job] of this.jobs) if (!this.expected.has(id)) {
      job.return(); this.jobs.delete(id);
    }
    for (const id of this.failed.keys()) if (!this.expected.has(id)) this.failed.delete(id);
    for (const { entry } of near) {
      const id = entry.settlement.id;
      getPlan(entry);
      if (this.towns.has(id) || this.jobs.has(id) || this.failed.has(id)) continue;
      if (!entry.skyline) continue;
      const centre = { x: entry.settlement.cellX * tileSize, z: -entry.settlement.cellZ * tileSize };
      this.jobs.set(id, this.install(id, entry.skyline, centre));
    }
  }

  *install(id, arrays, centre) {
    const geometry = new THREE.BufferGeometry(); let mesh = null, published = false;
    try {
      for (const [name, array] of [['position', arrays.positions], ['color', arrays.colors], ['normal', arrays.normals]]) {
        yield; geometry.setAttribute(name, new THREE.BufferAttribute(array, 3));
      }
      yield; geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3().fromArray(arrays.sphere.center), arrays.sphere.radius);
      yield;
      mesh = new THREE.Mesh(geometry, this.material); mesh.name = `settlement-skyline-${id}`;
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.skipWarmup = true;
      this.staged.set(id, { id, mesh, centre });
      this.place({ id, mesh, centre });
      yield* stagedDrawPublication(this.root, [mesh], this.getDrawPreparation());
      this.place({ id, mesh, centre }); this.root.add(mesh); this.towns.set(id, { id, mesh, centre }); published = true;
      PerfCounters.inc('settlementSkylinesInstalled');
    } finally { this.staged.delete(id); if (!published) { mesh?.removeFromParent(); geometry.dispose(); } }
  }

  advance(shouldYield) {
    for (const [id, job] of this.jobs) {
      while (!shouldYield()) {
        try {
          const step = job.next();
          if (step.done) { this.jobs.delete(id); break; }
          if (step.value === WAIT_FOR_DRAW_PREPARATION) return;
        } catch (error) { this.failed.set(id, error); this.jobs.delete(id); break; }
        // Shader readiness changes between frames, not by spinning this job.
      }
      if (shouldYield()) return;
    }
  }

  place({ id, mesh, centre }) {
    mesh.position.set(centre.x - this.origin.x, 0, centre.z - this.origin.z);
    mesh.visible = this.isDrawn ? !this.isDrawn(id)
      : Math.hypot(centre.x - this.focus.x, centre.z - this.focus.z) > SETTLEMENT_SKYLINE.near;
  }
  update(focus, origin) {
    Object.assign(this.origin, origin); Object.assign(this.focus, focus);
    for (const town of this.towns.values()) this.place(town);
    for (const town of this.staged.values()) this.place(town);
  }
  get pending() { return this.expected.size - this.towns.size; }
  getPreparationStatus() {
    return { ready: this.pending === 0 && this.failed.size === 0, expected: this.expected.size,
      installed: this.towns.size, pending: this.pending, failed: this.failed.size,
      errors: [...this.failed.values()].map(error => error.message) };
  }
  clear() {
    for (const job of this.jobs.values()) job.return(); this.jobs.clear();
    for (const { mesh } of this.towns.values()) { mesh.geometry.dispose(); mesh.removeFromParent(); }
    this.towns.clear(); this.expected.clear(); this.failed.clear();
  }
  dispose() { this.clear(); this.material.dispose(); this.root.removeFromParent(); }
}
