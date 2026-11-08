import * as THREE from "three";
import { createStrikeGeometry, markStrikeAttributesDirty } from "./storm_ground_geometry.js";
import { createStormGroundNodeMaterial, createStormGroundShaderMaterial } from "./storm_ground_materials.js";

// A cloud base ~1.5 km up: a bolt's height on screen is what tells its distance.
const CLOUD_BASE = 1500;
// The bolt's foot sits under the eye line so near terrain hides it.
const FOOT_DROP = 40;

/**
 * The visible part of a weather `bolt` from LightningScheduler: one instance on
 * the horizon at the event's bearing and distance, lit only while its CPU flash
 * envelope runs. Sheet lightning has no geometry (the sky flash is enough).
 */
class StormLightningSystem {
  group = new THREE.Group();
  strikeMaterial;
  strikeMesh;
  buffers;
  placed = null;
  constructor(options) {
    this.group.name = "weather-storm";
    this.group.visible = false;
    this.strikeMaterial = options.isWebGpu ? createStormGroundNodeMaterial() : createStormGroundShaderMaterial();
    const strikes = createStrikeGeometry(1);
    this.buffers = strikes.buffers;
    this.buffers.params[3] = 1;
    this.strikeMesh = new THREE.Mesh(strikes.geometry, this.strikeMaterial.material);
    this.strikeMesh.name = "weather-storm-bolt";
    this.strikeMesh.frustumCulled = false;
    this.strikeMesh.renderOrder = 96;
    this.group.add(this.strikeMesh);
    options.scene.add(this.group);
  }
  /**
   * @param {THREE.Vector3} focus the viewer, in render space
   * @param {{ time: number, bearing: number, distance: number } | null} bolt
   * @param {number} flash the bolt's own envelope, 0..1
   */
  update(deltaSeconds, elapsedSeconds, focus, bolt, flash) {
    void deltaSeconds;
    this.group.visible = Boolean(bolt) && flash > 2e-3;
    if (!this.group.visible) return;
    this.strikeMaterial.setTime(elapsedSeconds);
    this.strikeMaterial.setFlash(flash);
    if (this.placed !== bolt) this.place(bolt, focus);
  }
  place(bolt, focus) {
    this.placed = bolt;
    const { center, params } = this.buffers;
    center[0] = focus.x + Math.cos(bolt.bearing) * bolt.distance;
    center[1] = focus.y - FOOT_DROP;
    center[2] = focus.z + Math.sin(bolt.bearing) * bolt.distance;
    params[0] = CLOUD_BASE + FOOT_DROP;
    // Wide enough that the core stays a few pixels thick at any distance.
    params[1] = bolt.distance * 0.025;
    params[2] = (bolt.time * 7.31) % 1;
    markStrikeAttributesDirty([this.strikeMesh.geometry]);
  }
  getStats() {
    return { active: this.group.visible };
  }
  dispose() {
    this.group.removeFromParent();
    this.strikeMesh.geometry.dispose();
    this.strikeMaterial.dispose();
  }
}
export {
  StormLightningSystem
};
