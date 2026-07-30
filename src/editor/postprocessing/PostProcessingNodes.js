import * as THREE from 'three/webgpu';
import {
  Fn,
  clamp,
  float,
  getViewPosition,
  mix,
  screenUV,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

export function gradeHdr(inputNode, exposureNode, contrastNode, saturationNode) {
  return Fn(() => {
    const exposed = inputNode.rgb.mul(exposureNode).max(vec3(0));
    const contrasted = exposed
      .div(0.18)
      .max(vec3(1e-5))
      .pow(contrastNode)
      .mul(0.18);
    const luminance = contrasted.dot(vec3(0.2126, 0.7152, 0.0722));
    const saturated = mix(vec3(luminance), contrasted, saturationNode);
    return vec4(saturated, inputNode.a);
  })();
}

export function vignette(inputNode, intensityNode, innerRadiusNode, outerRadiusNode) {
  return Fn(() => {
    const distance = screenUV.sub(vec2(0.5)).length().mul(1.41421356237);
    const falloff = smoothstep(outerRadiusNode, innerRadiusNode, distance);
    const factor = mix(float(1), falloff, intensityNode);
    return vec4(inputNode.rgb.mul(factor), inputNode.a);
  })();
}

export function contrastAdaptiveSharpen(textureNode, amountNode) {
  return Fn(() => {
    const texel = vec2(1).div(textureNode.size());
    const center = textureNode.sample(screenUV);
    const left = textureNode.sample(screenUV.sub(vec2(texel.x, 0))).rgb;
    const right = textureNode.sample(screenUV.add(vec2(texel.x, 0))).rgb;
    const down = textureNode.sample(screenUV.sub(vec2(0, texel.y))).rgb;
    const up = textureNode.sample(screenUV.add(vec2(0, texel.y))).rgb;
    const localMin = center.rgb.min(left).min(right).min(down).min(up);
    const localMax = center.rgb.max(left).max(right).max(down).max(up);
    const strength = amountNode.mul(0.32);
    const sharpened = center.rgb
      .mul(strength.mul(4).add(1))
      .sub(left.add(right).add(down).add(up).mul(strength));
    return vec4(clamp(sharpened, localMin, localMax), center.a);
  })();
}

export function exponentialHeightFog({
  depthTexture,
  cameraProjectionInverse,
  cameraMatrixWorld,
  density,
  baseHeight,
  heightFalloff,
  maxDistance,
}) {
  return Fn(() => {
    const depth = depthTexture.sample(screenUV).x;
    const viewPosition = getViewPosition(screenUV, depth, cameraProjectionInverse);
    const worldPosition = cameraMatrixWorld.mul(vec4(viewPosition, 1)).xyz;
    const distance = viewPosition.length().min(maxDistance);
    const relativeHeight = worldPosition.y.sub(baseHeight).max(0);
    const localDensity = density.mul(relativeHeight.mul(heightFalloff).negate().exp());
    return float(1).sub(localDensity.mul(distance).negate().exp()).clamp(0, 1);
  })();
}

export function debugDepth(depthTexture) {
  return vec4(vec3(depthTexture.sample(screenUV).x), 1);
}

export function debugVelocity(velocityTexture) {
  const velocity = velocityTexture.sample(screenUV).xy.abs().mul(8).clamp(0, 1);
  return vec4(velocity, 0, 1);
}

export function toneMappingConstant(mode) {
  if (mode === 'aces') return THREE.ACESFilmicToneMapping;
  if (mode === 'neutral') return THREE.NeutralToneMapping;
  if (mode === 'none') return THREE.NoToneMapping;
  return THREE.AgXToneMapping;
}
