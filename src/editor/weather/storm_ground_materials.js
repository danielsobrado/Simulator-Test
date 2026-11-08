import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { assignWeatherNodeOutput } from './weather_node_output.js';
import { hash21, noise2 } from '../stylized/SnowNoiseNodes.js';
import {
  abs,
  attribute,
  clamp,
  cross,
  float,
  Fn,
  min,
  mix,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4
} from "three/tsl";
// The bolt's brightness comes from the CPU (LightningScheduler.boltFlash), so the
// flash, the sky and thunder all agree on when it happened.
const NOISE_GLSL = (
  /* glsl */
  `
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 iuv = floor(p);
  vec2 fuv = fract(p);
  vec2 blur = smoothstep(0.0, 1.0, fuv);
  float a = dot(hash22(iuv + vec2(0.0, 0.0)), fuv - vec2(0.0, 0.0));
  float b = dot(hash22(iuv + vec2(1.0, 0.0)), fuv - vec2(1.0, 0.0));
  float c = dot(hash22(iuv + vec2(0.0, 1.0)), fuv - vec2(0.0, 1.0));
  float d = dot(hash22(iuv + vec2(1.0, 1.0)), fuv - vec2(1.0, 1.0));
  return mix(mix(a, b, blur.x), mix(c, d, blur.x), blur.y) + 0.5;
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < BOLT_OCTAVES; i++) {
    value += amplitude * noise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

float godotLightningField(vec2 p, float seed, float time, float xSize, float ySize, float width) {
  vec2 modifiedUv = p;
  modifiedUv.y *= ySize;
  modifiedUv.x *= xSize;
  modifiedUv.x -= 0.5;
  modifiedUv += fbm(modifiedUv + vec2(time * 3.0 + seed * 17.0));
  float dist = abs(modifiedUv.x);
  return width / max(dist, 0.012);
}
`
);
// Distant bolts are a few pixels wide; finer octaves are invisible.
const BOLT_OCTAVES = 5;
const STORM_VERTEX = (
  /* glsl */
  `
attribute vec3 aLightningCenter;
attribute vec3 aLightningNormal;
attribute vec4 aLightningParams;
varying vec2 vUv;
varying float vSeed;

void main() {
  vec3 n = normalize(aLightningNormal);
  vec3 ref = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(ref, n));
  vec3 bitangent = normalize(cross(n, tangent));
  vec3 widthAxis = position.z < 0.5 ? tangent : bitangent;
  float lean = sin(aLightningParams.z * 17.0) * 0.22;
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.24) + widthAxis * lean);
  vec3 worldPosition = aLightningCenter
    + widthAxis * position.x * aLightningParams.y
    + up * position.y * aLightningParams.x;

  vUv = uv;
  vSeed = aLightningParams.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`
);
const STORM_FRAGMENT = (
  /* glsl */
  `
uniform float uTime;
uniform float uFlash;
uniform float uEmissionPower;
uniform vec3 uEffectColor;
varying vec2 vUv;
varying float vSeed;

#define BOLT_OCTAVES ${BOLT_OCTAVES}
${NOISE_GLSL}

void main() {
  if (uFlash < 0.002) discard;

  vec2 p = 2.0 * vUv - 1.0;
  float field = godotLightningField(p, vSeed, uTime, 1.15, 4.0, 0.055);
  float body = smoothstep(0.72, 2.8, field);
  float glow = smoothstep(0.12, 1.25, field);
  float alpha = min((body + glow * 0.42) * uFlash, 1.0) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
  if (alpha < 0.003) discard;

  vec3 color = uEffectColor * (body * 2.5 + glow * 0.95) * uEmissionPower;
  gl_FragColor = vec4(color, alpha);
}
`
);
const EFFECT_COLOR = new THREE.Color(0.55, 0.62, 1);
function finishMaterial(material) {
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  // Bolts are kilometres off; storm fog would swallow them.
  material.fog = false;
  return material;
}
function createStormGroundShaderMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uEmissionPower: { value: 3.2 },
    uEffectColor: { value: EFFECT_COLOR.clone() }
  };
  const material = finishMaterial(new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STORM_VERTEX,
    fragmentShader: STORM_FRAGMENT
  }));
  material.name = "weather-storm-bolt-shader";
  return {
    material,
    setTime: (time) => {
      uniforms.uTime.value = time;
    },
    setFlash: (flash) => {
      uniforms.uFlash.value = flash;
    },
    dispose: () => material.dispose()
  };
}
function createStormGroundNodeMaterial() {
  const uTime = uniform(0);
  const uFlash = uniform(0);
  const uEmissionPower = uniform(2);
  const uEffectColor = uniform(EFFECT_COLOR.clone());
  const aCenter = attribute("aLightningCenter", "vec3");
  const aNormal = attribute("aLightningNormal", "vec3");
  const aParams = attribute("aLightningParams", "vec4");
  const pos = positionGeometry;
  const n = normalize(aNormal);
  const ref = abs(n.y).lessThan(0.95).select(vec3(0, 1, 0), vec3(1, 0, 0));
  const tangent = normalize(cross(ref, n));
  const bitangent = normalize(cross(n, tangent));
  const widthAxis = pos.z.lessThan(0.5).select(tangent, bitangent);
  const up = normalize(mix(vec3(0, 1, 0), n, 0.24).add(widthAxis.mul(sin(aParams.z.mul(17)).mul(0.22))));
  const worldPosition = aCenter.add(widthAxis.mul(pos.x).mul(aParams.y)).add(up.mul(pos.y).mul(aParams.x));
  // Godot-style bolt: a vertical line displaced by gradient-noise FBM that
  // scrolls with time, lit as 1/distance with a per-frame flicker.
  const fragment = Fn(() => {
    uFlash.lessThan(2e-3).discard();
    const p = uv();
    const q = vec2(p.x.mul(2).sub(1).sub(0.5), p.y.mul(2).sub(1).mul(4));
    const drift = q.add(uTime.mul(3)).add(aParams.z.mul(17));
    let fbm = float(0);
    for (let octave = 0, amplitude = 0.5, frequency = 1; octave < BOLT_OCTAVES; octave++, amplitude *= 0.5, frequency *= 2) {
      fbm = fbm.add(noise2(drift.mul(frequency)).add(0.5).mul(amplitude));
    }
    const dist = abs(q.x.add(fbm)).max(0.012);
    // Seeded from the strike, so a replayed storm flickers the same way.
    const flicker = mix(0.04, 0.09, hash21(vec2(aParams.z.mul(97), uTime.mul(30).floor())));
    // Clamped so the core cannot blow out the bloom.
    const glow = min(flicker.div(dist), 2.5);
    const fadeTop = float(1).sub(smoothstep(0.85, 1, p.y));
    const alpha = min(glow, 1).mul(clamp(uFlash, 0, 1)).mul(fadeTop);
    alpha.lessThan(3e-3).discard();
    return vec4(uEffectColor.mul(glow).mul(uEmissionPower), alpha);
  });
  const material = new MeshBasicNodeMaterial();
  material.name = "weather-storm-bolt-node";
  material.positionNode = worldPosition;
  assignWeatherNodeOutput(material, fragment());
  finishMaterial(material);
  return {
    material,
    setTime: (time) => {
      uTime.value = time;
    },
    setFlash: (flash) => {
      uFlash.value = flash;
    },
    dispose: () => material.dispose()
  };
}
export {
  createStormGroundNodeMaterial,
  createStormGroundShaderMaterial
};
