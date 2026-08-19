import { dot, sin, vec2 } from 'three/tsl';

const PRIMARY_DIRECTION = Object.freeze([1.73, 2.31]);
const SECONDARY_DIRECTION = Object.freeze([-2.17, 1.41]);
const TERTIARY_DIRECTION = Object.freeze([0.83, -2.67]);
const WARP_DIRECTION = Object.freeze([0.37, 0.61]);

export function createTerrainOrientedMicroDetail({
  planarMeters,
  scaleMeters,
  strength,
  visibility,
}) {
  const warp = sin(
    dot(planarMeters, vec2(...WARP_DIRECTION)).div(scaleMeters * 4.7),
  ).mul(0.55);
  const primary = sin(
    dot(planarMeters, vec2(...PRIMARY_DIRECTION)).div(scaleMeters).add(warp),
  );
  const secondary = sin(
    dot(planarMeters, vec2(...SECONDARY_DIRECTION))
      .div(scaleMeters * 0.71)
      .sub(warp.mul(0.43)),
  );
  const tertiary = sin(
    dot(planarMeters, vec2(...TERTIARY_DIRECTION))
      .div(scaleMeters * 0.47)
      .add(warp.mul(0.27)),
  );
  return primary.mul(0.52)
    .add(secondary.mul(0.31))
    .add(tertiary.mul(0.17))
    .mul(strength)
    .mul(visibility);
}
