import * as THREE from 'three/webgpu';
import {
  Fn,
  clamp,
  max,
  min,
  rtt,
  screenUV,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';

export function contrastSharpenReference(
  { centre, left, right, up, down },
  amount,
) {
  const k = amount * 0.32;
  return centre.map((channel, index) => {
    const localMin = Math.min(
      channel,
      left[index],
      right[index],
      up[index],
      down[index],
    );
    const localMax = Math.max(
      channel,
      left[index],
      right[index],
      up[index],
      down[index],
    );
    const sharpened = channel * (1 + 4 * k)
      - (left[index] + right[index] + up[index] + down[index]) * k;
    return Math.max(localMin, Math.min(localMax, sharpened));
  });
}

/**
 * Five-tap contrast-adaptive sharpening in display/output colour space.
 */
export class ContrastSharpenNode {
  constructor({ sourceNode, settings }) {
    this.disposed = false;
    this.amount = uniform(settings.amount);
    this.resolution = uniform(new THREE.Vector2(1, 1));
    this.sourceTarget = rtt(sourceNode, 1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });

    this.outputNode = Fn(() => {
      const texel = vec2(1).div(this.resolution);
      const centre = this.sourceTarget.sample(screenUV).rgb;
      const left = this.sourceTarget
        .sample(screenUV.sub(vec2(texel.x, 0)))
        .rgb;
      const right = this.sourceTarget
        .sample(screenUV.add(vec2(texel.x, 0)))
        .rgb;
      const up = this.sourceTarget
        .sample(screenUV.add(vec2(0, texel.y)))
        .rgb;
      const down = this.sourceTarget
        .sample(screenUV.sub(vec2(0, texel.y)))
        .rgb;
      const localMin = min(
        centre,
        min(left, min(right, min(up, down))),
      );
      const localMax = max(
        centre,
        max(left, max(right, max(up, down))),
      );
      const k = this.amount.mul(0.32);
      const sharpened = centre
        .mul(k.mul(4).add(1))
        .sub(left.add(right).add(up).add(down).mul(k));
      return vec4(clamp(sharpened, localMin, localMax), 1);
    })();
  }

  updateUniforms(settings) {
    this.amount.value = settings.amount;
  }

  resize(width, height) {
    this.resolution.value.set(width, height);
    this.sourceTarget.setSize(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sourceTarget._quadMesh?.material?.dispose();
    this.sourceTarget.renderTarget.dispose();
  }
}
