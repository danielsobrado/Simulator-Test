import * as THREE from 'three/webgpu';
import {
  attribute,
  cos,
  dot,
  float,
  max,
  min,
  mix,
  oneMinus,
  positionLocal,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import {
  stylizedDirtMask,
  stylizedNaturalTrailMask,
  stylizedPathWearMask,
} from './StylizedNoiseNodes.js';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

export function createStylizedFlowerMaterial({
  textures,
  surfaceMaskTexture,
  chunkCenter,
  chunkWorldSize,
  time,
  config,
}) {
  const base = attribute('instanceBase', 'vec3');
  const parameters = attribute('instanceParams', 'vec4');
  const flowerUv = vec2(
    uv().x.mul(0.5).add(parameters.w.mul(0.5)),
    uv().y,
  );
  const localUv = vec2(
    base.x.div(chunkWorldSize).add(0.5),
    float(0.5).sub(base.z.div(chunkWorldSize)),
  );
  const worldXZ = base.xz.add(chunkCenter);
  const surface = texture(surfaceMaskTexture, localUv);
  const naturalTrailConfig = config.path?.naturalTrail;
  const naturalTrail = naturalTrailConfig?.enabled
    ? stylizedNaturalTrailMask(worldXZ, {
      scale: float(naturalTrailConfig.scale),
      level: float(naturalTrailConfig.level),
      width: float(naturalTrailConfig.width),
      softness: float(naturalTrailConfig.softness),
      warp: float(naturalTrailConfig.warp),
    }).mul(surface.g)
    : float(0);
  const pathWear = stylizedPathWearMask(max(surface.r, naturalTrail), worldXZ, {
    vergeWidth: float(config.path?.vergeWidth ?? 0.45),
    vergeCut: float(config.path?.vergeCut ?? 0.72),
    edgeScale: float(config.path?.edgeScale ?? 0.42),
    edgeWarp: float(config.path?.edgeWarp ?? 0.18),
  });
  const dirt = max(pathWear.wear, stylizedDirtMask(worldXZ, {
    scale: float(config.dirt.scale),
    coverage: float(config.dirt.coverage),
    softness: float(config.dirt.softness),
    warp: float(config.dirt.warp),
  }));
  const alive = oneMinus(step(config.flowers.dirtMax, dirt));

  const angle = parameters.x;
  const size = parameters.y;
  const rotationX = cos(angle).mul(positionLocal.x).sub(sin(angle).mul(positionLocal.z));
  const rotationZ = sin(angle).mul(positionLocal.x).add(cos(angle).mul(positionLocal.z));
  const localHeight = positionLocal.y.mul(size);
  const heightMask = localHeight.mul(localHeight);
  const windDirection = vec2(config.wind.direction[0], config.wind.direction[1]);
  const windPerpendicular = vec2(windDirection.y.negate(), windDirection.x);
  const primary = sin(dot(worldXZ, windDirection).mul(config.wind.frequency)
    .add(time.mul(config.wind.speed)));
  const secondary = sin(dot(worldXZ, windDirection).mul(config.wind.frequency * 2.6)
    .add(time.mul(config.wind.speed * 1.8))
    .add(1.3)).mul(0.35);
  const turbulence = sin(dot(worldXZ, windPerpendicular).mul(config.wind.frequency * 1.9)
    .add(time.mul(config.wind.speed * 0.7))
    .add(2.6)).mul(config.wind.turbulence);
  const wind = windDirection.mul(
    primary.add(secondary).add(turbulence)
      .mul(config.flowers.windStrength)
      .mul(heightMask)
      .add(float(config.flowers.windLean).mul(heightMask)),
  );
  const bend = sin(localHeight.mul(config.flowers.bendFrequency)
    .add(time.mul(config.wind.speed * 0.4))
    .add(worldXZ.x.mul(0.7)))
    .mul(config.flowers.bendAmplitude)
    .mul(heightMask);
  const finalPosition = vec3(
    base.x.add(rotationX.mul(size)).add(wind.x).add(bend),
    base.y.add(localHeight),
    base.z.add(rotationZ.mul(size)).add(wind.y),
  ).mul(vec3(1, alive, 1));

  const mask = texture(textures.mask, flowerUv).r;
  const zones = texture(textures.zones, flowerUv).rgb;
  const gradient = smoothstep(0, 0.7, texture(textures.gradient, flowerUv).r);
  const isRed = max(0, zones.r.sub(max(zones.g, zones.b)));
  const isGreen = max(0, zones.g.sub(max(zones.r, zones.b)));
  const isBlue = max(0, zones.b.sub(max(zones.r, zones.g)));
  const isWhite = min(zones.r, min(zones.g, zones.b));
  const total = isRed.add(isGreen).add(isBlue).add(isWhite);
  const weighted = colorNode(config.flowers.colorR).mul(isRed)
    .add(colorNode(config.flowers.colorG).mul(isGreen))
    .add(colorNode(config.flowers.colorB).mul(isBlue))
    .add(colorNode(config.flowers.colorStem).mul(isWhite));
  const palette = mix(
    colorNode(config.flowers.colorStem),
    weighted.div(max(total, 0.001)),
    step(0.01, total),
  );
  const flowerColor = mix(
    colorNode(config.color.bottom),
    palette,
    gradient,
  ).mul(config.flowers.brightness);

  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = finalPosition;
  material.normalNode = vec3(0, 1, 0);
  material.colorNode = flowerColor;
  material.opacityNode = mask.mul(alive);
  material.alphaTest = 0.5;
  material.transparent = false;
  return material;
}
