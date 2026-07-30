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
  length,
  max,
  mix,
  normalize,
  oneMinus,
  positionLocal,
  positionWorld,
  pow,
  sign,
  sin,
  smoothstep,
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
import { createSurfaceClassNodes } from './SurfaceMaskNodes.js';
import { assignGrassMaterialData } from '../../render/postprocessing/PostProcessingMaterialData.js';

const TWO_PI = Math.PI * 2;

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
  tuning,
}) {
  // Live-tunable values come through `tuning` as shared uniforms so a slider reaches
  // every chunk without a rebuild; everything else is a constant folded into the
  // graph. `GrassTuning` documents which parameters cannot be live and why.
  const tuned = tuning.uniforms;
  const base = attribute('instanceBase', 'vec3');
  const parameters = attribute('instanceParams', 'vec4');
  // Per-blade data is packed into three vertex buffers, not six: WebGPU allows
  // eight per pipeline and `position` plus the two shared instance attributes
  // already claim three. See createClumpGeometry for the channel layout.
  const bladeAxis = attribute('bladeAxis', 'vec4');
  const bladeCenterPhase = attribute('bladeCenter', 'vec4');
  const bladeShape = attribute('bladeShape', 'vec4');
  const bladeWind = attribute('bladeWind', 'vec4');
  const bladeLean = bladeAxis.xy;
  const bladeFacing = bladeAxis.zw;
  // In metres, and deliberately not scaled by the instance's blade width: the
  // clump's footprint has to hold the field together as a carpet whatever gauge
  // its blades are. See `clumpsFormCarpet`.
  const bladeCenter = bladeCenterPhase.xy;
  const bladeLengthPhase = bladeCenterPhase.z;
  const bladeWidthPhase = bladeCenterPhase.w;
  const bladeTint = bladeShape.xy;
  const bladeCurve = bladeShape.zw;
  const normalizedHeight = positionLocal.y;
  const angle = parameters.z;
  const cosAngle = cos(angle);
  const sinAngle = sin(angle);
  const rotateByClump = (offset) => vec2(
    cosAngle.mul(offset.x).sub(sinAngle.mul(offset.y)),
    sinAngle.mul(offset.x).add(cosAngle.mul(offset.y)),
  );
  // Where the blade stands within its clump. `position` carries only the blade's
  // own half-width, so the width scaling below reaches the silhouette without
  // moving any blade's footing.
  const sampleOffset = rotateByClump(bladeCenter);
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
  const surfaceClass = createSurfaceClassNodes(surface);
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
    }).mul(surfaceClass.grass)
    : float(0);
  const pathWear = stylizedPathWearMask(max(surface.r, naturalTrail), worldXZ, {
    vergeWidth: float(config.path?.vergeWidth ?? 0.45),
    vergeCut: float(config.path?.vergeCut ?? 0.72),
    edgeScale: float(config.path?.edgeScale ?? 0.42),
    edgeWarp: float(config.path?.edgeWarp ?? 0.18),
  });
  const dirt = max(pathWear.wear, stylizedDirtMask(worldXZ, dirtSettings));
  const shrink = oneMinus(dirt.mul(config.dirt.bladeCut))
    .mul(oneMinus(trampleInfluence.mul(config.rocks.flatten)))
    .mul(surfaceClass.landGrass);
  // The blade's rank in its clump's length ordering, uniform in [0, 1).
  const lengthRank = bladeLengthPhase.add(parameters.w).fract();
  // Skewed toward the short end: a flat roll over the configured range puts most
  // blades near the middle of it, which reads as a mown lawn rather than sward.
  // `bladeLengthFraction` in grassLodMath mirrors this and pins the distribution.
  const lengthFraction = lengthRank.pow(tuned.lengthSkew);
  const bladeLength = mix(tuned.minLength, tuned.maxLength, lengthFraction);

  // Per-blade width. `instanceParams.x` is the clump's roll over the configured
  // range, which on its own makes all 96 blades of a clump one gauge and turns the
  // batching unit into visible patches. This spreads them around that roll
  // multiplicatively, the same way `bladeShade` spreads brightness.
  //
  // `widthLengthCorrelation` leans the spread against the blade's own length: a
  // short broad blade and a long slender one both read as grass, a long broad one
  // reads as a leaf. The irrational multiplier keeps the roll decorrelated from
  // the length phase, which already adds the clump seed.
  //
  // It correlates against `lengthRank`, not the skewed fraction. The skew bunches
  // realised lengths at the short end, so correlating against it would bunch widths
  // at the broad end and undo the variation this exists to create. The skew is
  // monotone, so rank still means "longest blade is the narrowest one".
  const widthSpread = tuned.bladeWidthSpread;
  const widthRoll = bladeWidthPhase.add(parameters.w.mul(0.7548776662)).fract();
  const widthMix = mix(widthRoll, oneMinus(lengthRank), tuned.widthLengthCorrelation);
  // `widthScale` is the live stand-in for the baked `minWidth`/`maxWidth` range,
  // which lives in the worker scatter and cannot change without re-paging.
  const bladeWidth = parameters.x
    .mul(tuned.widthScale)
    .mul(float(1).sub(widthSpread.div(2)).add(widthMix.mul(widthSpread)));

  const clumpOffset = rotateByClump(
    bladeCenter.add(vec2(positionLocal.x, positionLocal.z).mul(bladeWidth)),
  );
  const bladeHeight = normalizedHeight.mul(bladeLength).mul(shrink);
  const heightMask = normalizedHeight.mul(shrink).pow(2);

  const leanOffset = rotateByClump(bladeLean).mul(bladeLength).mul(normalizedHeight);
  // The authored silhouette's arc. Unlike `bladeLean` this is not multiplied by
  // height — the profile already carries its own shape up the blade, which is what
  // makes it an arc rather than the straight tilt a lean produces. It also rides on
  // `shrink`, so a blade pressed flat under a rock or cut back over dirt does not
  // keep swinging its tip out sideways at full reach.
  const curveOffset = rotateByClump(bladeCurve).mul(bladeLength).mul(shrink);
  const windDirection = vec2(config.wind.direction[0], config.wind.direction[1]);
  const windPerpendicular = vec2(windDirection.y.negate(), windDirection.x);
  // The gust is a world-space travelling wave, and at the configured frequency its
  // wavelength is on the order of ten metres — so every blade of a sub-metre clump
  // sits on effectively one point of it. Offsetting each blade around the cycle is
  // what stops the field from moving as a single surface.
  const bladePhase = bladeWind.x.mul(TWO_PI);
  const primary = sin(dot(worldXZ, windDirection).mul(tuned.windFrequency)
    .add(time.mul(tuned.windSpeed))
    .add(bladePhase));
  const secondary = sin(dot(worldXZ, windDirection).mul(tuned.windFrequency.mul(2.6))
    .add(time.mul(tuned.windSpeed.mul(1.8)))
    .add(bladePhase.mul(1.7))
    .add(1.3)).mul(0.35);
  const turbulence = sin(dot(worldXZ, windPerpendicular).mul(tuned.windFrequency.mul(1.9))
    .add(time.mul(tuned.windSpeed.mul(0.7)))
    .add(bladePhase.mul(0.6))
    .add(2.6)).mul(tuned.windTurbulence);
  // A stiff blade gives less to the same gust. Phase separation alone still leaves
  // every blade travelling the same distance, which reads as a shear rather than as
  // a sward of blades with different amounts of give.
  const compliance = oneMinus(bladeWind.y.mul(tuned.windStiffnessRange));
  const swing = primary.add(secondary).add(turbulence)
    .mul(tuned.windStrength)
    .mul(compliance)
    .mul(heightMask);
  const lean = tuned.windLean.mul(compliance).mul(heightMask);

  // Tip flutter: fast, small, and confined to the top of the blade. Running it
  // from the root would read as the whole blade vibrating instead of as a tip
  // catching the air, and it rides the perpendicular so it reads as a shiver
  // across the gust rather than more of the same sway.
  const flutter = config.wind.flutter ?? {};
  const flutterWeight = smoothstep(tuned.flutterHeightStart, float(1), normalizedHeight)
    .mul(shrink);
  // Past this range a blade is close enough to sub-pixel that flutter contributes
  // temporal noise rather than motion, so it is faded out instead of drawn. The
  // gust survives — broad movement is what distant grass should still show.
  const cameraDistance = length(worldXZ.sub(cameraPosition.xz));
  const flutterFade = oneMinus(smoothstep(
    tuned.flutterFadeStart,
    tuned.flutterFadeEnd,
    cameraDistance,
  ));
  const flutterWave = sin(dot(worldXZ, windPerpendicular).mul(flutter.frequency ?? 1.9)
    .add(time.mul(flutter.speed ?? 3.4))
    .add(bladePhase.mul(3.1)));
  const flutterOffset = windPerpendicular.mul(
    flutterWave
      .mul(bladeWind.z)
      .mul(tuned.flutterStrength)
      .mul(flutterWeight)
      .mul(flutterFade),
  );
  const windOffset = windDirection.mul(swing.add(lean)).add(flutterOffset);
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
  const baseColor = mix(tuned.colorBottom, tuned.colorTop, gradient);
  const patchColor = mix(tuned.patchLush, tuned.patchDry, patch);
  const variedColor = mix(baseColor, patchColor, tuned.patchStrength);

  // Per-blade colour. `patch` is a world-space noise, so a whole clump — 96
  // blades inside one instance — reads a single value from it and the field
  // ends up one flat green however many blades it carries. These two rolls are
  // baked per blade, offset by the clump's own seed (`parameters.w`) so the 96
  // baked values do not repeat identically in every clump and become a tile of
  // their own. Irrational multipliers keep them decorrelated from the length
  // phase, which already adds `parameters.w`.
  const tintRoll = bladeTint.x.add(parameters.w.mul(0.6180339887)).fract();
  const shadeRoll = bladeTint.y.add(parameters.w.mul(0.3819660113)).fract();
  const tintColor = mix(tuned.variationCool, tuned.variationWarm, tintRoll);
  const tintedColor = mix(variedColor, tintColor, tuned.bladeVariationStrength);
  const shadeSpread = tuned.bladeVariationShade;
  const bladeShade = float(1).sub(shadeSpread.div(2)).add(shadeRoll.mul(shadeSpread));

  // Almost no light reaches the roots of a dense sward. The base→tip gradient
  // cannot supply that on its own here — the per-blade tint above deliberately
  // flattens it — and without it a carpet this dense reads as a painted surface
  // rather than as something with blades standing in it.
  const rootDepth = mix(
    oneMinus(tuned.rootShadeStrength),
    float(1),
    clamp(normalizedHeight.div(max(tuned.rootShadeHeight, float(0.001))), 0, 1),
  );

  const dirtColor = colorNode(config.dirt.color);
  const bladeColor = mix(tintedColor, dirtColor, dirt.mul(config.dirt.bladeBlend))
    .mul(bladeShade)
    .mul(rootDepth)
    .mul(tuned.brightness);

  const viewDirection = normalize(cameraPosition.sub(worldPosition));
  const lightDirection = normalize(sunDirection);
  const backlit = pow(max(dot(viewDirection, lightDirection.negate()), 0), tuned.translucencyPower);
  const tipMask = mix(float(1), normalizedHeight.mul(shrink), tuned.translucencyTipBias);
  // A blade's facing has no vertical component — it is a strip standing on the
  // ground — so only its XZ is stored and the y is restated here as zero.
  const facing = normalize(vec3(
    cos(angle).mul(bladeFacing.x).sub(sin(angle).mul(bladeFacing.y)),
    float(0),
    sin(angle).mul(bladeFacing.x).add(cos(angle).mul(bladeFacing.y)),
  ));
  const edgeMask = oneMinus(abs(dot(facing, lightDirection)));
  // Transmitted light has passed through the blade, so it leaves carrying the
  // blade's own colour. This used to be an independent bright green added on top,
  // which is what pushed sunlit grass toward yellow-white: a shaded root and a pale
  // tip picked up the same absolute glow, so the term dominated wherever the blade
  // was dark. Multiplying by the albedo keeps the hue grass-coloured and keeps
  // roots in shade.
  //
  // `strength` is therefore a ceiling on how far a fully backlit blade may brighten
  // relative to its own albedo, not an absolute radiance — see the config comment.
  //
  // `backlit` is still camera-versus-sun only, with no blade geometry in it, so it
  // remains a whole-field gain that rises together as the walking camera turns into
  // the sun; `edgeMask` is the only per-blade term here. Replacing it needs a
  // visual A/B, so it is left alone rather than guessed at.
  const translucency = bladeColor
    .mul(tuned.translucencyColor)
    .mul(tuned.translucencyStrength)
    .mul(backlit)
    .mul(tipMask)
    .mul(edgeMask);

  // Shading normal. A constant world-up gives every blade in the field the same
  // diffuse response, so however good the silhouettes get the result still reads as
  // one painted surface with grass cut into it — which is exactly what a detailed
  // field looked like once the wash was off it. Blending in the blade's own facing
  // varies the response per blade.
  //
  // World-up stays the majority term on purpose. A fully lateral normal turns the
  // field into hard light/dark striping, and because blade facings are uncorrelated
  // between neighbours it shimmers as blades cross pixels — the same reason this is
  // a per-blade normal and not a normal map. The facing contribution also fades out
  // with distance, where blades approach pixel size and the striping becomes noise.
  //
  // The facing is flipped toward the viewer first. Blades draw `DoubleSide`, so
  // without that the half of the field whose backs are turned would shade dark. The
  // flip is discontinuous where the blade is exactly edge-on, which is where it
  // projects to zero width and cannot be seen.
  const facingTowardView = facing.mul(sign(dot(facing, viewDirection)));
  const normalFade = oneMinus(smoothstep(
    tuned.bladeNormalFadeStart,
    tuned.bladeNormalFadeEnd,
    cameraDistance,
  ));
  const shadingNormal = normalize(mix(
    vec3(0, 1, 0),
    facingTowardView,
    tuned.bladeNormalStrength.mul(normalFade),
  ));

  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = finalPosition;
  // NodeMaterial consumes a view-space normal. Match upstream's explicit
  // `mat3(viewMatrix) * worldUp` instead of treating view +Y as world +Y.
  material.normalNode = shadingNormal.transformDirection(cameraViewMatrix);
  material.colorNode = bladeColor.add(translucency);
  material.opacityNode = surfaceClass.landGrass;
  material.alphaTest = 0.5;
  material.depthWrite = true;
  material.transparent = false;
  return assignGrassMaterialData(material);
}
