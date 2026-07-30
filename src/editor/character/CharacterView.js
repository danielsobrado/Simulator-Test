/**
 * The drow in the scene.
 *
 * Owns the rig, the figure, the garment solve, the three meshes and the one
 * texture that carries every per-frame transform to the GPU.
 *
 * Ordering inside `update` is load-bearing and was load-bearing in the source
 * too: pose the skeleton, *then* solve the garments against it, *then* upload.
 * Any other order renders the robe one frame behind the body it hangs from,
 * which shows up as the hem lagging through a turn and is the sort of thing that
 * reads as "cheap" without being identifiable.
 *
 * The meshes never move. Their object matrices are the identity for ever and
 * their bounding volumes are a lie, because the skinning matrices are already in
 * render space — the figure carries the drow to the player, not the `Object3D`.
 * That is why they are drawn with `frustumCulled = false`.
 */

import * as THREE from 'three';
import { createRig } from './characterBones.js';
import { createGait } from './gait.js';
import { CharacterFigure } from './CharacterFigure.js';
import { CharacterMotionState } from './CharacterMotionState.js';
import { CharacterTransformTexture } from './CharacterTransformTexture.js';
import { CharacterWind } from './CharacterWind.js';
import { DROW_PROFILE } from './DrowFigureProfile.js';
import { createAnatomy } from './geometry/drowAnatomy.js';
import { buildDrowBody } from './geometry/buildDrowBody.js';
import { buildDrowFur } from './geometry/buildDrowFur.js';
import { buildClothGeometry } from './geometry/buildClothGeometry.js';
import { makeDrowPanels } from './cloth/drowGarments.js';
import { ClothSolver } from './cloth/ClothSolver.js';
import { createDrowPalette } from './materials/DrowPalette.js';
import {
  createDrowBodyMaterial,
  createDrowClothMaterial,
  createDrowFurMaterial,
} from './materials/createDrowMaterials.js';

/** A blink every few seconds, jittered by the shimmer so it is not metronomic. */
const BLINK_PERIOD = 4.6;
const BLINK_WIDTH = 0.022;

export class CharacterView {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {{ heightAt(x: number, z: number): number }} options.terrain
   * @param {THREE.Vector3} options.sunDirection live vector shared with the sky
   * @param {object} [options.config]
   * @param {() => object | null} [options.getWeatherSettings]
   * @param {typeof DROW_PROFILE} [options.profile]
   */
  constructor({
    scene,
    terrain,
    sunDirection,
    config = {},
    getWeatherSettings = null,
    profile = DROW_PROFILE,
  }) {
    this.scene = scene;
    this.config = config;

    this.rig = createRig(profile);
    this.anatomy = createAnatomy(this.rig);
    // One gait object, handed to both. They have to agree on the stride or the
    // feet skate — see `gait.js`.
    this.gait = createGait({
      runSpeed: config.runSpeed ?? 5.4,
      legLengthScale: profile.legLength,
    });
    this.figure = new CharacterFigure(terrain, this.rig, this.gait);
    this.motion = new CharacterMotionState(this.gait);

    this.panels = makeDrowPanels(this.rig, this.anatomy);
    // Constructed before the cloth geometry: it is what assigns each panel its
    // row in the texture, and the geometry bakes those rows in per vertex.
    this.transforms = new CharacterTransformTexture(this.panels);

    this.solver = new ClothSolver(
      this.panels,
      terrain,
      new CharacterWind(getWeatherSettings),
    );
    this.solver.capsuleScale = profile.torsoRadius;

    this.palette = createDrowPalette(config.palette ?? null);
    const materialOptions = {
      transformTexture: this.transforms.texture,
      palette: this.palette,
      sunDirection,
    };

    this.bodyGeometry = buildDrowBody(this.rig, this.anatomy);
    this.clothGeometry = buildClothGeometry(this.panels);
    this.furGeometry = buildDrowFur(this.rig, this.anatomy);

    this.bodyMaterial = createDrowBodyMaterial(materialOptions);
    this.clothMaterial = createDrowClothMaterial(materialOptions);
    this.furMaterial = createDrowFurMaterial(materialOptions);

    this.bodyMesh = this._mesh('drow-body', this.bodyGeometry, this.bodyMaterial, true);
    this.clothMesh = this._mesh('drow-cloth', this.clothGeometry, this.clothMaterial, true);
    // Fur casts no shadow. Its shadow lands inside the hood's own, an
    // alpha-tested twenty-two-shell depth pass is not cheap, and what it would
    // contribute is a slightly fuzzier edge on a shadow already an order of
    // magnitude softer than that.
    this.furMesh = this._mesh('drow-fur', this.furGeometry, this.furMaterial, false);

    this.group = new THREE.Group();
    this.group.name = 'drow-character';
    this.group.matrixAutoUpdate = false;
    this.group.add(this.bodyMesh, this.clothMesh, this.furMesh);
    scene.add(this.group);

    this._needsSettle = true;
    this._eyeSeconds = 0;
    this._castAim = new THREE.Vector3();
    this._visible = true;
    this.setVisible(config.enabled !== false);
  }

