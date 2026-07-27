import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  float,
  Fn,
  length,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { createSpellEffectNoiseNodes } from "./spell_effect_noise.js";
const EARTH_DUST_NOISE = {
  hashSeed: 32991.43117,
  fbmFreqMul: 2.01,
  fbmOffset: [10.2, 3.7, 14.4]
};
function createEarthDustNodeMaterial(params) {
  const uTime = uniform(0);
  const uProgress = uniform(0);
  const { billow, ridge, wavelet2 } = createSpellEffectNoiseNodes(EARTH_DUST_NOISE);
  const seed = float(params.seed);
  const opacity = float(params.opacity);
  const fragment = Fn(() => {
    const uvN = uv();
    const p = uvN.sub(vec2(0.5, 0.5));
    const r = length(p).mul(2);
    const castIn = smoothstep(0, 0.1, uProgress);
    const fadeOut = float(1).sub(smoothstep(0.55, 1, uProgress));
    const life = castIn.mul(fadeOut);
    const expansion = mix(float(0.42), float(1.12), smoothstep(0, 0.78, uProgress));
    const softDisc = float(1).sub(smoothstep(expansion.mul(0.54), expansion, r));
    const centerVoid = smoothstep(0.05, 0.24, r);
    const drift = vec2(uTime.mul(0.17).add(seed.mul(0.11)), uTime.mul(-0.1).add(seed.mul(0.07)));
    const coarse = billow(vec3(p.x.mul(2.4).add(seed), p.y.mul(2.2).sub(seed.mul(0.4)), uTime.mul(0.58)));
    const rolling = ridge(vec3(p.x.mul(4.2).add(drift.x), p.y.mul(3.6).add(drift.y), uTime.mul(0.82).add(seed)));
    const wisps = wavelet2(p.mul(3.4).add(drift), uTime.mul(4.2).add(seed));
    const breakup = smoothstep(0.2, 0.95, coarse.mul(0.55).add(rolling.mul(0.3)).add(wisps.mul(0.18)));
    const rimLift = smoothstep(0.16, 0.72, r).mul(float(1).sub(smoothstep(0.76, 1.12, r)));
    const alpha = clamp(
      softDisc.mul(centerVoid).mul(breakup.mul(0.72).add(0.2)).mul(rimLift.mul(0.44).add(0.58)).mul(life).mul(opacity),
      0,
      0.72
    );
    const darkDust = vec3(0.22, 0.16, 0.1);
    const warmDust = vec3(0.56, 0.43, 0.28);
    const paleDust = vec3(0.78, 0.67, 0.48);
    let color = mix(darkDust, warmDust, coarse);
    color = mix(color, paleDust, wisps.mul(0.35).add(uProgress.mul(0.18)));
    color = color.add(vec3(0.18, 0.11, 0.05).mul(rolling).mul(0.2));
    return vec4(color, alpha);
  })();
  const material = new MeshBasicNodeMaterial();
  material.name = "earth-spell-dust-node";
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
  createEarthDustNodeMaterial
};
