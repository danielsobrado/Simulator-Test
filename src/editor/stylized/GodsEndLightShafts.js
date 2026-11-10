import { frameUniform } from '../../render/FrameUniforms.js';
// Adapted from drusniel-gods-end/src/rendering/CinematicPipeline.js.
import * as THREE from 'three/webgpu';
import {
  Fn, Loop, NodeUpdateType, float, interleavedGradientNoise, nodeObject,
  screenCoordinate, screenUV, step, uniform, vec2, vec4,
} from 'three/tsl';

const RESOLUTION_SCALE = 0.25;
const MASK_TAPS = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];

/** Dormant shafts warm once, then avoid off-screen GPU work. */
class ShaftTarget extends THREE.RTTNode {
  constructor(node, isActive) {
    super(nodeObject(node), null, null, { depthBuffer: false });
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.isActive = isActive;
    this.initialized = false;
    this.setResolutionScale(RESOLUTION_SCALE);
  }

  updateBefore(frame) {
    if (this.initialized && !this.isActive()) return;
    super.updateBefore(frame);
    this.initialized = true;
  }
}

export function shaftNormalization(samples, decay) {
  return Math.abs(1 - decay) < 1e-6 ? 1 / samples : (1 - decay) / (1 - decay ** samples);
}

export function shaftSourceReference(sky, distance, radius = 0.45) {
  return sky * Math.max(0, 1 - distance / radius) ** 2;
}

/** The donor's stable four-depth-tap source mask and jittered radial march. */
export class GodsEndLightShafts {
  constructor({ depth, sunUv, intensity, samples = 32, decay = 0.965, sourceRadius = 0.45 }) {
    this.aspect = uniform(1);
    this.radius = frameUniform(sourceRadius);
    this.disposed = false;
    const active = () => intensity.value > 0;
    this.mask = new ShaftTarget(Fn(() => {
      const texel = vec2(1).div(depth.size(0).toVec2().mul(RESOLUTION_SCALE));
      const sky = float(0).toVar();
      for (const [x, y] of MASK_TAPS) {
        sky.addAssign(step(0.99999, depth.sample(screenUV.add(texel.mul(vec2(x, y))).clamp(0, 1)).r));
      }
      const offset = screenUV.sub(sunUv).mul(vec2(this.aspect, 1));
      const nearSun = offset.length().div(this.radius).oneMinus().max(0);
      return vec4(sky.mul(0.25).mul(nearSun.mul(nearSun)), 0, 0, 1);
    })(), active);
    this.mask.renderTarget.texture.name = 'Gods End shaft source mask';
    this.march = new ShaftTarget(Fn(() => {
      const coord = screenUV.toVar();
      const stepUv = sunUv.sub(coord).div(samples);
      coord.addAssign(stepUv.mul(interleavedGradientNoise(screenCoordinate)));
      const sum = float(0).toVar();
      const weight = float(1).toVar();
      Loop(samples, () => {
        coord.addAssign(stepUv);
        const coverage = step(0, coord.x).mul(step(coord.x, 1))
          .mul(step(0, coord.y)).mul(step(coord.y, 1));
        sum.addAssign(this.mask.sample(coord.clamp(0, 1)).r.mul(weight).mul(coverage));
        weight.mulAssign(decay);
      });
      return vec4(sum.mul(shaftNormalization(samples, decay)), 0, 0, 1);
    })(), active);
    this.march.renderTarget.texture.name = 'Gods End quarter-resolution shafts';
    this.outputNode = this.march.sample(screenUV).r.mul(intensity);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mask.dispose();
    this.march.dispose();
  }
}
