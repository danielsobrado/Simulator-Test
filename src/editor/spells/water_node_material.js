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
function createWaterNodeMaterial() {
  const uTime = uniform(0);
  const uProgress = uniform(0);
  const { noise, fbm } = createSpellNoiseNodes({
    hashSeed: 43758.5453123,
    fbmFreqMul: 2.02,
    fbmOffset: [9.7, 5.1, 12.4]
  });
  const ring = (d, radius, thickness) => float(1).sub(smoothstep(thickness, thickness.mul(2), abs(d.sub(radius))));
  const fragment = Fn(() => {
    const uvN = uv();
    const side = uvN.x.sub(0.5);
    const t = uvN.y;
    const p = vec2(side, uvN.y.sub(0.5));
    const castIn = smoothstep(0, 0.08, uProgress);
    const castOut = float(1).sub(smoothstep(0.76, 1, uProgress));
    const life = castIn.mul(castOut);
    const grow = smoothstep(0, 0.24, uProgress);
    const flow = fbm(vec3(t.mul(2.6), uTime.mul(2.1), 6));
    const wave = sin(t.mul(28).sub(uTime.mul(18)).add(flow.mul(4))).mul(0.018);
    const sideWarp = flow.sub(0.5).mul(0.1).mul(smoothstep(0.06, 0.82, t)).add(wave);
    const warpedSide = side.add(sideWarp);
    const pathMask = smoothstep(-0.02, 0.07, t).mul(
      float(1).sub(smoothstep(grow.mul(0.98), grow.mul(1.18).add(0.01), t))
    );
    let streamWidth = mix(float(0.035), float(0.18), pow(max(t, 0), 0.78));
    streamWidth = streamWidth.mul(float(1).sub(smoothstep(0.72, 1.05, t).mul(0.35)));
    streamWidth = max(streamWidth, 0.018);
    const q = vec3(warpedSide.div(streamWidth), t.mul(3.4), uTime.mul(2.6));
    const ribbonNoise = fbm(q.mul(vec3(1, 1.7, 1)).add(vec3(0, uTime.mul(-4.5), 2)));
    const foamNoise = fbm(q.mul(vec3(2.4, 3.2, 1)).add(vec3(8, uTime.mul(-7.2), 4)));
    const body = float(1).sub(abs(warpedSide).div(streamWidth)).sub(t.mul(0.3)).add(ribbonNoise.mul(0.42));
    const stream = smoothstep(0.08, 0.78, body).mul(pathMask).mul(life);
    const core = smoothstep(0.58, 1.16, body.add(float(1).sub(t).mul(0.2))).mul(pathMask).mul(life);
    const foam = smoothstep(0.7, 1.05, foamNoise.add(body.mul(0.28))).mul(pathMask).mul(life).mul(smoothstep(0.1, 0.85, t));
    const handDist = length(vec2(side.mul(0.72), t.mul(1.35)));
    const handGlow = float(1).sub(smoothstep(0.04, 0.25, handDist)).mul(life);
    const waterRing = ring(handDist, float(0.14).add(sin(uTime.mul(6)).mul(0.015)), float(0.01)).mul(life);
    const outerRing = ring(handDist, float(0.22).add(sin(uTime.mul(3.4)).mul(0.018)), float(8e-3)).mul(life).mul(0.45);
    const dropletCell = floor(vec2(warpedSide.add(0.55).mul(92), t.mul(78)));
    const dropletNoise = noise(vec3(dropletCell.x, dropletCell.y, floor(uTime.mul(30))));
    const droplets = step(0.985, dropletNoise).mul(smoothstep(0.16, 0.95, t)).mul(float(1).sub(smoothstep(1, 1.16, t))).mul(life);
    const mist = smoothstep(0.28, 0.72, fbm(vec3(p.x.mul(2.2), p.y.mul(3), uTime.mul(1.8)))).mul(pathMask).mul(life).mul(0.1);
    const deep = vec3(0.02, 0.24, 0.5);
    const water = vec3(0.05, 0.62, 0.95);
    const foamColor = vec3(0.72, 0.96, 1);
    const glow = vec3(0.3, 0.86, 1);
    let color = mix(deep, water, stream);
    color = mix(color, foamColor, core.mul(0.55).add(foam.mul(0.65)));
    color = color.add(glow.mul(handGlow.mul(0.42).add(waterRing.mul(0.55)).add(outerRing.mul(0.35))));
    color = color.add(foamColor.mul(droplets).mul(0.55));
    color = color.add(vec3(0.16, 0.48, 0.72).mul(mist));
    const alpha = clamp(
      stream.mul(0.58).add(core.mul(0.32)).add(foam.mul(0.36)).add(handGlow.mul(0.3)).add(waterRing.mul(0.44)).add(outerRing.mul(0.25)).add(droplets.mul(0.3)).add(mist),
      0,
      0.88
    );
    return vec4(color, alpha);
  })();
  const material = new MeshBasicNodeMaterial();
  material.name = "water-spell-node";
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
  createWaterNodeMaterial
};
