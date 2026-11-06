/**
 * An authored, rigged hero in the scene — the counterpart of the procedural
 * `CharacterView`, with the same public surface so the composition root drives
 * either without knowing which it has.
 *
 * Loading never blocks the first frame (docs/asset-startup-and-variant-residency.md):
 * the GLB is requested at construction and installed whenever it arrives. Until
 * then the view keeps tracking the player, so the first visible frame already
 * stands where the player is. The pipelines are compiled before the model is
 * first drawn, so entering walk mode does not hitch on a shader compile.
 *
 * Hierarchy: `group` carries the player's position and heading; `body` is a
 * pivot at chest height that the swim lean turns about, so a swimmer lies along
 * the surface instead of swinging about the feet; `model` carries the scale to
 * `targetHeight` and the sole offset, and its `position.y` is the pelvis-drop
 * handle foot placement moves.
 */

import * as THREE from 'three';
import { disposeScene, resolveAssetUrl } from '../../assets/assetUrl.js';
import {
  PLAYER_WATER_SUBMERGED,
  PLAYER_WATER_WADING,
  isSwimmingWaterState,
} from '../../player/PlayerWaterState.js';
import { CharacterMotionState } from '../CharacterMotionState.js';
import { createGait } from '../gait.js';
import { CharacterAnimator } from './CharacterAnimator.js';
import { ContactShadow } from './ContactShadow.js';
import { createContactBlob } from './contactShadowBlob.js';
import { collectHumanoidBones } from './humanoidRig.js';

/** Water over the foot (metres) from which a footfall splashes rather than lands. */
const SPLASH_DEPTH = 0.04;

/**
 * Height of the swim pivot (the chest) as a share of the body. Swimming lifts
 * the body until that pivot rides just under the surface, whatever the
 * character's height; lying flat about the chest keeps the back awash and the
 * head clear.
 */
const SWIM_PIVOT_SHARE = 0.65;

/** World bounds of a rigged model as its skinned meshes deform it, matrices updated first. */
export function skinnedBounds(model) {
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (object.isSkinnedMesh) object.computeBoundingBox();
  });
  return new THREE.Box3().setFromObject(model);
}

export class GlbCharacterView {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {{ heightAt(x: number, z: number): number }} options.terrain
   * @param {ReturnType<import('./CharacterRoster.js').resolveHeroCharacter>} options.hero
   * @param {{ loadAsync(url: string): Promise<{ scene: THREE.Object3D, animations: THREE.AnimationClip[] }> }} options.loader
   * @param {string} [options.baseUrl]
   * @param {number} [options.runSpeed] player run speed, m/s
   * @param {boolean} [options.enabled]
   * @param {boolean} [options.contactShadow] ground the figure with soft blobs under body and soles
   * @param {() => void} [options.onDispose] releases resources the factory made for this view
   */
  constructor({
    scene,
    terrain,
    hero,
    loader,
    baseUrl = '/',
    runSpeed = 5.4,
    enabled = true,
    contactShadow = true,
    onDispose = null,
  }) {
    this.scene = scene;
    this.terrain = terrain;
    this.hero = hero;
    this.motion = new CharacterMotionState(createGait({ runSpeed }));
    this.runSpeed = runSpeed;
    this.onDispose = onDispose;

    this.group = new THREE.Group();
    this.group.name = `hero-${hero.id}`;
    this.group.visible = false;
    scene.add(this.group);

    this.model = null;
    this.body = null;
    this.bones = null;
    this.animator = null;
    this.contactShadowEnabled = contactShadow;
    this.contactShadow = null;
    this.shadowRoot = new THREE.Group();
    this.shadowRoot.name = `hero-${hero.id}-contact-shadow`;
    scene.add(this.shadowRoot);
    this._compileRequest = null;
    this._compiling = null;
    this._visible = false;
    this._disposed = false;
    this._castAim = new THREE.Vector3();
    this._footstepListeners = new Set();
    this._footPosition = new THREE.Vector3();
    this._stats = Object.freeze({ triangles: 0, vertices: 0, loaded: false });

    this.setVisible(enabled);
    this.ready = this._load(loader, baseUrl);
  }

  get visible() {
    return this._visible;
  }

  get stats() {
    return this._stats;
  }

  /** Sole-to-crown height, metres. */
  get height() {
    return this.hero.targetHeight;
  }

