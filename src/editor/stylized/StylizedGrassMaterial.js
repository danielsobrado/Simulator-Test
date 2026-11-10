import { frameUniform } from '../../render/FrameUniforms.js';
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
  min,
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
  wrapNoiseOrigin,
} from './StylizedNoiseNodes.js';
import { createSurfaceClassNodes } from './SurfaceMaskNodes.js';
import { sampleWorldWindCanonical, windWaveCoordinates } from '../weather/wind/worldWindState.js';
import { groundDeformationNode } from './deformation/groundDeformationNode.js';
import { assignGrassMaterialData } from '../../render/postprocessing/PostProcessingMaterialData.js';
import {
  GRASS_LOD_PRESENCE_WINDOW,
  GRASS_LOD_WIDEN_DEFAULTS,
} from './grassLodMath.js';
import { applyJungleMist } from './ambient/jungleMistOutput.js';

const TWO_PI = Math.PI * 2;

/** The donor's straw fringe: dry tips on the grass beside a track. */
const DEFAULT_PATH_FRINGE_STRENGTH = 0.55;
const DEFAULT_PATH_FRINGE_COLOR = '#c2ad62';

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
  lodCoverage,
}) {
  // Live-tunable values come through `tuning` as shared uniforms so a slider reaches
  // every chunk without a rebuild; everything else is a constant folded into the
  // graph. `GrassTuning` documents which parameters cannot be live and why.
  const tuned = tuning.uniforms;
  // LOD thinning tuning, from the same defaults `grassLodWiden` and
  // `grassLodPresence` use, so the two implementations cannot drift apart.
  const coverageSettings = config.grass?.lod?.coverage ?? {};
  const presenceWindow = Number.isFinite(coverageSettings.presenceWindow)
    ? coverageSettings.presenceWindow
    : GRASS_LOD_PRESENCE_WINDOW;
  const halfWindow = presenceWindow * 0.5;
  const widenCompensation = Number.isFinite(coverageSettings.compensation)
    ? coverageSettings.compensation
    : GRASS_LOD_WIDEN_DEFAULTS.compensation;
  const widenMaximum = Number.isFinite(coverageSettings.maximumWiden)
    ? coverageSettings.maximumWiden
    : GRASS_LOD_WIDEN_DEFAULTS.maximumWiden;
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
  const worldXZ = base.xz.add(sampleOffset).add(wrapNoiseOrigin(chunkCenter));
  const surface = texture(surfaceMaskTexture, localUv);
  const surfaceClass = createSurfaceClassNodes(surface);
  const trampleSample = texture(trampleTexture, localUv);
  const trampleDirection = trampleSample.xy.mul(2).sub(1);
  const trampleInfluence = trampleSample.z;
  // Trodden by the player: footprints (groundDeformationState) press blades down,
  // and they rise again as the print fades. Addressed from the chunk's whole-metre
  // corner so it is exact at planet scale.
  const trodden = groundDeformationNode(
    vec2(
      chunkCenter.x.sub(chunkWorldSize * 0.5),
      chunkCenter.y.negate().sub(chunkWorldSize * 0.5),
    ).round(),
    localUv.mul(chunkWorldSize),
  );

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
    .mul(oneMinus(trodden.mul(0.75)))
    .mul(surfaceClass.landGrass);
  // The blade's rank in its clump's length ordering, uniform in [0, 1).
  const lengthRank = bladeLengthPhase.add(parameters.w).fract();
  // Skewed toward the short end: a flat roll over the configured range puts most
  // blades near the middle of it, which reads as a mown lawn rather than sward.
  // `bladeLengthFraction` in grassLodMath mirrors this and pins the distribution.
  const lengthFraction = lengthRank.pow(tuned.lengthSkew);
  const bladeLength = mix(tuned.minLength, tuned.maxLength, lengthFraction);

  // Distance from the camera to this blade. Measured from the blade's own
  // render-space position, not from the canonical `worldXZ` above: those are the
  // same vector only while the floating origin sits at the world's centre, and on
  // an imported planet-scale world the canonical coordinates are millions of
  // metres from a camera that is always near the origin. Every distance taken from
  // `worldXZ` therefore read as enormous there, which left the flutter fade and the
  // blade-normal fade permanently off. Render space is exact wherever the origin is.
  const worldPosition = positionWorld;
  const cameraDistance = length(worldPosition.xz.sub(cameraPosition.xz));

  // LOD thinning. The CPU resolves the density this chunk should be showing at its
  // nearest and farthest corner — see `grassLodCoverage`, which owns the law — and
  // this interpolates between them by the blade's own distance. So the field thins
  // continuously across a chunk rather than in one step per chunk, which is the
  // whole reason the density falloff is not left to the per-ring compaction.
  //
  // `lodCoverage` is `(inner metres, outer metres, coverage at each)`. A caller with
  // no camera to measure from — a capture harness, a budget test — gets coverage of
  // 1 everywhere, which is what the density law says when nothing is overdue for
  // retiring; the uniform is built lazily so those callers do not carry it.
  const coverageLod = lodCoverage ?? frameUniform(new THREE.Vector4(0, 1, 1, 1));
  const coverageT = clamp(
    cameraDistance.sub(coverageLod.x)
      .div(max(coverageLod.y.sub(coverageLod.x), float(1e-3))),
    0,
    1,
  );
  const coverage = mix(coverageLod.z, coverageLod.w, coverageT);
  // Retire by rank, with the ramp centred on the rank so the share still standing
  // is the coverage exactly. The trailing factor closes the field off as the
  // coverage reaches zero, or the lowest ranks would survive as half-width blades
  // past the end of the fade. Mirrors `grassLodPresence`.
  const lodPresence = clamp(
    oneMinus(bladeWind.w.sub(coverage).add(halfWindow).div(presenceWindow)),
    0,
    1,
  ).mul(clamp(coverage.div(presenceWindow), 0, 1));
  // Survivors widen by the share already retired, so thinning keeps the carpet's
  // opacity instead of opening it up. Capped: past about 1.35x the extra fill costs
  // more than the instances it replaced. Mirrors `grassLodWiden`.
  const lodWiden = oneMinus(
    oneMinus(min(
      float(widenMaximum),
      max(float(1), float(1).div(max(coverage, float(1e-3)))),
    )).mul(widenCompensation),
  );

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
  //
  // The last two factors are the LOD thinning. A chunk's population is a whole
  // number of clumps per cell, so the density law it is trying to follow is always
  // a step; the coverage is the gap between the two, and `presence` retires blades
  // by rank until what is left is the density the chunk's distance actually calls
  // for. Blades are thinned rather than shortened — a shortened blade reads as the
  // field getting mown as you walk toward it — and the survivors widen by the share
  // already retired, so the count drops without the carpet going bald.
  const bladeWidth = parameters.x
    .mul(tuned.widthScale)
    .mul(float(1).sub(widthSpread.div(2)).add(widthMix.mul(widthSpread)))
    .mul(lodPresence)
    .mul(lodWiden);

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
  // Direction and strength come from the world wind field: gust fronts travel
  // across the sward and curl as they go, instead of every blade in view obeying
  // one fixed direction. `envelope` is 1 in the calm the tuning was authored in.
  // `worldXZ` is canonical (it is built from the chunk's canonical centre).
  const worldWind = sampleWorldWindCanonical(worldXZ);
  const windDirection = worldWind.direction;
  const gustScale = worldWind.envelope.clamp(0.35, 3.5);
  const windPerpendicular = vec2(windDirection.y.negate(), windDirection.x);
  // Wave phase against the prevailing wind, not the local field: on a planet-scale
  // map the latter scatters neighbouring patches onto unrelated phases
  // (windWaveCoordinates).
  const windWave = windWaveCoordinates(worldXZ);
  // The gust is a world-space travelling wave, and at the configured frequency its
  // wavelength is on the order of ten metres — so every blade of a sub-metre clump
  // sits on effectively one point of it. Offsetting each blade around the cycle is
  // what stops the field from moving as a single surface.
  const bladePhase = bladeWind.x.mul(TWO_PI);
  const primary = sin(windWave.along.mul(tuned.windFrequency)
    .add(time.mul(tuned.windSpeed))
    .add(bladePhase));
  const secondary = sin(windWave.along.mul(tuned.windFrequency.mul(2.6))
    .add(time.mul(tuned.windSpeed.mul(1.8)))
    .add(bladePhase.mul(1.7))
    .add(1.3)).mul(0.35);
  const turbulence = sin(windWave.across.mul(tuned.windFrequency.mul(1.9))
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
    .mul(heightMask)
    .mul(gustScale);
  const lean = tuned.windLean.mul(compliance).mul(heightMask).mul(gustScale);

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
  const flutterFade = oneMinus(smoothstep(
    tuned.flutterFadeStart,
    tuned.flutterFadeEnd,
    cameraDistance,
  ));
  const flutterWave = sin(windWave.across.mul(flutter.frequency ?? 1.9)
    .add(time.mul(flutter.speed ?? 3.4))
    .add(bladePhase.mul(3.1)));
  const flutterOffset = windPerpendicular.mul(
    flutterWave
      .mul(bladeWind.z)
      .mul(tuned.flutterStrength)
      .mul(flutterWeight)
      .mul(flutterFade)
      .mul(gustScale.sqrt()),
  );
  const windOffset = windDirection.mul(swing.add(lean)).add(flutterOffset);
  const rockOffset = trampleDirection
    .mul(config.rocks.bend)
    .mul(trampleInfluence)
    .mul(heightMask);

  const finalXZ = base.xz.add(clumpOffset).add(curveOffset).add(leanOffset)
    .add(windOffset).add(rockOffset);
  const finalPosition = vec3(finalXZ.x, base.y.add(bladeHeight), finalXZ.y);

  const gradient = pow(clamp(
    normalizedHeight.sub(config.color.gradientStart)
      .div(Math.max(0.001, config.color.gradientEnd - config.color.gradientStart)),
    0,
    1,
  ), config.color.gradientPower);
  const patch = stylizedPatchMask(worldXZ, patchSettings);
  const baseColor = mix(tuned.colorBottom, tuned.colorTop, gradient);
  // Straw fringe along a path's verge, after grass-test's: the grass that still
  // grows beside a track is trampled and dry, so its tips go straw rather than
  // green. Our path wear already splits the smoothstep into a tread and the verge
  // outside it, which is exactly the band the donor read off its exclusion channel.
  //
  // Weighted by the height gradient, so it is the *tips* that dry out: a whole
  // blade going straw reads as a different plant rather than as the same grass
  // underfoot.
  const fringeSettings = config.path?.fringe ?? {};
  const fringeStrength = fringeSettings.enabled === false
    ? float(0)
    : float(fringeSettings.strength ?? DEFAULT_PATH_FRINGE_STRENGTH);
  const strawColor = colorNode(fringeSettings.color ?? DEFAULT_PATH_FRINGE_COLOR)
    .mul(dot(baseColor, vec3(0.3, 0.59, 0.11)).mul(1.6).add(0.35));
  const fringedColor = mix(
    baseColor,
    strawColor,
    pathWear.verge.mul(fringeStrength).mul(gradient).clamp(0, 1),
  );
  const patchColor = mix(tuned.patchLush, tuned.patchDry, patch);
  const variedColor = mix(fringedColor, patchColor, tuned.patchStrength);

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
  applyJungleMist(material, config.ambientEffects);
  return assignGrassMaterialData(material);
}
