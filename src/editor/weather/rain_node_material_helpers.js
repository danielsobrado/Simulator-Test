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
    const young = smoothstep(0, 0.05, age).mul(float(1).sub(smoothstep(0.28, 0.48, age)));
    const radius = mix(0.06, 0.42, smoothstep(0, 0.36, age));
    const ring = float(1).sub(smoothstep(0.025, 0.07, abs(r.sub(radius))));
    const axis = min(abs(p.x), abs(p.y));
    const diag = min(abs(p.x.add(p.y)), abs(p.x.sub(p.y))).mul(0.7);
    const ray = float(1).sub(smoothstep(0.025, 0.13, min(axis, diag))).mul(smoothstep(0.04, 0.1, r)).mul(float(1).sub(smoothstep(0.24, 0.46, r)));
    const center = float(1).sub(smoothstep(0.015, 0.1, r)).mul(float(1).sub(smoothstep(0.08, 0.24, age)));
    const alpha = ring.mul(0.34).add(ray.mul(0.28)).add(center.mul(0.38)).mul(young).mul(params.w).mul(opacity).mul(clamp(intensity, 0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(color, alpha);
  })();
}
function waterSplashFragment(age, params, color, opacity, intensity) {
  return Fn(() => {
    const p = uv().mul(2).sub(1);
    const r = length(p);
    r.greaterThan(1.04).discard();
    const rippleAge = clamp(age.sub(0.08).div(0.78), 0, 1);
    const rippleRadius = mix(0.1, 0.9, smoothstep(0, 1, rippleAge));
    const rippleWidth = mix(0.018, 0.052, rippleAge);
    const ripple = float(1).sub(smoothstep(rippleWidth, rippleWidth.mul(2.2), abs(r.sub(rippleRadius))))
      .mul(smoothstep(0.06, 0.16, age))
      .mul(float(1).sub(smoothstep(0.7, 0.98, age)));
    const crownRadius = mix(0.05, 0.24, smoothstep(0, 0.2, age));
    const crown = float(1).sub(smoothstep(0.02, 0.065, abs(r.sub(crownRadius))))
      .mul(float(1).sub(smoothstep(0.16, 0.3, age)));
    const center = float(1).sub(smoothstep(0.02, 0.09, r))
      .mul(float(1).sub(smoothstep(0.06, 0.18, age)));
    const alpha = ripple.mul(0.52).add(crown.mul(0.32)).add(center.mul(0.22))
      .mul(params.w).mul(opacity).mul(clamp(intensity, 0, 1.6));
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
