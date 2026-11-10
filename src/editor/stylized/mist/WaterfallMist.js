import { frameUniform } from '../../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import { createMistParticles } from './mistParticles.js';
import { createSprayPuffTexture } from './sprayPuffTexture.js';
import { createWaterfallMistMaterial } from './WaterfallMistMaterial.js';

/** Above the water sheet (renderOrder 2), which writes no depth. */
const MIST_RENDER_ORDER = 3;
/** Headroom around a fall's spray for its culling sphere, in metres. */
const SITE_MARGIN = 18;

function createSlotMesh(site, material) {
  const particles = createMistParticles(site);
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  geometry.setAttribute('mistSpawn', new THREE.InstancedBufferAttribute(particles.spawn, 4));
  geometry.setAttribute('mistMotion', new THREE.InstancedBufferAttribute(particles.motion, 4));
  geometry.setAttribute('mistShape', new THREE.InstancedBufferAttribute(particles.shape, 4));
  geometry.instanceCount = particles.count;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'waterfall-mist';
  // Every puff is placed by positionNode, so no geometric bound describes the spray.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = MIST_RENDER_ORDER;
  mesh.userData.excludeFromReflection = true;
  const faceLength = Math.hypot(site.lipX - site.x, site.lipZ - site.z);
  const drop = site.top - site.foot;
  return {
    site,
    mesh,
    bounds: new THREE.Sphere(
      new THREE.Vector3(),
      Math.hypot(faceLength, drop) + site.widthMeters * 0.5 + SITE_MARGIN,
    ),
    lift: drop * 0.5 + 3,
  };
}

/**
 * Spray mist over the river falls near the viewer.
 *
 * A planet-scale world has hundreds of falls, so mist is a small pool: each
 * frame the nearest `mistMaxActive` falls within `mistDrawDistance` get a
 * slot (kept while they stay among the nearest), placed at the fall's foot in
 * floating-origin render space and drawn only while in view.
 */
export class WaterfallMist {
  /**
   * @param {object} options
   * @param {THREE.Object3D} options.scene
   * @param {object} options.floatingOrigin
   * @param {() => import('../../water/RiverFallSites.js').RiverFallSiteIndex | null} options.getSites
   * @param {() => object | null} options.getSkyView lights the spray from the scene's sun and sky
   * @param {object} options.config `stylizedSurface.water.waterfall`
   * @param {boolean} [options.enabled] false at water qualities that draw no whitewater
   */
  constructor({ scene, floatingOrigin, getSites, getSkyView, config, enabled = true }) {
    this.enabled = enabled && config.enabled && config.mistEnabled;
    this.floatingOrigin = floatingOrigin;
    this.getSites = getSites;
    this.getSkyView = getSkyView;
    this.config = config;
    this.slots = [];
    this.time = frameUniform(0);
    this.intensity = frameUniform(config.mistIntensity);
    this.light = {
      sunDirection: frameUniform(new THREE.Vector3(0.35, 0.85, 0.25).normalize()),
      sunColor: frameUniform(new THREE.Color(1, 1, 1)),
      skyColor: frameUniform(new THREE.Color(0.6, 0.7, 0.8)),
    };
    this.puffs = null;
    this.material = null;
    this.root = new THREE.Group();
    this.root.name = 'waterfall-mist';
    this.root.renderOrder = MIST_RENDER_ORDER;
    scene.add(this.root);
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
  }

  ensureMaterial() {
    if (this.material) return this.material;
    this.puffs = createSprayPuffTexture();
    this.material = createWaterfallMistMaterial({
      puffs: this.puffs,
      time: this.time,
      intensity: this.intensity,
      light: this.light,
    });
    return this.material;
  }

  updateLight() {
    const sky = this.getSkyView?.();
    if (!sky) return;
    if (sky.sunDirectionValue) this.light.sunDirection.value.copy(sky.sunDirectionValue).normalize();
    if (sky.directional) {
      this.light.sunColor.value.copy(sky.directional.color).multiplyScalar(sky.directional.intensity);
    }
    if (sky.hemisphere) {
      this.light.skyColor.value.copy(sky.hemisphere.color).multiplyScalar(sky.hemisphere.intensity);
    }
  }

  /** Keep the slots whose fall is still wanted, drop the rest and fill from the nearest. */
  assign(wanted) {
    const kept = [];
    for (const slot of this.slots) {
      if (wanted.includes(slot.site)) {
        kept.push(slot);
      } else {
        this.root.remove(slot.mesh);
        slot.mesh.geometry.dispose();
      }
    }
    for (const site of wanted) {
      if (kept.some((slot) => slot.site === site)) continue;
      const slot = createSlotMesh(site, this.ensureMaterial());
      this.root.add(slot.mesh);
      kept.push(slot);
    }
    this.slots = kept;
  }

  update(timestampSeconds, camera) {
    const index = this.enabled ? this.getSites() : null;
    if (!index || !camera) {
      this.assign([]);
      return;
    }
    const canonical = this.floatingOrigin.toCanonical(camera.position.x, camera.position.z);
    this.assign(index.near(
      canonical.x,
      canonical.z,
      this.config.mistDrawDistance,
      this.config.mistMaxActive,
    ));
    if (this.slots.length === 0) return;
    this.time.value = timestampSeconds;
    this.updateLight();
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem);
    for (const slot of this.slots) {
      const render = this.floatingOrigin.toRender(slot.site.x, slot.site.z);
      slot.mesh.position.set(render.x, slot.site.foot, render.z);
      slot.bounds.center.set(render.x, slot.site.foot + slot.lift, render.z);
      slot.mesh.visible = this.frustum.intersectsSphere(slot.bounds);
    }
  }

  dispose() {
    this.assign([]);
    this.root.removeFromParent();
    this.material?.dispose();
    this.puffs?.dispose();
  }
}
