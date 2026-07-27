import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  float,
  Fn,
  length,
  max,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { createSpellEffectNoiseNodes } from "./spell_effect_noise.js";
const EARTH_NOISE = {
  hashSeed: 18419.21345,
  fbmFreqMul: 2.04,
  fbmOffset: [6.2, 11.7, 3.4]
};
function radialRing(r, radius, thickness) {
  return float(1).sub(smoothstep(thickness, thickness.mul(2), abs(r.sub(radius))));
}
function createEarthNodeMaterial() {
  const uTime = uniform(0);
  const uProgress = uniform(0);
  const { ridge, billow, gabor2, wavelet2, ringCells2 } = createSpellEffectNoiseNodes(EARTH_NOISE);
  const fragment = Fn(() => {
    const uvN = uv();
    const p = uvN.sub(vec2(0.5, 0.5));
    const r = length(p).mul(2);
    const inside = float(1).sub(smoothstep(0.96, 1, r));
    const castIn = smoothstep(0, 0.1, uProgress);
    const fadeOut = float(1).sub(smoothstep(0.78, 1, uProgress));
    const life = castIn.mul(fadeOut).mul(inside);
    const crackNoise = ridge(vec3(p.x.mul(9), p.y.mul(9), 1));
    const fractureBands = gabor2(p.mul(8), uTime.mul(0.12));
    const cells = ringCells2(p.mul(12));
    const cracks = smoothstep(0.7, 1.03, crackNoise.add(fractureBands.mul(0.18)).add(cells.mul(0.22))).mul(float(1).sub(smoothstep(0.88, 1, r))).mul(life);
    const shockRadius = smoothstep(0, 0.42, uProgress).mul(0.88);
    const shock = radialRing(r, shockRadius, float(0.035)).mul(float(1).sub(smoothstep(0.82, 1, r))).mul(life);
    const wave = wavelet2(p.mul(5), uTime.mul(6));
    const dustVolume = billow(vec3(p.x.mul(3), p.y.mul(3), uTime.mul(1.4)));
    const dustRing = radialRing(r, shockRadius.add(0.08), float(0.16));
    const dust = smoothstep(0.3, 0.78, dustVolume.add(wave.mul(0.18))).mul(dustRing).mul(float(1).sub(smoothstep(0.68, 1, uProgress))).mul(life);
    const ground = vec3(0.16, 0.11, 0.075);
    const crackColor = vec3(0.04, 0.025, 0.016);
    const freshEarth = vec3(0.46, 0.3, 0.16);
    const dustColor = vec3(0.58, 0.44, 0.28);
    let color = mix(ground, freshEarth, max(shock.mul(0.7), cells.mul(0.25).mul(life)));
    color = mix(color, crackColor, cracks);
    color = color.add(dustColor.mul(dust).mul(0.48));
    color = color.add(vec3(0.75, 0.45, 0.18).mul(shock).mul(0.2));
    const alpha = clamp(
      cracks.mul(0.78).add(shock.mul(0.34)).add(dust.mul(0.36)),
      0,
      0.88
    );
    return vec4(color, alpha);
  })();
  const material = new MeshBasicNodeMaterial();
  material.name = "earth-spell-ground-node";
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.blending = THREE.NormalBlending;
  material.toneMapped = false;
  return { material, uTime, uProgress };
}
export {
  createEarthNodeMaterial
};
