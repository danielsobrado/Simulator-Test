import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  cameraViewMatrix,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  max,
  mix,
  normalize,
  oneMinus,
  positionLocal,
  positionWorld,
  pow,
  sin,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import {
  stylizedDirtMask,
  stylizedNaturalTrailMask,
  stylizedPatchMask,
  stylizedPathWearMask,
} from './StylizedNoiseNodes.js';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

export function createStylizedGrassMaterial({
  surfaceMaskTexture,
  trampleTexture,
  chunkCenter,
  chunkWorldSize,
  time,
  sunDirection,
  config,
}) {
  const base = attribute('instanceBase', 'vec3');
  const parameters = attribute('instanceParams', 'vec4');
  // Per-blade data is packed into three vertex buffers, not six: WebGPU allows
  // eight per pipeline and `position` plus the two shared instance attributes
  // already claim three. See createClumpGeometry for the channel layout.
  const bladeAxis = attribute('bladeAxis', 'vec4');
  const bladeCenterPhase = attribute('bladeCenter', 'vec3');
  const bladeShape = attribute('bladeShape', 'vec4');
  const bladeLean = bladeAxis.xy;
  const bladeFacing = bladeAxis.zw;
  const bladeCenter = bladeCenterPhase.xy;
  const bladeLengthPhase = bladeCenterPhase.z;
  const bladeTint = bladeShape.xy;
  const bladeCurve = bladeShape.zw;
  const normalizedHeight = positionLocal.y;
  const angle = parameters.z;
  const localX = cos(angle).mul(positionLocal.x).sub(sin(angle).mul(positionLocal.z));
  const localZ = sin(angle).mul(positionLocal.x).add(cos(angle).mul(positionLocal.z));
  const clumpOffset = vec2(localX, localZ).mul(parameters.x);
  const sampleOffset = vec2(
    cos(angle).mul(bladeCenter.x).sub(sin(angle).mul(bladeCenter.y)),
    sin(angle).mul(bladeCenter.x).add(cos(angle).mul(bladeCenter.y)),
  ).mul(parameters.x);
  const localUv = vec2(
    base.x.add(sampleOffset.x).div(chunkWorldSize).add(0.5),
    float(0.5).sub(base.z.add(sampleOffset.y).div(chunkWorldSize)),
  );
  // Upstream scatters individual instances, so dirt, colour patches and wind are
  // sampled once per blade. The streamed renderer batches blades into clumps;
  // `bladeCenter` restores that per-blade sample instead of making a whole clump
  // disappear, recolour or sway as one visible unit.
  const worldXZ = base.xz.add(sampleOffset).add(chunkCenter);
  const surface = texture(surfaceMaskTexture, localUv);
  const trampleSample = texture(trampleTexture, localUv);
  const trampleDirection = trampleSample.xy.mul(2).sub(1);
  const trampleInfluence = trampleSample.z;

  const dirtSettings = {
    scale: float(config.dirt.scale),
    coverage: float(config.dirt.coverage),
    softness: float(config.dirt.softness),
    warp: float(config.dirt.warp),
  };
  const patchSettings = {
    scale: float(config.patch.scale),
    bias: float(config.patch.bias),
  };
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
  const dirt = max(pathWear.wear, stylizedDirtMask(worldXZ, dirtSettings));
  const shrink = oneMinus(dirt.mul(config.dirt.bladeCut))
    .mul(oneMinus(trampleInfluence.mul(config.rocks.flatten)));
  const bladeLength = mix(
    float(config.grass.minLength),
    float(config.grass.maxLength),
    bladeLengthPhase.add(parameters.w).fract(),
  );
  const bladeHeight = normalizedHeight.mul(bladeLength).mul(shrink);
  const heightMask = normalizedHeight.mul(shrink).pow(2);

  const leanOffset = vec2(
    cos(angle).mul(bladeLean.x).sub(sin(angle).mul(bladeLean.y)),
    sin(angle).mul(bladeLean.x).add(cos(angle).mul(bladeLean.y)),
  ).mul(bladeLength).mul(normalizedHeight);
  // The authored silhouette's arc. Unlike `bladeLean` this is not multiplied by
  // height — the profile already carries its own shape up the blade, which is what
  // makes it an arc rather than the straight tilt a lean produces. It also rides on
  // `shrink`, so a blade pressed flat under a rock or cut back over dirt does not
  // keep swinging its tip out sideways at full reach.
  const curveOffset = vec2(
    cos(angle).mul(bladeCurve.x).sub(sin(angle).mul(bladeCurve.y)),
    sin(angle).mul(bladeCurve.x).add(cos(angle).mul(bladeCurve.y)),
  ).mul(bladeLength).mul(shrink);
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
  const swing = primary.add(secondary).add(turbulence)
    .mul(config.wind.strength)
    .mul(heightMask);
  const lean = float(config.wind.lean).mul(heightMask);
  const windOffset = windDirection.mul(swing.add(lean));
  const rockOffset = trampleDirection
    .mul(config.rocks.bend)
    .mul(trampleInfluence)
    .mul(heightMask);

  const finalXZ = base.xz.add(clumpOffset).add(curveOffset).add(leanOffset)
    .add(windOffset).add(rockOffset);
  const finalPosition = vec3(finalXZ.x, base.y.add(bladeHeight), finalXZ.y);
  const worldPosition = positionWorld;

  const gradient = pow(clamp(
    normalizedHeight.sub(config.color.gradientStart)
      .div(Math.max(0.001, config.color.gradientEnd - config.color.gradientStart)),
    0,
    1,
  ), config.color.gradientPower);
  const patch = stylizedPatchMask(worldXZ, patchSettings);
  const baseColor = mix(
    colorNode(config.color.bottom),
    colorNode(config.color.top),
    gradient,
  );
  const patchColor = mix(
    colorNode(config.patch.lush),
    colorNode(config.patch.dry),
    patch,
  );
  const variedColor = mix(baseColor, patchColor, config.patch.strength);

  // Per-blade colour. `patch` is a world-space noise, so a whole clump — 96
  // blades inside one instance — reads a single value from it and the field
  // ends up one flat green however many blades it carries. These two rolls are
  // baked per blade, offset by the clump's own seed (`parameters.w`) so the 96
  // baked values do not repeat identically in every clump and become a tile of
  // their own. Irrational multipliers keep them decorrelated from the length
  // phase, which already adds `parameters.w`.
  const variation = config.color.bladeVariation ?? {};
  const tintRoll = bladeTint.x.add(parameters.w.mul(0.6180339887)).fract();
  const shadeRoll = bladeTint.y.add(parameters.w.mul(0.3819660113)).fract();
  const tintColor = mix(
    colorNode(variation.cool ?? config.color.bottom),
    colorNode(variation.warm ?? config.color.top),
    tintRoll,
  );
  const tintedColor = mix(variedColor, tintColor, variation.strength ?? 0);
  const shadeSpread = variation.shade ?? 0;
  const bladeShade = float(1 - shadeSpread / 2).add(shadeRoll.mul(shadeSpread));

  // Almost no light reaches the roots of a dense sward. The base→tip gradient
  // cannot supply that on its own here — the per-blade tint above deliberately
  // flattens it — and without it a carpet this dense reads as a painted surface
  // rather than as something with blades standing in it.
  const rootShade = config.color.rootShade ?? {};
  const rootDepth = mix(
    float(1 - (rootShade.strength ?? 0)),
    float(1),
    clamp(normalizedHeight.div(Math.max(0.001, rootShade.height ?? 0.35)), 0, 1),
  );

  const dirtColor = colorNode(config.dirt.color);
  const bladeColor = mix(tintedColor, dirtColor, dirt.mul(config.dirt.bladeBlend))
    .mul(bladeShade)
    .mul(rootDepth)
    .mul(config.color.brightness);

  const viewDirection = normalize(cameraPosition.sub(worldPosition));
  const lightDirection = normalize(sunDirection);
  const backlit = pow(max(dot(viewDirection, lightDirection.negate()), 0), config.translucency.power);
  const tipMask = mix(float(1), normalizedHeight.mul(shrink), config.translucency.tipBias);
  // A blade's facing has no vertical component — it is a strip standing on the
  // ground — so only its XZ is stored and the y is restated here as zero.
  const facing = normalize(vec3(
    cos(angle).mul(bladeFacing.x).sub(sin(angle).mul(bladeFacing.y)),
    float(0),
    sin(angle).mul(bladeFacing.x).add(cos(angle).mul(bladeFacing.y)),
  ));
  const edgeMask = oneMinus(abs(dot(facing, lightDirection)));
  const translucency = colorNode(config.translucency.color)
    .mul(config.translucency.strength)
    .mul(backlit)
    .mul(tipMask)
    .mul(edgeMask);

  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = finalPosition;
  // NodeMaterial consumes a view-space normal. Match upstream's explicit
  // `mat3(viewMatrix) * worldUp` instead of treating view +Y as world +Y.
  material.normalNode = vec3(0, 1, 0).transformDirection(cameraViewMatrix);
  material.colorNode = bladeColor.add(translucency);
  material.depthWrite = true;
  material.transparent = false;
  return material;
}