  _mesh(name, geometry, material, castShadow) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  get visible() {
    return this._visible;
  }

  get stats() {
    const of = (g) => g.userData.characterStats ?? { vertices: 0, triangles: 0 };
    const body = of(this.bodyGeometry);
    const cloth = of(this.clothGeometry);
    const fur = of(this.furGeometry);
    return Object.freeze({
      triangles: body.triangles + cloth.triangles + fur.triangles,
      vertices: body.vertices + cloth.vertices + fur.vertices,
      clothNodes: this.panels.reduce((sum, p) => sum + p.count, 0),
    });
  }

  /**
   * @param {number} dt seconds
   * @param {ReturnType<import('../player/PlayerController.js').PlayerController['getStatus']>} status
   * @param {number} nowMs
   */
  update(dt, status, nowMs) {
    if (!this._visible) return;

    this.motion.update(dt, status, nowMs);
    // Feet first: the stance has to be right *before* the pose is solved, or the
    // first frame at a new spawn is solved against plants still at the origin.
    if (this._needsSettle) this.figure.resetStance(this.motion);
    this.figure.update(dt, this.motion);

    if (this._needsSettle) {
      // Drop every garment straight onto its kinematic target. The panels are
      // authored in bind space at the world origin, and letting them fall from
      // there to wherever the player actually spawned takes a second of visible
      // flapping — behind the loading screen if we are lucky, in shot if not.
      this.solver.settle(this.figure);
      this._needsSettle = false;
    }

    this.solver.update(dt, this.figure, this.motion);
    this.transforms.upload(this.figure);
    this._updateEyeGlow(dt);
  }

  /**
   * Slow shimmer plus an occasional blink.
   *
   * On the CPU, as one uniform, rather than as a time node in the graph: it is
   * two sines and a triangle wave, it is the same number for every pixel of both
   * eyes, and keeping it here means the material has nothing time-varying in it
   * that a test would have to drive.
   */
  _updateEyeGlow(dt) {
    this._eyeSeconds += dt;
    const t = this._eyeSeconds;
    const shimmer = 0.88 + 0.12 * Math.sin(t * 1.7) * Math.sin(t * 0.41 + 1.2);
    const phase = (t % BLINK_PERIOD) / BLINK_PERIOD;
    const blink = Math.max(0, 1 - Math.abs(phase - BLINK_WIDTH) / BLINK_WIDTH);
    const glow = shimmer * (1 - 0.95 * blink);
    for (const material of [this.bodyMaterial, this.clothMaterial]) {
      const uniforms = material.userData.drowUniforms;
      if (uniforms) uniforms.eyeGlow.value = glow;
    }
  }

  /**
   * Raise the arms into a cast. Called by the spell runtime so the pose starts on
   * the same frame the effect does.
   */
  beginCast(durationMs, direction, nowMs) {
    this.motion.beginCast(durationMs, direction, nowMs);
  }

  /** As above, aiming along whatever the active camera is looking at. */
  beginCastAlongCamera(durationMs, camera, nowMs) {
    camera.getWorldDirection(this._castAim);
    this.motion.beginCast(durationMs, this._castAim, nowMs);
  }

  /** World position of a hand, for spell emitters. */
  handPosition(which, out) {
    this.figure.handPosition(which, out, 0);
    return out;
  }

  setVisible(visible) {
    this._visible = Boolean(visible);
    this.group.visible = this._visible;
    if (this._visible) {
      // Coming back after being hidden, the figure has no idea where the player
      // went. Re-settling is cheaper and far less ugly than letting the garments
      // catch up across the world.
      this._needsSettle = true;
      this.motion.reset(null);
    }
  }

  /** Rebase every absolute render-space position the character is holding. */
  shiftWorld(shiftX, shiftZ) {
    this.figure.shiftWorld(shiftX, shiftZ);
    this.motion.shiftWorld(shiftX, shiftZ);
    this.solver.shiftWorld(shiftX, shiftZ);
  }

  /**
   * Compile the three pipelines before the first frame.
   *
   * WebGPU compiles a pipeline the first time a material/geometry pair is
   * actually drawn, and that compile blocks in the GPU process. Left to happen on
   * demand it lands as a hitch on whichever frame the player first enters walk
   * mode, which is the worst possible moment for it.
   */
  async prewarm(renderer, camera) {
    const wasVisible = this.group.visible;
    this.group.visible = true;
    try {
      // The scene, not the group. `compileAsync`'s third argument is a *scene*
      // to take the background, environment and fog from, not a subtree to
      // restrict compilation to — hand it a `Group` and it dereferences
      // properties a Group does not have.
      await renderer.compileAsync(this.scene, camera);
    } finally {
      this.group.visible = wasVisible;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.bodyGeometry.dispose();
    this.clothGeometry.dispose();
    this.furGeometry.dispose();
    this.bodyMaterial.dispose();
    this.clothMaterial.dispose();
    this.furMaterial.dispose();
    this.transforms.dispose();
  }
}
