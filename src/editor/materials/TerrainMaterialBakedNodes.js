import { createTerrainSubstrateNodes } from './TerrainSubstrateNodes.js';
import * as THREE from 'three/webgpu';
import { terrainMaterialAnalysisChannels } from './TerrainMaterialAnalysisTexture.js';
import {
  Fn,
  clamp,
  faceDirection,
  float,
  max,
  mix,
  normalViewGeometry,
  oneMinus,
  select,
  smoothstep,
  texture,
  vec3,
} from 'three/tsl';
import { createTerrainMaterialFamilyMultiplier } from './TerrainMaterialStochasticNodes.js';
import { bilinearLoad } from './TerrainSlotBindings.js';
import { createTerrainMaterialGenome } from './TerrainMaterialGenomeNodes.js';
import { createTerrainTransitionState } from './TerrainTransitionNodes.js';
import {
  applyTerrainMaterialFeatureColor,
  createTerrainMaterialFeatureState,
} from './TerrainMaterialFeatureResponseNodes.js';
import { createTerrainSurfaceNormal } from './TerrainMaterialSurfaceGradientNodes.js';
import {
  applyTerrainWeatheringColor,
  createTerrainWeatheringState,
} from './TerrainMaterialWeatheringNodes.js';

/** Share of a fully snowed point's pigment the bake leaves out. */
const SNOW_ALBEDO_PURITY = 0.92;

const MIN_WEIGHT_SUM = 0.0001;
const DEBUG_CURVATURE_SCALE = 8;
const PUBLISHED_BLEND_THRESHOLD = 0.999;

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

function normalizedWeights(textureNode) {
  const total = max(
    textureNode.r.add(textureNode.g).add(textureNode.b).add(textureNode.a),
    MIN_WEIGHT_SUM,
  );
  return textureNode.div(total);
}

function sampleBakeTextures(gpuState, terrainUv) {
  // A shared material samples each drawn slot's own bake (TerrainSlotBindings).
  const sample = (name) => (gpuState.sampleTexture
    ? gpuState.sampleTexture(name, terrainUv)
    : texture(gpuState.textures[name], terrainUv));
  // The macro tint is the smoothest bake, so it is read without a sampler: the
  // terrain's fragment stage has used all 16 (TerrainSlotBindings.loadTexture).
  const load = (name) => terrainMaterialAnalysisChannels((gpuState.loadTexture
    ? gpuState.loadTexture(name, terrainUv)
    : bilinearLoad(gpuState.textures[name], terrainUv)),name);
  return {
    macroTint: load('macroTint'),
    terrainShape: load('terrainShape'),
    materialWeights: load('materialWeights'),
    wetnessShoreline: load('wetnessShoreline'),
    farColor: sample('farColor'),
    farNormal: sample('farNormal'),
    canopyWater: load('canopyWater'),
  };
}

function weightedFamilyProperty(weights, profiles, property) {
  return weights.r.mul(profiles.grass[property])
    .add(weights.g.mul(profiles.dirt[property]))
    .add(weights.b.mul(profiles.rock[property]))
    .add(weights.a.mul(profiles.snow[property]));
}

function materialRoughness(weights, wetness, profiles) {
  const dry = weightedFamilyProperty(weights, profiles, 'roughness');
  const wet = weightedFamilyProperty(weights, profiles, 'wetRoughness');
  return clamp(mix(dry, wet, wetness), 0, 1);
}

function debugColor({ view, samples }) {
  switch (view) {
    case 'macroTint':
      return samples.macroTint.rgb;
    case 'terrainShape': {
      const slope = clamp(samples.terrainShape.r, 0, 1);
      const curvature = clamp(
        samples.terrainShape.g.mul(DEBUG_CURVATURE_SCALE).mul(0.5).add(0.5),
        0,
        1,
      );
      return vec3(slope, curvature, 0);
    }
    case 'materialWeights':
      return vec3(
        samples.materialWeights.r,
        samples.materialWeights.g,
        max(samples.materialWeights.b, samples.materialWeights.a),
      );
    case 'wetnessShoreline':
      return vec3(samples.wetnessShoreline.r, samples.wetnessShoreline.g, 0);
    case 'farColor':
      return samples.farColor.rgb;
    case 'farNormal':
      return vec3(
        samples.farNormal.r.mul(0.5).add(0.5),
        samples.farNormal.g.mul(0.5).add(0.5),
        0.5,
      );
    case 'canopyWater':
      return vec3(samples.canopyWater.r, samples.canopyWater.g, 0);
    default:
      return null;
  }
}

