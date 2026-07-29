import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  cos,
  cross,
  float,
  Fn,
  fract,
  length,
  max,
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
import { fbm, hash12, hardSplashFragment, waterSplashFragment } from "./rain_node_material_helpers.js";
import { RAIN_IMPACT_PROFILE } from "./rain_constants.js";
function makeMat(name, frag, pos) {
  const m = new MeshBasicNodeMaterial();
  m.name = name;
  if (pos) m.positionNode = pos;
  m.fragmentNode = frag;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = !!pos;
  m.side = THREE.DoubleSide;
  return m;
}
function makeHandle(mat, uTime, uIntensity, uCenter, uWindX, uWindZ) {
  return {
    material: mat,
    setTime: (t) => {
      uTime.value = t;
    },
    setIntensity: (v) => {
      uIntensity.value = v;
    },
    setCenter: uCenter ? (c) => {
      uCenter.value.copy(c);
    } : () => void 0,
    setWind: uWindX ? (x, z) => {
      uWindX.value = x;
      uWindZ.value = z;
    } : () => void 0,
    dispose: () => {
      mat.dispose();
    }
  };
}
function createRainNodeMaterial() {
  const uC = uniform(new THREE.Vector3()), uT = uniform(0), uI = uniform(1);
  const uWx = uniform(-1.05), uWz = uniform(0.28);
  const uTop = uniform(20), uBot = uniform(-12);
  const uCol = uniform(new THREE.Color(12180735)), uOp = uniform(0.46);
  const aOff = attribute("aRainOffset", "vec4"), aShp = attribute("aRainShape", "vec4");
  const rPos = positionGeometry;
  const h = max(uTop.sub(uBot), 1e-3);
  const fall = fract(aOff.y.sub(uT.mul(aOff.w).mul(max(uI, 0.08)).div(h)));
  const sd = normalize(vec3(uWx, -8, uWz));
  const side = normalize(cross(sd, vec3(0, 1, 0)).add(vec3(1e-4, 0, 0)));
  const head = uC.add(vec3(aOff.x.add(uWx.mul(float(1).sub(fall)).mul(0.35)), uBot.add(fall.mul(h)), aOff.z.add(uWz.mul(float(1).sub(fall)).mul(0.35))));
  const wPos = head.add(side.mul(rPos.x).mul(aShp.y)).add(sd.mul(rPos.y).mul(aShp.x));
  const frag = Fn(() => {
    const p = uv();
    const alpha = smoothstep(0, 0.55, float(1).sub(abs(p.x.mul(2).sub(1)))).mul(smoothstep(0, 0.2, p.y).mul(float(1).sub(smoothstep(0.82, 1, p.y)))).mul(smoothstep(0.02, 0.16, fall).mul(float(1).sub(smoothstep(0.84, 1, fall)))).mul(uOp).mul(clamp(uI, 0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(uCol, alpha);
  });
  return makeHandle(makeMat("weather-rain-node", frag(), wPos), uT, uI, uC, uWx, uWz);
}
function createSnowNodeMaterial() {
  const uC = uniform(new THREE.Vector3()), uT = uniform(0), uI = uniform(1);
  const uWx = uniform(-0.62), uWz = uniform(0.21);
  const uTop = uniform(18), uBot = uniform(-8);
  const uCol = uniform(new THREE.Color(15857663)), uOp = uniform(0.76);
  const aOff = attribute("aSnowOffset", "vec4"), aShp = attribute("aSnowShape", "vec4");
  const sPos = positionGeometry;
  const h = max(uTop.sub(uBot), 1e-3);
  const fall = fract(aOff.y.sub(uT.mul(aOff.w).mul(max(uI, 0.05)).div(h)));
  const gust = sin(uT.mul(float(0.7).add(aShp.w.mul(0.6))).add(aShp.w.mul(6.28318530718)));
  const center = uC.add(vec3(aOff.x.add(uWx.mul(float(1).sub(fall)).mul(1.8)).add(aShp.z.mul(gust)), uBot.add(fall.mul(h)), aOff.z.add(uWz.mul(float(1).sub(fall)).mul(1.8)).add(cos(uT.mul(0.8).add(aShp.w.mul(12.56637061436))).mul(aShp.z).mul(0.55))));
  const wPos = center.add(sPos.mul(aShp.x));
  const frag = Fn(() => {
    const p = uv().mul(2).sub(1);
    const r = length(p);
    r.greaterThan(1.05).discard();
    const core = float(1).sub(smoothstep(0.18, 0.92, r));
    const arms = float(1).sub(smoothstep(0.035, 0.16, min(min(abs(p.x), abs(p.y)), min(abs(p.x.add(p.y)), abs(p.x.sub(p.y))).mul(0.72)))).mul(float(1).sub(smoothstep(0.24, 1, r)));
    const sparkle = float(0.88).add(sin(aShp.w.mul(37).add(p.x.mul(7)).add(p.y.mul(11))).mul(0.12));
    const fade = smoothstep(0.03, 0.18, fall).mul(float(1).sub(smoothstep(0.86, 1, fall)));
    const alpha = core.mul(0.82).add(arms.mul(0.46)).mul(float(1).sub(smoothstep(0.76, 1.05, r))).mul(sparkle).mul(aShp.y).mul(fade).mul(uOp).mul(clamp(uI, 0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(uCol, alpha);
  });
  return makeHandle(makeMat("weather-snow-node", frag(), wPos), uT, uI, uC, uWx, uWz);
}
function createSandstormNodeMaterial() {
  const uC = uniform(new THREE.Vector3()), uT = uniform(0), uI = uniform(1);
  const uWx = uniform(-1.8), uWz = uniform(0.24);
  const uCol = uniform(new THREE.Color(12162903)), uOp = uniform(0.84);
  const aOff = attribute("aSandOffset", "vec4"), aShp = attribute("aSandShape", "vec4");
  const sPos = positionGeometry;
  const wb = vec3(uWx, 0, uWz);
  const wl = max(length(wb), 1e-3);
  const wd = wb.div(wl);
  const sd = vec3(wd.z.mul(-1), 0, wd.x);
  const travel = fract(aOff.y.add(uT.mul(aShp.z).mul(max(uI, 0.05)).div(max(aOff.w, 1e-3))));
  const along = float(0.5).sub(travel).mul(aOff.w);
  const waveA = sin(along.mul(0.48).add(aOff.x.mul(0.82)).add(uT.mul(2.35)).add(aShp.w.mul(0.011)));
  const waveB = sin(along.mul(0.19).sub(aOff.x.mul(0.43)).sub(uT.mul(1.18)).add(aShp.w.mul(0.017)));
  const wave = smoothstep(0.08, 0.92, waveA.mul(0.35).add(waveB.mul(0.25)).add(0.5));
  const gust = sin(uT.mul(float(1.25).add(aShp.w.mul(9e-4))).add(aShp.w)).mul(mix(0.35, 1, wave));
  const lift = sin(uT.mul(1.65).add(aShp.w.mul(1.37))).mul(mix(0.025, 0.11, wave));
  const center = uC.add(wd.mul(along)).add(sd.mul(aOff.x.add(gust.mul(0.42)))).add(vec3(0, aOff.z.add(lift), 0));
  const wPos = center.add(sd.mul(sPos.x).mul(aShp.x).mul(1.18)).add(vec3(0, sPos.y.mul(aShp.x).mul(0.52), 0)).add(wd.mul(sPos.z).mul(aShp.x).mul(2.65));
  const frag = Fn(() => {
    const p = uv().mul(2).sub(1);
    const d = length(vec3(p.x.mul(0.82), p.y.mul(1.18), 0));
    d.greaterThan(1.05).discard();
    const body = float(1).sub(smoothstep(0.12, 0.92, d));
    const soft = float(1).sub(smoothstep(0, 0.46, d));
    const fade = smoothstep(0.02, 0.12, travel).mul(float(1).sub(smoothstep(0.88, 1, travel))).mul(mix(0.16, 1.18, wave));
    const alpha = body.mul(0.6).add(soft.mul(0.24)).mul(float(0.64).add(sin(aShp.w.mul(11.7).add(p.x.mul(31)).add(p.y.mul(17))).mul(0.36))).mul(aShp.y).mul(fade).mul(uOp).mul(clamp(uI, 0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(mix(uCol, vec3(0.93, 0.79, 0.54), soft.mul(0.35)), alpha);
  });
  return makeHandle(makeMat("weather-sandstorm-node", frag(), wPos), uT, uI, uC, uWx, uWz);
}
function createSandstormHazeNodeMaterial() {
  const uT = uniform(0), uI = uniform(1);
  const uCol = uniform(new THREE.Color(16768149)), uOp = uniform(0.11);
  const frag = Fn(() => {
    const p = uv();
    const edge = smoothstep(0, 0.12, p.x).mul(float(1).sub(smoothstep(0.88, 1, p.x))).mul(smoothstep(0, 0.1, p.y)).mul(float(1).sub(smoothstep(0.86, 1, p.y)));
    const haze = smoothstep(0.52, 1, sin(p.x.mul(8).add(uT.mul(0.42))).mul(0.5).add(0.5).mul(0.42).add(sin(p.y.mul(18).add(uT.mul(0.55)).add(sin(p.x.mul(8).add(uT.mul(0.42))).mul(0.5).add(0.5).mul(1.7))).mul(0.5).add(0.5).mul(0.42)).add(sin(p.x.add(p.y).mul(15).sub(uT.mul(0.36))).mul(0.5).add(0.5).mul(0.16)));
    const alpha = haze.mul(edge).mul(uOp).mul(clamp(uI, 0, 1.6));
    alpha.lessThan(3e-3).discard();
    return vec4(uCol, alpha);
  });
  return makeHandle(makeMat("weather-sandstorm-haze-node", frag()), uT, uI);
}
function createStormNodeMaterial() {
  const uT = uniform(0), uI = uniform(1);
  const uEC = uniform(new THREE.Color(0.3, 0.3, 1)), uMC = uniform(new THREE.Color(1, 1, 1));
  const frag = Fn(() => {
    const p = uv();
    const muv = vec2(p.x.mul(2).sub(1), p.y.mul(2).sub(1).mul(4));
    const dist = abs(muv.x.sub(0.5).add(fbm(vec2(muv.x.sub(0.5), muv.y).add(uT.mul(3)))));
    const flicker = mix(0, 0.05, hash12(vec2(uT)));
    const fc = uEC.mul(flicker).div(max(dist, 1e-3));
    const alpha = min(fc.r, 1).mul(clamp(uI, 0, 1.6));
    alpha.lessThan(3e-3).discard();
    return vec4(fc.mul(uMC), alpha);
  });
  return makeHandle(makeMat("weather-storm-node", frag()), uT, uI);
}
function createSplashNodeMaterial(kind) {
  const profile = RAIN_IMPACT_PROFILE[kind];
  const uT = uniform(0), uRate = uniform(profile.rate), uI = uniform(1);
  const uCol = uniform(new THREE.Color(kind === "hard" ? 14282751 : 10479359)), uOp = uniform(profile.opacity);
  const aC = attribute("aSplashCenter", "vec3"), aN = attribute("aSplashNormal", "vec3");
  const aP = attribute("aSplashParams", "vec4"), sPos = positionGeometry;
  const age = fract(uT.mul(uRate).add(aP.y));
  const grow = smoothstep(0, 0.72, age);
  const scale = aP.x.mul(mix(0.16, 1, grow));
  const c_ = cos(aP.z), s_ = sin(aP.z);
  const local = vec3(sPos.x.mul(c_).sub(sPos.y.mul(s_)), sPos.x.mul(s_).add(sPos.y.mul(c_)), 0);
  const n = normalize(aN);
  const ref = abs(n.y).lessThan(0.95).select(vec3(0, 1, 0), vec3(1, 0, 0));
  const tangent = normalize(cross(ref, n));
  const bitangent = normalize(cross(n, tangent));
  const wPos = aC.add(tangent.mul(local.x).add(bitangent.mul(local.y)).mul(scale)).add(n.mul(profile.surfaceOffset));
  const frag = kind === "hard" ? hardSplashFragment(age, aP, uCol, uOp, uI) : waterSplashFragment(age, aP, uCol, uOp, uI);
  return makeHandle(makeMat(`weather-${kind}-splash-node`, frag, wPos), uT, uI);
}
export {
  createRainNodeMaterial,
  createSandstormHazeNodeMaterial,
  createSandstormNodeMaterial,
  createSnowNodeMaterial,
  createSplashNodeMaterial,
  createStormNodeMaterial
};
