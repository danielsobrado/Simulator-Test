import {
  abs,
  clamp,
  cos,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  min,
  mix,
  mod,
  sin,
  smoothstep,
  vec2,
  vec4,
  uv
} from "three/tsl";
function hash12(uv2) {
  return fract(cos(mod(dot(uv2, vec2(13.9898, 8.141)), 3.14)).mul(43758.5453));
}
function hash22(uv2) {
  const u = vec2(dot(uv2, vec2(127.1, 311.7)), dot(uv2, vec2(269.5, 183.3)));
  return float(2).mul(fract(sin(u).mul(43758.5453123)));
}
function noise(uv2) {
  const iuv = floor(uv2);
  const fuv = fract(uv2);
  const blurX = smoothstep(0, 1, fuv.x);
  const blurY = smoothstep(0, 1, fuv.y);
  return mix(
    mix(
      dot(hash22(iuv.add(vec2(0, 0))), fuv.sub(vec2(0, 0))),
      dot(hash22(iuv.add(vec2(1, 0))), fuv.sub(vec2(1, 0))),
      blurX
    ),
    mix(
      dot(hash22(iuv.add(vec2(0, 1))), fuv.sub(vec2(0, 1))),
      dot(hash22(iuv.add(vec2(1, 1))), fuv.sub(vec2(1, 1))),
      blurX
    ),
    blurY
  ).add(0.5);
}
function fbm(uv2) {
  let v = float(0);
  let amp = float(0.5);
  let u = uv2;
  for (let i = 0; i < 5; i++) {
    v = v.add(amp.mul(noise(u)));
    u = u.mul(2);
    amp = amp.mul(0.5);
  }
  return v;
}
function hardSplashFragment(age, params, color, opacity, intensity) {
  return Fn(() => {
    const p = uv().mul(2).sub(1);
    const r = length(p);
    r.greaterThan(1.04).discard();
    const radius = mix(0.18, 0.78, smoothstep(0, 0.78, age));
    const ring = float(1).sub(smoothstep(0.018, 0.075, abs(r.sub(radius))));
    const axis = min(abs(p.x), abs(p.y));
    const diag = min(abs(p.x.add(p.y)), abs(p.x.sub(p.y))).mul(0.7);
    const ray = float(1).sub(smoothstep(0.025, 0.13, min(axis, diag))).mul(smoothstep(0.08, 0.24, r)).mul(float(1).sub(smoothstep(0.52, 1, r)));
    const center = float(1).sub(smoothstep(0.02, 0.16, r));
    const fade = float(1).sub(smoothstep(0.58, 1, age)).mul(smoothstep(0, 0.08, age));
    const alpha = ring.mul(0.62).add(ray.mul(0.55)).add(center.mul(0.32)).mul(fade).mul(params.w).mul(opacity).mul(clamp(intensity, 0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(color, alpha);
  })();
}
function waterSplashFragment(age, params, color, opacity, intensity) {
  return Fn(() => {
    const p = uv().mul(2).sub(1);
    const r = length(p);
    r.greaterThan(1.04).discard();
    const radiusA = mix(0.14, 0.86, smoothstep(0, 0.9, age));
    const radiusB = mix(0.04, 0.54, smoothstep(0.14, 0.96, age));
    const ringA = float(1).sub(smoothstep(0.015, 0.055, abs(r.sub(radiusA))));
    const ringB = float(1).sub(smoothstep(0.012, 0.045, abs(r.sub(radiusB))));
    const center = float(1).sub(smoothstep(0.03, 0.13, r)).mul(float(1).sub(smoothstep(0, 0.35, age)));
    const fade = float(1).sub(smoothstep(0.62, 1, age)).mul(smoothstep(0, 0.07, age));
    const alpha = ringA.mul(0.76).add(ringB.mul(0.42)).add(center.mul(0.18)).mul(fade).mul(params.w).mul(opacity).mul(clamp(intensity, 0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(color, alpha);
  })();
}
export {
  fbm,
  hardSplashFragment,
  hash12,
  hash22,
  noise,
  waterSplashFragment
};