  /**
   * Where breath leaves from, for the ambient breath in the cold: the model
   * (its head bone is looked up there), height, facing (0 faces +z) and
   * whether it runs. Null while hidden.
   */
  breathSource() {
    if (!this.visible) return null;
    return {
      model: this.group,
      height: this.height,
      facing: this.motion.facing,
      running: this.motion.speed > this.runSpeed * 0.6,
    };
  }

  async _load(loader, baseUrl) {
    let gltf = null;
    try {
      gltf = await loader.loadAsync(resolveAssetUrl(baseUrl, this.hero.scene));
      if (this._disposed) {
        disposeScene(gltf.scene);
        return false;
      }
      this._install(gltf.scene, gltf.animations ?? []);
      if (this._compileRequest) await this._compile();
      this._syncGroupVisibility();
      return true;
    } catch (error) {
      if (gltf?.scene && gltf.scene !== this.model) {
        gltf.scene.removeFromParent();
        disposeScene(gltf.scene);
      }
      console.error(`Hero character "${this.hero.id}" failed to load.`, error);
      return false;
    }
  }

  _install(model, clips) {
    const bounds = skinnedBounds(model);
    const nativeHeight = bounds.max.y - bounds.min.y;
    if (!(nativeHeight > 0)) {
      throw new Error(`Hero character "${this.hero.id}" has no measurable height.`);
    }
    const scale = this.hero.targetHeight / nativeHeight;
    const pivot = this.hero.targetHeight * SWIM_PIVOT_SHARE;
    model.scale.setScalar(scale);
    model.position.set(0, -bounds.min.y * scale - pivot, 0);

    let triangles = 0;
    let vertices = 0;
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const geometry = object.geometry;
      const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
      triangles += Math.floor(count / 3);
      vertices += geometry.attributes.position?.count ?? 0;
    });

    this.body = new THREE.Group();
    this.body.name = 'hero-body';
    this.body.position.set(0, pivot, 0);
    this.body.add(model);
    this.group.add(this.body);
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.updateMatrixWorld(true);
    this.bones = collectHumanoidBones(model);
    this.animator = new CharacterAnimator({
      body: this.body,
      model,
      clips,
      bones: this.bones,
      hero: this.hero,
      terrain: this.terrain,
      solesY: 0,
    });
    if (this.contactShadowEnabled) {
      this.contactShadow = new ContactShadow({
        parent: this.shadowRoot,
        terrain: this.terrain,
        bones: this.bones,
        height: this.hero.targetHeight,
        createBlob: createContactBlob,
      });
    }
    this.model = model;
    this._stats = Object.freeze({ triangles, vertices, loaded: true });
  }

  /**
   * Compile the model's pipelines against the scene's lights before its first draw.
   *
   * The model is compiled on its own — `compileAsync`'s first argument may be
   * any object, its third names the scene to take lights and environment from —
   * so nothing else is recompiled. Frustum culling is lifted for the call, since
   * the model may be anywhere relative to the camera it is compiled for.
   */
  async _compile() {
    const { renderer, camera } = this._compileRequest;
    const meshes = [];
    const roots = [this.model, this.shadowRoot];
    for (const root of roots) {
      root.traverse((object) => {
        if (object.isMesh) meshes.push([object, object.frustumCulled, object.visible]);
      });
    }
    const compiling = (async () => {
      for (const [mesh] of meshes) {
        mesh.frustumCulled = false;
        mesh.visible = true;
      }
      try {
        for (const root of roots) await renderer.compileAsync(root, camera, this.scene);
      } catch (error) {
        console.warn(`Hero character "${this.hero.id}" pre-compile failed; it will compile on first use.`, error);
      } finally {
        for (const [mesh, culled, visible] of meshes) {
          mesh.frustumCulled = culled;
          mesh.visible = visible;
        }
      }
    })();
    this._compiling = compiling;
    this._syncGroupVisibility();
    try {
      await compiling;
    } finally {
      if (this._compiling === compiling) this._compiling = null;
      this._syncGroupVisibility();
    }
  }

  _syncGroupVisibility() {
    // Hidden while a compile is in flight: drawing it then would compile the
    // same pipelines synchronously, which is the hitch the compile avoids.
    this.group.visible = this._visible && this.model !== null && this._compiling === null;
    this.shadowRoot.visible = this.group.visible;
  }

  /**
   * @param {number} dt seconds
   * @param {ReturnType<import('../../player/PlayerController.js').PlayerController['getStatus']>} status
   * @param {number} nowMs
   */
  update(dt, status, nowMs) {
    if (!this._visible) return;
    this.motion.update(dt, status, nowMs);
    if (!this.animator) return;
    this.group.position.set(this.motion.x, this.motion.footY, this.motion.z);
    this.group.rotation.set(0, this.motion.facing, 0);
    // The animator propagates the new pose after the mixer, before its world-space solves.
    this.group.updateWorldMatrix(true, false);
    const swimming = isSwimmingWaterState(status.waterState);
    this.animator.update(
      dt,
      this.motion,
      swimming,
      status.waterState === PLAYER_WATER_SUBMERGED,
      Number.isFinite(status.waterSurfaceHeight) ? status.waterSurfaceHeight : Number.NaN,
    );
    if (swimming) this.contactShadow?.hide();
    else this.contactShadow?.update(this.motion.x, this.motion.z, this.motion.footY, this.motion.facing);
    if (this.animator.footfall) this._emitFootstep(this.animator.footfall, status);
  }

  /**
   * Hear every footfall: `{ foot, x, y, z, facing, speed, surface }` in render space,
   * where `surface` is `water` while wading and `ground` otherwise.
   * @returns {() => void} unsubscribe
   */
  onFootstep(listener) {
    this._footstepListeners.add(listener);
    return () => this._footstepListeners.delete(listener);
  }

  _emitFootstep(foot, status) {
    if (this._footstepListeners.size === 0) return;
    const bone = foot === 'left' ? this.bones.left.foot : this.bones.right.foot;
    bone.getWorldPosition(this._footPosition);
    const event = Object.freeze({
      foot,
      x: this._footPosition.x,
      y: this._footPosition.y,
      z: this._footPosition.z,
      facing: this.motion.facing,
      speed: this.motion.speed,
      // Ankle-deep bog and shallows splash too, not only water past wading depth.
      surface: status.waterState === PLAYER_WATER_WADING || (status.waterDepth ?? 0) >= SPLASH_DEPTH ? 'water' : 'ground',
    });
    for (const listener of this._footstepListeners) listener(event);
  }

  /** Raise the arms into a cast, from the frame the spell effect starts. */
  beginCast(durationMs, direction, nowMs) {
    this.motion.beginCast(durationMs, direction, nowMs);
  }

  /** As above, aiming along whatever the active camera is looking at. */
  beginCastAlongCamera(durationMs, camera, nowMs) {
    camera.getWorldDirection(this._castAim);
    this.motion.beginCast(durationMs, this._castAim, nowMs);
  }

  /**
   * World position of a hand, for spell emitters.
   * @param {0 | 1} which 0 the left hand, 1 the right
   */
  handPosition(which, out) {
    const hand = which === 0 ? this.bones?.left.hand : this.bones?.right.hand;
    if (hand) hand.getWorldPosition(out);
    else out.set(this.motion.x, this.motion.footY + this.hero.targetHeight * 0.55, this.motion.z);
    return out;
  }

  setVisible(visible) {
    this._visible = Boolean(visible);
    if (this._visible) {
      // Coming back after being hidden, the view has no idea where the player
      // went: adopt the next status as-is instead of differentiating a jump
      // across the world into a sprint.
      this.motion.reset(null);
      this.animator?.reset();
    }
    this._syncGroupVisibility();
  }

  /** Rebase every absolute render-space position the view is holding. */
  shiftWorld(shiftX, shiftZ) {
    this.motion.shiftWorld(shiftX, shiftZ);
    this.group.position.x -= shiftX;
    this.group.position.z -= shiftZ;
  }

  /**
   * Record the renderer and camera to compile with. Compiles now if the model
   * has arrived; otherwise the compile runs when it does. Never waits for the
   * download itself — the first frame does not depend on the hero.
   */
  async prewarm(renderer, camera) {
    this._compileRequest = { renderer, camera };
    if (this.model && !this._compiling) await this._compile();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.animator?.dispose();
    this.contactShadow?.dispose();
    this.scene.remove(this.group, this.shadowRoot);
    if (this.model) {
      this.model.traverse((object) => object.skeleton?.dispose());
      disposeScene(this.model);
    }
    this.model = null;
    this.animator = null;
    this.onDispose?.();
  }
}
