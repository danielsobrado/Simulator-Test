import { abs, dot, float, floor, fract, sin, smoothstep, vec2, vec3 } from "three/tsl";
import { createSpellNoiseNodes } from "./spell_noise_nodes.js";
const TAU = 6.28318530718;
const HALF_PI = 1.57079632679;
function createSpellEffectNoiseNodes(params) {
  const base = createSpellNoiseNodes(params);
  const ridge = (p) => float(1).sub(abs(base.fbm(p).mul(2).sub(1)));
  const billow = (p) => abs(base.fbm(p).mul(2).sub(1));
  const ign2 = (p) => fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 583715e-8)))));
  const gabor2 = (p, time) => {
    const warp = base.fbm(vec3(p.x.mul(0.72), p.y.mul(0.72), time.mul(0.35))).mul(TAU);
    const a = sin(dot(p, vec2(12.3, 5.1)).add(warp).add(time.mul(3)));
    const b = sin(dot(p, vec2(-4.9, 15.7)).sub(time.mul(1.7)));
    return a.mul(b).mul(0.5).add(0.5);
  };
  const wavelet2 = (p, phase) => {
    const cell = floor(p);
    const local = fract(p).sub(0.5);
    const seed = base.noise(vec3(cell.x, cell.y, 7));
    const angle = seed.mul(TAU);
    const waveCoord = local.x.mul(sin(angle.add(HALF_PI))).add(local.y.mul(sin(angle)));
    const falloff = float(1).sub(smoothstep(0.02, 0.34, dot(local, local)));
    return sin(waveCoord.mul(18).add(phase).add(seed.mul(TAU))).mul(falloff).mul(0.5).add(0.5);
  };
  const ringCells2 = (p) => {
    const cell = floor(p);
    const local = fract(p).sub(0.5);
    const seed = base.noise(vec3(cell.x, cell.y, 13));
    const radius2 = seed.mul(0.075).add(0.018);
    const d2 = dot(local, local);
    const ring = float(1).sub(smoothstep(6e-3, 0.032, abs(d2.sub(radius2))));
    const gate = smoothstep(0.62, 0.98, seed);
    return ring.mul(gate);
  };
  return { ...base, ridge, billow, ign2, gabor2, wavelet2, ringCells2 };
}
export {
  createSpellEffectNoiseNodes
};
