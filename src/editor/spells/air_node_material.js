import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  float,
  floor,
  Fn,
  length,
  max,
  mix,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { createSpellNoiseNodes } from "./spell_noise_nodes.js";
const AIR_NOISE_CONFIG = {
  hashSeed: 92831.73245,
  fbmFreqMul: 2.07,
  fbmOffset: [4.2, 17.3, 8.9]
};
const AIR_TIMING = {
  castInEnd: 0.055,
  castOutStart: 0.72,
  growEnd: 0.18
};
const AIR_BEAM = {
  baseWidth: 0.045,
  tipWidth: 0.205,
  minWidth: 0.022,
  widthPower: 0.72,
  tipNarrowStart: 0.68,
  tipNarrowEnd: 1.06,
  tipNarrowAmount: 0.42
};
const AIR_ALPHA = {
  ribbon: 0.36,
  pressureCore: 0.22,
  handGlow: 0.18,
  handRing: 0.42,
  outerRing: 0.24,
  tipRing: 0.3,
  dust: 0.24,
  max: 0.62
};
const AIR_COLOR = {
  shadow: [0.13, 0.25, 0.3],
  pale: [0.68, 0.93, 1],
  edge: [0.9, 0.99, 1],
  dust: [0.8, 0.76, 0.56],
  haze: [0.42, 0.66, 0.72]
};
function createAirNodeMaterial() {
  const uTime = uniform(0);
  const uProgress = uniform(0);
  const { noise, fbm } = createSpellNoiseNodes(AIR_NOISE_CONFIG);
  const ring = (d, radius, thickness) => float(1).sub(smoothstep(thickness, thickness.mul(2.15), abs(d.sub(radius))));
  const fragment = Fn(() => {
    const uvN = uv();
    const side = uvN.x.sub(0.5);
    const t = uvN.y;
    const p = vec2(side, uvN.y.sub(0.5));
    const castIn = smoothstep(0, AIR_TIMING.castInEnd, uProgress);
    const castOut = float(1).sub(smoothstep(AIR_TIMING.castOutStart, 1, uProgress));
    const life = castIn.mul(castOut);
    const grow = smoothstep(0, AIR_TIMING.growEnd, uProgress);
    const flow = fbm(vec3(t.mul(3.1), uTime.mul(2.8), 5));
    const gust = sin(t.mul(42).sub(uTime.mul(28)).add(flow.mul(5.2))).mul(0.027);
    const crossGust = sin(t.mul(19).add(uTime.mul(17)).add(side.mul(8))).mul(0.012);
    const sideWarp = flow.sub(0.5).mul(0.085).mul(smoothstep(0.05, 0.9, t)).add(gust).add(crossGust);
    const warpedSide = side.add(sideWarp);
    const pathMask = smoothstep(-0.02, 0.06, t).mul(
      float(1).sub(smoothstep(grow.mul(0.96), grow.mul(1.16).add(0.01), t))
    );
    let beamWidth = mix(
      float(AIR_BEAM.baseWidth),
      float(AIR_BEAM.tipWidth),
      pow(max(t, 0), AIR_BEAM.widthPower)
    );
    beamWidth = beamWidth.mul(
      float(1).sub(smoothstep(AIR_BEAM.tipNarrowStart, AIR_BEAM.tipNarrowEnd, t).mul(AIR_BEAM.tipNarrowAmount))
    );
    beamWidth = max(beamWidth, AIR_BEAM.minWidth);
    const q = vec3(warpedSide.div(beamWidth), t.mul(3.7), uTime.mul(2.9));
    const ribbonNoise = fbm(q.mul(vec3(1.15, 1.9, 1)).add(vec3(0, uTime.mul(-5.4), 3.5)));
    const fineNoise = fbm(q.mul(vec3(2.8, 3.5, 1)).add(vec3(11, uTime.mul(-9), 1.7)));
    const normalizedSide = abs(warpedSide).div(beamWidth);
    const hollowBand = float(1).sub(smoothstep(0.045, 0.18, abs(normalizedSide.sub(0.68))));
    const windBody = float(1).sub(normalizedSide).sub(t.mul(0.24)).add(ribbonNoise.mul(0.34)).add(fineNoise.mul(0.1));
    const ribbon = hollowBand.mul(smoothstep(0.06, 0.78, windBody)).mul(pathMask).mul(life);
    const pressureCore = smoothstep(0.54, 1.06, windBody.add(float(1).sub(t).mul(0.14))).mul(pathMask).mul(life).mul(0.38);
    const handDist = length(vec2(side.mul(0.72), t.mul(1.34)));
    const handGlow = float(1).sub(smoothstep(0.035, 0.23, handDist)).mul(life).mul(0.55);
    const handRing = ring(handDist, float(0.135).add(sin(uTime.mul(8.2)).mul(0.014)), float(8e-3)).mul(life);
    const outerRing = ring(handDist, float(0.215).add(sin(uTime.mul(4.8)).mul(0.018)), float(7e-3)).mul(life).mul(0.48);
    const tipDist = length(vec2(warpedSide.mul(1.1), t.sub(0.9).mul(0.78)));
    const tipRing = ring(tipDist, float(0.11).add(uProgress.mul(0.1)), float(9e-3)).mul(smoothstep(0.3, 0.88, t)).mul(life).mul(0.42);
    const dustCell = floor(vec2(warpedSide.add(0.58).mul(96), t.mul(92)));
    const dustNoise = noise(vec3(dustCell.x, dustCell.y, floor(uTime.mul(36))));
    const dust = step(0.988, dustNoise).mul(smoothstep(0.1, 0.96, t)).mul(float(1).sub(smoothstep(0.98, 1.14, t))).mul(life);
    const haze = smoothstep(0.3, 0.76, fbm(vec3(p.x.mul(2.4), p.y.mul(3.2), uTime.mul(2)))).mul(pathMask).mul(life).mul(0.055);
    const shadowAir = vec3(...AIR_COLOR.shadow);
    const paleAir = vec3(...AIR_COLOR.pale);
    const edgeAir = vec3(...AIR_COLOR.edge);
    const dustColor = vec3(...AIR_COLOR.dust);
    let color = mix(shadowAir, paleAir, ribbon.add(pressureCore));
    color = mix(color, edgeAir, pressureCore.mul(0.75).add(handGlow.mul(0.28)));
    color = color.add(edgeAir.mul(handRing.add(outerRing).add(tipRing)).mul(0.82));
    color = color.add(dustColor.mul(dust).mul(0.52));
    color = color.add(vec3(...AIR_COLOR.haze).mul(haze));
    const alpha = clamp(
      ribbon.mul(AIR_ALPHA.ribbon).add(pressureCore.mul(AIR_ALPHA.pressureCore)).add(handGlow.mul(AIR_ALPHA.handGlow)).add(handRing.mul(AIR_ALPHA.handRing)).add(outerRing.mul(AIR_ALPHA.outerRing)).add(tipRing.mul(AIR_ALPHA.tipRing)).add(dust.mul(AIR_ALPHA.dust)).add(haze),
      0,
      AIR_ALPHA.max
    );
    return vec4(color, alpha);
  })();
  const material = new MeshBasicNodeMaterial();
  material.name = "air-spell-node";
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;
  return { material, uTime, uProgress };
}
export {
  createAirNodeMaterial
};
