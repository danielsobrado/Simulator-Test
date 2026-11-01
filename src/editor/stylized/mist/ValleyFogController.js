import * as THREE from 'three/webgpu';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

import { LocalGroundHeight } from '../ambient/LocalGroundHeight.js';
import { resolveValleyFogConfig } from './valleyFogConfig.js';

/**
 * The valley mist's live state: one camera-local height patch — the same
 * `LocalGroundHeight` the ambient particles already sit on, not a second field —
 * and the uniforms every shaded terrain fragment reads.
 *
 * The patch is what makes the march possible at all: this streamed world has no
 * whole-map height texture to bind, and a terrain slot's own height field is only
 * a 128 m chunk the shader cannot index by world position. A single patch around
 * the camera is bounded, cheap, and shared by every fragment, and the mist fades
 * out before the patch edge so the boundary never shows.
 *
 * The caller drives it once a frame with the camera focus and the sky's current
 * sun, fog colour and region weight. With no config it resolves to null and the
 * material builds no fog at all.
 */
export class ValleyFogController {
  /**
   * @param {object} options
   * @param {(x: number, z: number) => number} options.getHeight canonical metres
   * @param {object} [options.config] `stylizedSurface.sky.valleyFog`
   * @param {number} [options.quality] quality share 0..1; `<= 0` builds nothing
   * @param {number} [options.resolution] patch texels per side
   * @param {number} [options.extent] patch metres per side
   */
  constructor({ getHeight, config, quality = 1, resolution = 64, extent = 128, prepareBounds, getRevision } = {}) {
    // The project's rule is stricter than the module's: a material built with no
    // valleyFog block at all keeps its plain shading, rather than compiling the
    // default mist in. A world that wants it says so in `sky.valleyFog`.
    this.settings = config === undefined ? null : resolveValleyFogConfig(config);
    this.enabled = Boolean(this.settings) && Number(quality) > 0;
    if (!this.enabled) return;
    // The patch's extent bounds the march; the config validator keeps maxDistance
    // inside half of it, so the README contract (the march never reads terrain the
    // patch does not hold) is a config error rather than a visual one.
    this.patch = new LocalGroundHeight({ getHeight, resolution, extent, prepareBounds, getRevision });
    this.quality = quality;
    this.uniforms = {
      /** Seconds, for the drifting pockets. */
      time: uniform(0),
      /** Runtime region weight 0..1: fades the mist out where there are no gorges. */
      weight: uniform(0),
      sunDirection: uniform(new THREE.Vector3(0.35, 0.85, 0.25)),
      sunColor: uniform(new THREE.Color(1, 1, 1)),
      fogColor: uniform(new THREE.Color(0.5, 0.6, 0.7)),
    };
  }

  /**
   * @param {{ x: number, z: number }} focus render space (the camera)
   * @param {{ x: number, z: number }} origin floating origin
   * @param {object} [state]
   * @param {number} [state.timeSeconds]
   * @param {number} [state.weight] 0..1 gorge/snow-country weight
   * @param {{ x: number, y: number, z: number }} [state.sunDirection]
   * @param {string|object} [state.sunColor]
   * @param {string|object} [state.fogColor]
   */
  update(focus, origin, state = {}) {
    if (!this.enabled) return;
    const prepare = () => this.patch.update(focus, origin, state.budget?.shouldYield);
    (state.budget?.runner ?? (run => run()))(prepare);
    if (!this.patch.ready) return;
    this.uniforms.time.value = Number(state.timeSeconds) || 0;
    this.uniforms.weight.value = Math.max(0, Math.min(1, Number(state.weight) || 0));
    if (state.sunDirection) this.uniforms.sunDirection.value.copy(state.sunDirection);
    if (state.sunColor) this.uniforms.sunColor.value.set(state.sunColor);
    if (state.fogColor) this.uniforms.fogColor.value.set(state.fogColor);
  }

  /** Idempotent: a teardown path that can also be reached after a failed boot. */
  dispose() {
    this.patch?.dispose();
    this.patch = null;
  }
}
