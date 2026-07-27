import * as THREE from "three";
import { Rng, hashCombine, hashString } from '../_clod_shims/seed.js';
import {
  REPOSITION_DISTANCE,
  STRIKE_AREA,
  SURFACE_OFFSET,
  WATER_DEPTH_EPSILON,
  WATER_MASK_EPSILON
} from "./storm_ground_constants.js";
class StormGroundStrikePlacement {
  constructor(samplers, worldCells, seed) {
    this.samplers = samplers;
    this.worldCells = worldCells;
    this.seed = seed;
  }
  samplers;
  worldCells;
  seed;
  reposition(buffers, focus) {
    const cellX = Math.floor(focus.x / REPOSITION_DISTANCE);
    const cellZ = Math.floor(focus.z / REPOSITION_DISTANCE);
    const seed = hashCombine(hashCombine(this.seed, cellX >>> 0), cellZ >>> 0);
    const rng = new Rng(hashCombine(seed, hashString("storm-visible-strikes")));
    const count = buffers.params.length / 4;
    for (let i = 0; i < count; i++) {
      const point = this.findStrikePoint(rng, focus);
      const c = i * 3;
      const p = i * 4;
      if (!point) {
        buffers.center[c] = focus.x;
        buffers.center[c + 1] = focus.y;
        buffers.center[c + 2] = focus.z;
        buffers.normal[c] = 0;
        buffers.normal[c + 1] = 1;
        buffers.normal[c + 2] = 0;
        buffers.params[p] = 0;
        buffers.params[p + 1] = 0;
        buffers.params[p + 2] = rng.float();
        buffers.params[p + 3] = 0;
        continue;
      }
      buffers.center[c] = point.x;
      buffers.center[c + 1] = point.y;
      buffers.center[c + 2] = point.z;
      buffers.normal[c] = point.normal.x;
      buffers.normal[c + 1] = point.normal.y;
      buffers.normal[c + 2] = point.normal.z;
      buffers.params[p] = rng.range(12, 30);
      buffers.params[p + 1] = rng.range(0.34, 0.82);
      buffers.params[p + 2] = rng.float();
      buffers.params[p + 3] = 1;
    }
  }
  findStrikePoint(rng, focus) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const x = focus.x + rng.range(-STRIKE_AREA * 0.5, STRIKE_AREA * 0.5);
      const z = focus.z + rng.range(-STRIKE_AREA * 0.5, STRIKE_AREA * 0.5);
      const water = this.samplers.waterSample(x, z);
      const isWater = water.depth > WATER_DEPTH_EPSILON && water.bodyMask > WATER_MASK_EPSILON;
      if (isWater) {
        return { x, y: water.waterY + SURFACE_OFFSET, z, normal: new THREE.Vector3(0, 1, 0) };
      }
      const [nx, ny, nz] = this.samplers.surfaceNormal(x, z);
      const normal = new THREE.Vector3(nx, ny, nz);
      if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
      else normal.normalize();
      return { x, y: this.samplers.surfaceHeight(x, z) + SURFACE_OFFSET, z, normal };
    }
    return null;
  }
}
export {
  StormGroundStrikePlacement
};
