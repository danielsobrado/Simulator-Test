import * as THREE from 'three';
import { createWaterBlobMaterial, WATER_BLOB_LOBES } from './WaterBlobMaterial.js';

const RENDER_ORDER = 4400;
/** How far the lobes and ripples reach past the body, in body radii. */
const BOUNDS_RADII = 2.3;

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * Where the blob is and how big, `seconds` into its life: drawn up out of
 * the ground at `from` over `rise`, hovering at `center` for `hold`, then
 * collapsing back down over `collapse`. Null once it has gone.
 */
export function waterBlobPose(spec, seconds) {
  const { from, center, radius, rise, hold, collapse } = spec;
  if (seconds < 0 || seconds > rise + hold + collapse) return null;
  let lift = 1;
  let size = 1;
  if (seconds < rise) {
    lift = smooth(seconds / rise);
    size = 0.25 + 0.75 * lift;
  } else if (seconds > rise + hold) {
    const t = clamp01((seconds - rise - hold) / collapse);
    lift = 1 - t * t;
    size = 1 - 0.7 * t;
  }
  return {
    x: from.x + (center.x - from.x) * lift,
    y: from.y + (center.y - from.y) * lift,
    z: from.z + (center.z - from.z) * lift,
    radius: radius * size,
    presence: Math.min(clamp01(seconds / 0.25), clamp01((rise + hold + collapse - seconds) / 0.2)),
  };
}

/**
 * One floating water blob at a time (the Watery Sphere spell): a box mesh
 * whose material raymarches merged spheres (WaterBlobMaterial). Hidden, and
 * free, whenever no spell holds it.
 *
 * shortcut: a second blob replaces the first; a pool if two casters ever overlap.
 */
export function createWaterBlobLayer({ scene, lighting }) {
  const shading = createWaterBlobMaterial(lighting);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shading.material);
  mesh.name = 'vfx-water-blob';
  mesh.renderOrder = RENDER_ORDER;
  mesh.visible = false;
  scene.add(mesh);
  let active = null;
  let clock = 0;

  return {
    mesh,
    /**
     * @param {object} spec render-space `from` (ground) and `center` (hover)
     *   points, `radius` metres, `rise`, `hold` and `collapse` seconds
     */
    spawn(spec) {
      active = { ...spec, from: { ...spec.from }, center: { ...spec.center }, age: 0 };
      return active;
    },
    get active() { return active; },
    update(dt) {
      clock += dt;
      shading.time.value = clock % 1000;
      if (!active) return;
      active.age += dt;
      const pose = waterBlobPose(active, active.age);
      if (!pose) {
        active = null;
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.position.set(pose.x, pose.y, pose.z);
      mesh.scale.setScalar(pose.radius * BOUNDS_RADII * 2);
      shading.presence.value = pose.presence;
      shading.blend.value = pose.radius * 0.45;
      shading.wobble.value = pose.radius * 0.045;
      const [body, ...lobes] = shading.lobes.array;
      body.set(pose.x, pose.y, pose.z, pose.radius);
      // Lobes circle the body on their own slow orbits, bobbing as they go.
      lobes.forEach((lobe, index) => {
        const phase = clock * (0.7 + index * 0.23) + index * (Math.PI * 2 / (WATER_BLOB_LOBES - 1));
        const reach = pose.radius * (0.75 + 0.15 * Math.sin(clock * 1.3 + index));
        lobe.set(
          pose.x + Math.cos(phase) * reach,
          pose.y - pose.radius * 0.35 + Math.sin(clock * 1.9 + index * 2.1) * pose.radius * 0.25,
          pose.z + Math.sin(phase) * reach,
          pose.radius * (0.5 + 0.08 * Math.sin(clock * 2.3 + index)),
        );
      });
    },
    shiftOrigin(shiftX, shiftZ) {
      if (!active) return;
      for (const point of [active.from, active.center]) { point.x -= shiftX; point.z -= shiftZ; }
    },
    prepareForCompile() {
      const wasVisible = mesh.visible;
      mesh.visible = true;
      return () => { mesh.visible = wasVisible; };
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      shading.material.dispose();
    },
  };
}