export function createTerrainMaterialBakedSurface({
  terrainUv,
  tileColor,
  tileId = float(-1),
  heightShade,
  cameraDistance,
  proceduralColor,
  worldXZ,
  terrainHeight,
  familyAtlas,
  gpuState,
  stylizedConfig,
  pathMask = float(0),
  localXZ = null,
  transitionPatterns = null,
  grassColorOverride = null,
}) {
  const materialBake = stylizedConfig.materialBake;
  const render = materialBake.render;
  const families = materialBake.families;
  const fallbackRoughness = float(render.fallbackRoughness);
  if (!gpuState) {
    return { color: proceduralColor, roughness: fallbackRoughness, normal: null };
  }

  const samples = sampleBakeTextures(gpuState, terrainUv);
  const transitions = createTerrainTransitionState({
    weights: normalizedWeights(samples.materialWeights),
    shoreline: samples.wetnessShoreline.g,
    path: pathMask,
    cameraDistance,
    patterns: transitionPatterns,
    localXZ,
    settings: families.transitions,
  });
  const weights = transitions.weights;
  const genome = createTerrainMaterialGenome({
    worldXZ,
    biomeColor: tileColor,
    genomes: families.genomes,
  });
  const featureState = createTerrainMaterialFeatureState({
    worldXZ,
    localXZ,
    // Feature lattices exist only on pattern sets built with the features.
    patterns: transitionPatterns?.frames?.crackPlates ? transitionPatterns : null,
    materialWeights: weights,
    terrainShape: samples.terrainShape,
    wetness: samples.wetnessShoreline.r,
    canopy: samples.canopyWater.r,
    shoreline: samples.wetnessShoreline.g,
    cameraDistance,
    features: families.features,
    crackEligibility: tileId.equal(1).or(tileId.equal(2)).select(float(0), float(1)),
  });
  const weatheringState = createTerrainWeatheringState({
    terrainShape: samples.terrainShape,
    wetness: samples.wetnessShoreline.r,
    canopy: samples.canopyWater.r,
    shoreline: samples.wetnessShoreline.g,
    cameraDistance,
    weathering: families.weathering,
  });
  const substrate = createTerrainSubstrateNodes({tileId,canopy:samples.canopyWater.r,
    wetness:samples.wetnessShoreline.r,shoreline:samples.wetnessShoreline.g,profiles:families.substrates});
  const roughness = clamp(
    materialRoughness(weights, samples.wetnessShoreline.r, families.profiles)
      .add(weights.g.mul(substrate.roughness.sub(float(families.profiles.dirt.roughness)
        .add(samples.wetnessShoreline.r.mul(families.profiles.dirt.wetRoughness-families.profiles.dirt.roughness)))))
      .add(genome.roughnessOffset)
      .add(featureState.roughnessOffset)
      .add(weatheringState.roughnessOffset),
    0,
    1,
  );
  // Taken into a variable before the selects, as the colour is (assembleBakedColor).
  const readyRoughness = Fn(() => {
    const surfaceRoughness = roughness.toVar();
    const publishedRoughness = select(
      gpuState.blend.greaterThan(PUBLISHED_BLEND_THRESHOLD),
      surfaceRoughness,
      mix(fallbackRoughness, surfaceRoughness, gpuState.blend),
    ).toVar();
    return select(
      gpuState.ready.greaterThan(0.5),
      publishedRoughness,
      fallbackRoughness,
    );
  })();

  const requestedDebugColor = debugColor({
    view: materialBake.debug.view,
    samples,
  });
  if (requestedDebugColor) {
    return {
      color: select(gpuState.ready.greaterThan(0.5), requestedDebugColor, proceduralColor),
      roughness: readyRoughness,
      normal: normalViewGeometry.mul(faceDirection),
    };
  }

  const grassColor = grassColorOverride ?? mix(
    tileColor,
    colorNode(stylizedConfig.color.bottom).mul(stylizedConfig.color.brightness),
    render.grassTintStrength,
  );
  const dirtColor = colorNode(stylizedConfig.dirt.color);
  const rockColor = colorNode(render.rockColor);
  const snowColor = colorNode(render.snowColor);
  let midColor = grassColor.mul(weights.r)
    .add(dirtColor.mul(weights.g))
    .add(rockColor.mul(weights.b))
    .add(snowColor.mul(weights.a));

  const sampledFamilyMultiplier = createTerrainMaterialFamilyMultiplier({
    atlas: familyAtlas?.texture ?? null,
    worldXZ,
    terrainHeight,
    cameraDistance,
    materialWeights: weights,
    terrainShape: samples.terrainShape,
    farNormal: samples.farNormal,
    wetness: samples.wetnessShoreline.r,
    canopy: samples.canopyWater.r,
    families,
  });
  const familyMultiplier = vec3(1).add(
    sampledFamilyMultiplier.sub(1).mul(genome.detailScale),
  );
  // The family atlas is reflectance, not a height map. Differentiating it
  // turns pigment/variant boundaries (and quantized canonical coordinates on
  // imported maps) into little raised plates. Only physical feature relief
  // contributes to the normal; its slot-local pattern remains precise there.
  const detailHeight = featureState.heightOffset;
  const normalVisibility = oneMinus(smoothstep(
    families.normalFadeStartDistance,
    families.normalFadeEndDistance,
    cameraDistance,
  ));
  const surfaceNormal = createTerrainSurfaceNormal({
    encodedNormal: samples.farNormal,
    detailHeight,
    detailStrength: normalVisibility.mul(families.normalStrength),
  });
  const readyNormal = select(
    gpuState.ready.greaterThan(0.5),
    surfaceNormal,
    // This normal also feeds snow color/roughness and emission. normalView
    // would ask those passes for the material's completed normal, recursing
    // through the snow normal that is being built from this fallback.
    normalViewGeometry.mul(faceDirection),
  );
  const macroMultiplier = clamp(samples.macroTint.rgb.mul(2), vec3(0.65), vec3(1.35));
  midColor = substrate.applyColor(midColor,weights.g,pathMask);
  midColor = midColor
    .mul(familyMultiplier)
    .mul(macroMultiplier)
    .mul(genome.colorMultiplier);
  midColor = applyTerrainMaterialFeatureColor(midColor, featureState, families.features);
  midColor = applyTerrainWeatheringColor(midColor, weatheringState);
  midColor = mix(
    midColor,
    colorNode(render.shorelineColor),
    transitions.shoreline.mul(render.shorelineStrength),
  );
  midColor = mix(
    midColor,
    colorNode(stylizedConfig.trees?.forestFloor?.groundCoreColor ?? '#273c25'),
    samples.canopyWater.r
      .mul(render.canopyStrength)
      .mul(oneMinus(weights.g)),
  );
  midColor = midColor
    .mul(float(1).sub(samples.wetnessShoreline.r.mul(render.wetDarkening)))
    .mul(heightShade);
  // Macro tint, family atlas and lichen are ground pigment: on snow they read as dirty concrete.
  midColor = mix(midColor, snowColor.mul(heightShade), weights.a.mul(SNOW_ALBEDO_PURITY));

  const nearMacro =mix(vec3(1), macroMultiplier, render.nearMacroStrength);
  const nearFamily = mix(vec3(1), familyMultiplier, families.nearStrength);
  let nearProcedural = substrate.applyColor(proceduralColor,weights.g,pathMask)
    .mul(genome.colorMultiplier)
    .mul(nearMacro)
    .mul(nearFamily)
    .mul(float(1).sub(
      samples.wetnessShoreline.r.mul(render.wetDarkening * render.nearWetnessScale),
    ));
  nearProcedural = applyTerrainMaterialFeatureColor(
    nearProcedural,
    featureState,
    families.features,
  );
  nearProcedural = applyTerrainWeatheringColor(nearProcedural, weatheringState);
  // Exposed rock and snow need their own colour at walking distance, rather
  // than being reduced to the turf's detail multiplier. Banks retain some turf.
  const nearMaterialBlend = families.transitions?.enabled
    ? max(float(render.nearMaterialBlend), weights.b.add(weights.a).add(transitions.shoreline.mul(0.5)).clamp(0, 1))
    : float(render.nearMaterialBlend);
  const nearDetailed = mix(nearProcedural, midColor, nearMaterialBlend);

  const nearBlendEnd = render.nearDistance + render.transitionDistance;
  const farBlendEnd = render.farDistance + render.transitionDistance;
  const nearBlend = smoothstep(render.nearDistance, nearBlendEnd, cameraDistance);
  const farBlend = smoothstep(render.farDistance, farBlendEnd, cameraDistance);

  const farColor = samples.farColor.rgb.mul(genome.colorMultiplier);
  return {
    color: assembleBakedColor({
      nearDetailed,
      midColor,
      farColor,
      proceduralColor,
      cameraDistance,
      render,
      gpuState,
      nearBlend,
      farBlend,
      nearBlendEnd,
      farBlendEnd,
    }),
    roughness: readyRoughness,
    normal: readyNormal,
    /** 0..1 baked snow cover, for snow-only shading on top. */
    snow: select(gpuState.ready.greaterThan(0.5), weights.a, float(0)),
    /** 0..1 baked canopy over the ground, which shelters it from rain. */
    canopy: select(gpuState.ready.greaterThan(0.5), samples.canopyWater.r, float(0)),
    wetness: select(gpuState.ready.greaterThan(0.5), samples.wetnessShoreline.r, float(0)),
  };
}

