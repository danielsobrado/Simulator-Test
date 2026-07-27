import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  float,
  Fn,
  max,
  mix,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4
} from "three/tsl";
function createLightningArcNodeMaterial(params) {
  const uTime = uniform(0);
  const uOpacity = uniform(params.opacity);
  const coreColor = vec3(...params.coreColor);
  const edgeColor = vec3(...params.edgeColor);
  const softness = float(Math.max(0.25, params.softness));
  const fragment = Fn(() => {
    const uvN = uv();
    const across = abs(uvN.x.mul(2).sub(1));
    const softEdge = float(1).sub(smoothstep(0, 1, across));
    const filament = pow(max(softEdge, 0), softness);
    const currentRipple = sin(uvN.y.mul(91).sub(uTime.mul(47))).mul(0.055).add(0.945);
    const intensity = filament.mul(currentRipple).mul(uOpacity);
    const hotCenter = pow(filament, 0.42);
    const color = mix(edgeColor, coreColor, hotCenter).mul(currentRipple.add(0.08));
    return vec4(color, clamp(intensity, 0, 1));
  })();
  const material = new MeshBasicNodeMaterial();
  material.name = params.name;
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.FrontSide;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;
  return { material, uTime, uOpacity };
}
export {
  createLightningArcNodeMaterial
};
