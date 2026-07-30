import * as THREE from 'three/webgpu';
import {
  Fn,
  clamp,
  dot,
  floor,
  fract,
  mix,
  rtt,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

const VIRTUAL_NOISE_RESOLUTION = 4096;

function smoothstepReference(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function vignetteFactorReference(
  uv,
  {
    intensity = 0,
    innerRadius = 0.35,
    outerRadius = 1.05,
  } = {},
) {
  const dx = uv[0] - 0.5;
  const dy = uv[1] - 0.5;
  const distance = Math.hypot(dx, dy) * 1.414;
  const edge = smoothstepReference(outerRadius, innerRadius, distance);
  return 1 + (edge - 1) * intensity;
}

export function grainReference(colour, noise, intensity = 0) {
  if (intensity === 0) return colour.slice();
  const signedNoise = Number(noise) * 2 - 1;
  return colour.map((channel) => (
    Math.max(0, Math.min(1, channel + signedNoise * intensity))
  ));
}

export function createVignetteNode(sourceNode, settings) {
  const intensity = uniform(settings.intensity);
  const innerRadius = uniform(settings.innerRadius);
  const outerRadius = uniform(settings.outerRadius);
  const outputNode = Fn(() => {
    const distance = screenUV.sub(vec2(0.5)).length().mul(1.414);
    const factor = mix(
      1,
      smoothstep(innerRadius, outerRadius, distance).oneMinus(),
      intensity,
    );
    return vec4(sourceNode.rgb.mul(factor), sourceNode.a);
  })();
  return {
    outputNode,
    updateUniforms(next) {
      intensity.value = next.intensity;
      innerRadius.value = next.innerRadius;
      outerRadius.value = next.outerRadius;
    },
  };
}

/**
 * Final display-space grain. The hash is evaluated in a fixed UV grid, so the
 * pattern is stable across output-size changes and requires no noise texture.
 */
export class FilmGrainNode {
  constructor({ sourceNode, settings }) {
    this.disposed = false;
    this.intensity = uniform(settings.intensity);
    this.timeSeconds = uniform(0);
    this.sourceTarget = rtt(sourceNode, 1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });

    this.outputNode = Fn(() => {
      const colour = this.sourceTarget.sample(screenUV);
      const noiseCell = floor(screenUV.mul(VIRTUAL_NOISE_RESOLUTION));
      const frame = floor(this.timeSeconds.mul(60));
      const noise = fract(
        dot(vec3(noiseCell, frame), vec3(12.9898, 78.233, 37.719))
          .sin()
          .mul(43758.5453),
      );
      const grain = noise.mul(2).sub(1).mul(this.intensity);
      return vec4(clamp(colour.rgb.add(grain), 0, 1), colour.a);
    })();
  }

  updateUniforms(frameState, settings) {
    this.timeSeconds.value = frameState.timeSeconds;
    this.intensity.value = settings.intensity;
  }

  resize(width, height) {
    this.sourceTarget.setSize(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sourceTarget._quadMesh?.material?.dispose();
    this.sourceTarget.renderTarget.dispose();
  }
}