/**
 * The distance bands and the bake's publish states, as selects over values taken
 * into variables first, inside one `Fn`.
 *
 * TSL emits a select as an if/else and builds each branch's inputs inside it, so
 * a colour read by several branches is written out once per branch — and these
 * selects nest four deep, then twice more on the bake state. With the colours
 * inline, `midColor` (and the family atlas taps inside it) came out about 18
 * times in the terrain's fragment shader. As variables they are emitted once and
 * each branch reads a name.
 */
function assembleBakedColor(inputs) {
  const {
    cameraDistance, render, gpuState, nearBlend, farBlend, nearBlendEnd, farBlendEnd,
  } = inputs;
  return Fn(() => {
    const nearDetailed = inputs.nearDetailed.toVar();
    const midColor = inputs.midColor.toVar();
    const farColor = inputs.farColor.toVar();
    const proceduralColor = inputs.proceduralColor.toVar();
    const bakedColor = select(
      cameraDistance.lessThan(render.nearDistance),
      nearDetailed,
      select(
        cameraDistance.lessThan(nearBlendEnd),
        mix(nearDetailed, midColor, nearBlend),
        select(
          cameraDistance.lessThan(render.farDistance),
          midColor,
          select(
            cameraDistance.lessThan(farBlendEnd),
            mix(midColor, farColor, farBlend),
            farColor,
          ),
        ),
      ),
    ).toVar();
    const readyColor = select(
      gpuState.stale.greaterThan(0.5),
      mix(bakedColor, proceduralColor, render.staleProceduralBlend),
      bakedColor,
    ).toVar();
    const publishedColor = select(
      gpuState.blend.greaterThan(PUBLISHED_BLEND_THRESHOLD),
      readyColor,
      mix(proceduralColor, readyColor, gpuState.blend),
    ).toVar();
    return select(gpuState.ready.greaterThan(0.5), publishedColor, proceduralColor);
  })();
}

export function createTerrainMaterialBakedColor(options) {
  return createTerrainMaterialBakedSurface(options).color;
}
