import {
  abs,
  clamp,
  dot,
  floor,
  fract,
  max,
  mix,
  pow,
  sin,
  smoothstep,
  vec2,
} from 'three/tsl';

function hash2(position) {
  const value = fract(position.mul(vec2(127.1, 311.7)));
  const mixed = value.add(dot(value, value.add(19.19)));
  return fract(mixed.x.mul(mixed.y));
}

function noise2(position) {
  const integer = floor(position);
  const fraction = fract(position);
  const curve = fraction.mul(fraction).mul(vec2(3).sub(fraction.mul(2)));
  const north = mix(
    hash2(integer),
    hash2(integer.add(vec2(1, 0))),
    curve.x,
  );
  const south = mix(
    hash2(integer.add(vec2(0, 1))),
    hash2(integer.add(vec2(1, 1))),
    curve.x,
  );
  return mix(north, south, curve.y);
}

function stylizedFbm2Sum(position) {
  const octave0 = noise2(position).mul(0.5);
  const octave1 = noise2(position.mul(2.03).add(vec2(3.1, 7.7))).mul(0.25);
  return octave0.add(octave1);
}

export function stylizedFbm2(position) {
  return stylizedFbm2Sum(position).div(0.75);
}

export function stylizedFbm(position) {
  const lowerOctaves = stylizedFbm2Sum(position);
  const octave2 = noise2(position.mul(4.1209).add(vec2(9.393, 23.331))).mul(0.125);
  const octave3 = noise2(position.mul(8.365427).add(vec2(22.168, 55.062))).mul(0.0625);
  return lowerOctaves.add(octave2).add(octave3).div(0.9375);
}

export function stylizedDirtMask(worldXZ, settings) {
  const position = worldXZ.mul(settings.scale);
  const warp = vec2(
    stylizedFbm(position.add(vec2(11.3, 2.7))),
    stylizedFbm(position.add(vec2(5.9, 17.1))),
  ).sub(0.5).mul(settings.warp);
  const value = stylizedFbm(position.add(warp));
  const threshold = settings.coverage.oneMinus();
  return smoothstep(
    threshold.sub(settings.softness),
    threshold.add(settings.softness),
    value,
  );
}

export function stylizedPatchMask(worldXZ, settings) {
  return pow(
    clamp(stylizedFbm(worldXZ.mul(settings.scale)), 0, 1),
    settings.bias,
  );
}

/**
 * Long, winding world-space trails defined as an iso-contour of a smooth field.
 * Keep this expression in sync with `naturalTrailMath.js`, which is its CPU
 * counterpart for tree, bush and rock clearance.
 */
export function stylizedNaturalTrailMask(worldXZ, settings) {
  const position = worldXZ.mul(settings.scale);
  const warpedX = position.x.add(
    sin(position.y.mul(0.73).add(1.7)).mul(settings.warp),
  );
  const warpedY = position.y.add(
    sin(position.x.mul(0.61).sub(2.3)).mul(settings.warp),
  );
  const field = sin(warpedX).mul(0.52)
    .add(sin(warpedY.mul(0.83).add(1.1)).mul(0.33))
    .add(sin(warpedX.add(warpedY).mul(0.47).sub(0.6)).mul(0.15));
  const contourDistance = abs(field.sub(settings.level));
  return smoothstep(
    settings.width,
    settings.width.add(settings.softness),
    contourDistance,
  ).oneMinus();
}

/**
 * Organic road shoulder shared by terrain, grass and flowers.
 *
 * `pathMask` is the chunk distance field (0 outside a path, 1 on its centre).
 * Warping only the fractional edge preserves the authored tread while breaking
 * up the perfectly smooth distance-field contour. The returned `wear` value is
 * the vegetation suppression mask; using it everywhere is what makes blades
 * shorten into the same verge the terrain paints.
 */
export function stylizedPathWearMask(pathMask, worldXZ, settings) {
  const fractionalEdge = pathMask.mul(pathMask.oneMinus()).mul(4);
  const edgeNoise = stylizedFbm(worldXZ.mul(settings.edgeScale)).sub(0.5);
  const organicMask = clamp(
    pathMask.add(edgeNoise.mul(settings.edgeWarp).mul(fractionalEdge)),
    0,
    1,
  );
  const tread = smoothstep(settings.vergeWidth, 1, organicMask);
  const verge = max(organicMask.sub(tread), 0);
  const wear = clamp(tread.add(verge.mul(settings.vergeCut)), 0, 1);
  return { mask: organicMask, tread, verge, wear };
}
