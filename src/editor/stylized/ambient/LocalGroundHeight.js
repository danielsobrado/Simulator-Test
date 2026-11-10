import { frameUniform } from '../../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import { texture, vec2 } from 'three/tsl';

/**
 * The ground under a patch of world around the camera, as a small texture a
 * vertex shader can read: ambient particles that hug the ground (spindrift,
 * blowing sand, pollen) sit on it rather than on a flat plane.
 *
 * Heights are stored in half floats relative to the patch centre's height,
 * which a uniform adds back, so they stay precise at any altitude. The patch
 * is rebuilt when the camera leaves its middle or the terrain changes.
 * A floating-origin shift only moves the published patch's corner uniform.
 */
export class LocalGroundHeight {
  /**
   * @param {object} options
   * @param {(x: number, z: number) => number} options.getHeight canonical metres
   * @param {number} [options.resolution] texels per side
   * @param {number} [options.extent] metres per side
   */
  constructor({ getHeight, resolution = 64, extent = 128, prepareBounds = () => true, getRevision = () => 0 }) {
    this.getHeight = getHeight;
    this.prepareBounds = prepareBounds;
    this.getRevision = getRevision;
    this.resolution = resolution;
    this.extent = extent;
    this.data = new Uint16Array(resolution * resolution);
    this.texture = new THREE.DataTexture(
      this.data,
      resolution,
      resolution,
      THREE.RedFormat,
      THREE.HalfFloatType,
    );
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.uniforms = {
      /** Render-space corner of the patch (minimum x, z). */
      corner: frameUniform(new THREE.Vector2()),
      extent: frameUniform(extent),
      base: frameUniform(0),
    };
    this.center = null;
    this.origin = { x: Number.NaN, z: Number.NaN };
    this.rebuilds = 0;
    this.ready = false;
    this.job = null;
  }

  /** Ground height (metres, render space) under a render-space point. */
  heightNode(x, z) {
    const { corner, extent, base } = this.uniforms;
    // Samples sit on the patch's corners and edges (`rebuild` steps
    // extent / (resolution − 1)), while a texel's centre is at (i + 0.5) /
    // resolution: map onto the centres so each sample is read where it was taken.
    const resolution = this.resolution;
    const uv = vec2(x, z).sub(corner).div(extent).clamp(0, 1)
      .mul((resolution - 1) / resolution)
      .add(0.5 / resolution);
    return texture(this.texture, uv).level(0).r.add(base);
  }

  /**
   * @param {{ x: number, z: number }} focus render space
   * @param {{ x: number, z: number }} origin floating origin (canonical of render zero)
   * @returns {boolean} whether the patch was rebuilt
   */
  update(focus, origin, shouldYield = () => false) {
    const canonical = { x: focus.x + origin.x, z: focus.z + origin.z };
    const revision = this.getRevision();
    const drift = this.center ? Math.max(Math.abs(canonical.x - this.center.x), Math.abs(canonical.z - this.center.z)) : Infinity;
    if (this.job && (this.jobRevision !== revision
        || Math.hypot(canonical.x - this.target.x, canonical.z - this.target.z) > this.extent / 4)) {
      this.job.return(); this.job = null;
    }
    if (!this.job && (this.revision !== revision || drift >= this.extent / 8)) {
      this.target = canonical; this.jobRevision = revision;
      this.job = this.buildPatch(canonical, revision, shouldYield);
    }
    const previous = this.rebuilds;
    while (this.job && !shouldYield()) {
      const step = this.job.next();
      if (step.done) this.job = null;
      else if (step.value === 'wait-ground-dependencies') break;
    }
    Object.assign(this.origin, origin);
    if (this.center) this.uniforms.corner.value.set(this.center.x - this.extent / 2 - origin.x,
      this.center.z - this.extent / 2 - origin.z);
    return previous !== this.rebuilds;
  }

  rebuild(focus, origin) {
    this.job?.return();
    this.job = null;
    const job = this.buildPatch({ x: focus.x + origin.x, z: focus.z + origin.z }, this.getRevision(), () => false);
    for (;;) {
      const step = job.next();
      if (step.done) break;
      if (step.value === 'wait-ground-dependencies') { job.return(); return false; }
    }
    this.uniforms.corner.value.set(this.center.x - this.extent / 2 - origin.x, this.center.z - this.extent / 2 - origin.z);
    Object.assign(this.origin, origin);
    return true;
  }

  *buildPatch(focus, revision, shouldYield) {
    const { resolution, extent } = this;
    const step = extent / (resolution - 1);
    // Snapped so a patch rebuilt nearby samples the same ground at the same texels.
    const centerX = Math.round(focus.x / step) * step;
    const centerZ = Math.round(focus.z / step) * step;
    const cornerX = centerX - extent / 2;
    const cornerZ = centerZ - extent / 2;
    while (!this.prepareBounds({ minX: cornerX, maxX: cornerX + extent, minZ: cornerZ, maxZ: cornerZ + extent }, shouldYield)) {
      yield 'wait-ground-dependencies';
    }
    const data = new Uint16Array(resolution * resolution);
    const base = this.getHeight(centerX, centerZ);
    for (let row = 0; row < resolution; row += 1) {
      for (let column = 0; column < resolution; column += 1) {
        const height = this.getHeight(cornerX + column * step, cornerZ + row * step);
        data[row * resolution + column] = THREE.DataUtils.toHalfFloat(
          Number.isFinite(height) && Number.isFinite(base) ? height - base : 0,
        );
        if ((row * resolution + column) % 64 === 63) yield;
      }
    }
    this.data = data;
    this.texture.image.data = data;
    this.uniforms.base.value = Number.isFinite(base) ? base : 0;
    this.texture.needsUpdate = true;
    this.center = { x: centerX, z: centerZ };
    this.revision = revision;
    this.ready = true;
    this.rebuilds += 1;
  }

  dispose() {
    this.job?.return(); this.job = null;
    this.texture.dispose();
  }
}
