import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  min,
  rtt,
  screenUV,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';

export const SSR_DEPTH_PYRAMID_LEVELS = 8;
export const SSR_BACKGROUND_DEPTH_METERS = 1e6;

function createDepthTarget(node) {
  const target = rtt(node, 1, 1, {
    format: THREE.RedFormat,
    type: THREE.FloatType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
  });
  target.renderTarget.texture.minFilter = THREE.NearestFilter;
  target.renderTarget.texture.magFilter = THREE.NearestFilter;
  target.renderTarget.texture.generateMipmaps = false;
  return target;
}

/**
 * Explicit min-depth pyramid built from the scene pass' linear view depth.
 * The graph only creates this node when SSR is enabled.
 */
export class HierarchicalDepthNode {
  constructor({
    rawDepthNode,
    linearDepthNode,
    resolutionScale = 0.5,
    levelCount = SSR_DEPTH_PYRAMID_LEVELS,
  }) {
    this.resolutionScale = resolutionScale;
    this.levelCount = Math.max(1, levelCount | 0);
    this.levelResolutions = Array.from(
      { length: this.levelCount },
      () => uniform(new THREE.Vector2(1, 1)),
    );
    this.levels = [];
    this.disposed = false;

    const levelZero = Fn(() => {
      const rawDepth = rawDepthNode.sample(screenUV).r;
      const linearDepth = linearDepthNode;
      const geometryDepth = rawDepth.lessThan(0.9999).select(
        linearDepth,
        float(SSR_BACKGROUND_DEPTH_METERS),
      );
      return vec4(geometryDepth);
    })();
    this.levels.push(createDepthTarget(levelZero));

    for (let level = 1; level < this.levelCount; level += 1) {
      const source = this.levels[level - 1];
      const sourceResolution = this.levelResolutions[level - 1];
      const reduced = Fn(() => {
        const texel = vec2(1).div(sourceResolution);
        const halfTexel = texel.mul(0.5);
        const d00 = source.sample(screenUV.add(halfTexel.mul(vec2(-1, -1)))).r;
        const d10 = source.sample(screenUV.add(halfTexel.mul(vec2(1, -1)))).r;
        const d01 = source.sample(screenUV.add(halfTexel.mul(vec2(-1, 1)))).r;
        const d11 = source.sample(screenUV.add(halfTexel.mul(vec2(1, 1)))).r;
        return vec4(min(min(d00, d10), min(d01, d11)));
      })();
      this.levels.push(createDepthTarget(reduced));
    }

    this.outputNode = this.levels[0];
  }

  resize(width, height) {
    let levelWidth = Math.max(1, Math.floor(width * this.resolutionScale));
    let levelHeight = Math.max(1, Math.floor(height * this.resolutionScale));
    for (let level = 0; level < this.levelCount; level += 1) {
      this.levelResolutions[level].value.set(levelWidth, levelHeight);
      this.levels[level].setSize(levelWidth, levelHeight);
      levelWidth = Math.max(1, Math.floor(levelWidth / 2));
      levelHeight = Math.max(1, Math.floor(levelHeight / 2));
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const level of this.levels) {
      level._quadMesh?.material?.dispose();
      level.renderTarget.dispose();
    }
  }
}
