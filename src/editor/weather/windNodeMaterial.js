import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  max,
  mix,
  positionGeometry,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4
} from "three/tsl";
const MOD3 = [0.16532, 0.17369, 0.15787];
function hash22(p) {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(MOD3[0], MOD3[1], MOD3[2])));
  const d = dot(vec3(p3.z, p3.x, p3.y), vec3(p3.y, p3.x, p3.z).add(19.19));
  const q = p3.add(d);
  return fract(vec2(q.x.mul(q.y), q.z.mul(q.x))).sub(0.5);
}
function noise22(x) {
  const p = floor(x);
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  return mix(
    mix(hash22(p), hash22(p.add(vec2(1, 0))), f.x),
    mix(hash22(p.add(vec2(0, 1))), hash22(p.add(vec2(1, 1))), f.x),
    f.y
  );
}
function fbm22(x0) {
  let x = x0;
  let r = vec2(0, 0);
  let a = 0.6;
  for (let i = 0; i < 6; i++) {
    r = r.add(noise22(x.mul(a)).div(a));
    a += a;
  }
  return r;
}
function tri(x) {
  return abs(fract(x).sub(0.5));
}
function createWindNodeMaterial() {
  const uCenter = uniform(new THREE.Vector3());
  const uTime = uniform(0);
  const uIntensity = uniform(1);
  const uWindX = uniform(-2.2);
  const uWindZ = uniform(0.36);
  const uColor = uniform(new THREE.Color(12113375));
  const uOpacity = uniform(0.42);
  const aWindOffset = attribute("aWindOffset", "vec4");
  const aWindShape = attribute("aWindShape", "vec4");
  const localPos = positionGeometry;
  const windBase = vec3(uWindX, 0, uWindZ);
  const windLength = max(length(windBase), 1e-3);
  const windDir = windBase.div(windLength);
  const side = vec3(windDir.z.mul(-1), 0, windDir.x);
  const area = max(aWindOffset.w, 1);
  const speed = aWindShape.z.mul(mix(0.25, 1.85, clamp(uIntensity, 0, 1.6)));
  const travel = fract(aWindOffset.y.add(uTime.mul(speed).div(area)));
  const along = float(0.5).sub(travel).mul(area);
  const seed = aWindShape.w;
  const gust = fbm22(vec2(
    along.mul(0.055).add(uTime.mul(0.52)).add(seed.mul(0.013)),
    aWindOffset.z.mul(0.42).add(seed.mul(0.019))
  ));
  const gust2 = fbm22(vec2(
    uTime.mul(0.19).add(seed.mul(0.031)),
    along.mul(0.025).sub(aWindOffset.x.mul(0.018))
  ));
  const pulse = smoothstep(0.1, 0.95, gust.x.mul(0.45).add(gust2.y.mul(0.3)).add(0.48));
  const lowHug = float(1).sub(smoothstep(0.2, 5.2, aWindOffset.z));
  const lift = gust.y.mul(0.95).add(gust2.x.mul(0.32)).mul(mix(0.28, 1.2, lowHug));
  const center = uCenter.add(windDir.mul(along)).add(side.mul(aWindOffset.x.add(gust.x.mul(mix(0.55, 2.25, lowHug))))).add(vec3(0, aWindOffset.z.add(lift), 0));
  const ribbonWidth = aWindShape.x.mul(mix(0.65, 1.25, pulse));
  const worldPosition = center.add(side.mul(localPos.x).mul(ribbonWidth)).add(vec3(0, localPos.y.mul(ribbonWidth).mul(0.42), 0)).add(windDir.mul(localPos.z).mul(ribbonWidth).mul(mix(3.5, 7.5, pulse)));
  const fragment = Fn(() => {
    const p = uv().mul(2).sub(1);
    const body = float(1).sub(smoothstep(0.05, 1, length(vec2(p.x.mul(0.72), p.y.mul(1.35)))));
    const streak = float(1).sub(smoothstep(
      0.04,
      0.34,
      abs(p.y.add(fbm22(vec2(p.x.mul(2.2).add(seed), uTime.mul(0.35))).x.mul(0.22)))
    ));
    const filament = smoothstep(
      0.46,
      0.96,
      tri(p.x.mul(5.5).add(fbm22(vec2(p.y.mul(3).add(seed), uTime.mul(0.22))).y.mul(2.8)))
    );
    const breakup = smoothstep(0.08, 0.8, body.mul(0.72).add(streak.mul(0.24)).add(filament.mul(0.18)));
    const fade = smoothstep(0.02, 0.15, travel).mul(float(1).sub(smoothstep(0.86, 1, travel)));
    const alpha = breakup.mul(body.mul(0.7).add(streak.mul(0.28))).mul(aWindShape.y).mul(mix(0.18, 1.25, pulse)).mul(fade).mul(uOpacity).mul(clamp(uIntensity, 0, 1.6));
    alpha.lessThan(6e-3).discard();
    const pale = vec3(0.82, 0.94, 1);
    const dust = vec3(0.72, 0.68, 0.55);
    let color = mix(uColor, pale, streak.mul(0.42));
    color = mix(color, dust, lowHug.mul(0.32));
    return vec4(color, alpha);
  });
  const material = new MeshBasicNodeMaterial();
  material.name = "weather-wind-node";
  material.positionNode = worldPosition;
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  return {
    material,
    setTime: (time) => {
      uTime.value = time;
    },
    setIntensity: (intensity) => {
      uIntensity.value = intensity;
    },
    setCenter: (center2) => {
      uCenter.value.copy(center2);
    },
    setWind: (x, z) => {
      uWindX.value = x;
      uWindZ.value = z;
    },
    dispose: () => {
      material.dispose();
    }
  };
}
export {
  createWindNodeMaterial
};
