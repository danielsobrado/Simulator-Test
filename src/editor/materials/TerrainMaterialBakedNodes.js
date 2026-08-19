import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  float,
  max,
  mix,
  normalView,
  oneMinus,
  select,
  smoothstep,
  texture,
  vec3,
} from 'three/tsl';
import { createTerrainMaterialFamilyMultiplier } from './TerrainMaterialStochasticNodes.js';
import { createTerrainMaterialGenome } from './TerrainMaterialGenomeNodes.js';
import { createTerrainSurfaceNormal } from './TerrainMaterialSurfaceGradientNodes.js';

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
  return {
    macroTint: texture(gpuState.textures.macroTint, terrainUv),
    terrainShape: texture(gpuState.textures.terrainShape, terrainUv),
    materialWeights: texture(gpuState.textures.materialWeights, terrainUv),
    wetnessShoreline: texture(gpuState.textures.wetnessShoreline, terrainUv),
    farColor: texture(gpuState.textures.farColor, terrainUv),
    farNormal: texture(gpuState.textures.farNormal, terrainUv),
    canopyWater: texture(gpuState.textures.canopyWater, terrainUv),
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
  heightShade,
  cameraDistance,
  proceduralColor,
  worldXZ,
  terrainHeight,
  familyAtlas,
  gpuState,
  stylizedConfig,
}) {
  const materialBake = stylizedConfig.materialBake;
  const render = materialBake.render;
  const fallbackRoughness = float(render.fallbackRoughness);
  if (!gpuState) {
    return { color: proceduralColor, roughness: fallbackRoughness, normal: null };
  }

  const samples = sampleBakeTextures(gpuState, terrainUv);
  const weights = normalizedWeights(samples.materialWeights);
  const genome = createTerrainMaterialGenome({
    worldXZ,
    biomeColor: tileColor,
    genomes: materialBake.families.genomes,
  });
  const roughness = clamp(
    materialRoughness(
      weights,
      samples.wetnessShoreline.r,
      materialBake.families.profiles,
    ).add(genome.roughnessOffset),
    0,
    1,
  );
  const publishedRoughness = select(
    gpuState.blend.greaterThan(PUBLISHED_BLEND_THRESHOLD),
    roughness,
    mix(fallbackRoughness, roughness, gpuState.blend),
  );
  const readyRoughness = select(
    gpuState.ready.greaterThan(0.5),
    publishedRoughness,
    fallbackRoughness,
  );

  const requestedDebugColor = debugColor({
    view: materialBake.debug.view,
    samples,
  });
  if (requestedDebugColor) {
    return {
      color: select(gpuState.ready.greaterThan(0.5), requestedDebugColor, proceduralColor),
      roughness: readyRoughness,
      normal: normalView,
    };
  }

  const grassColor = mix(
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
    families: materialBake.families,
  });
  const familyMultiplier = vec3(1).add(
    sampledFamilyMultiplier.sub(1).mul(genome.detailScale),
  );
  const detailHeight = dot(familyMultiplier.sub(1), vec3(1 / 3));
  const normalVisibility = oneMinus(smoothstep(
    materialBake.families.normalFadeStartDistance,
    materialBake.families.normalFadeEndDistance,
    cameraDistance,
  ));
  const surfaceNormal = createTerrainSurfaceNormal({
    encodedNormal: samples.farNormal,
    detailHeight,
    detailStrength: normalVisibility.mul(materialBake.families.normalStrength),
  });
  const readyNormal = select(
    gpuState.ready.greaterThan(0.5),
    surfaceNormal,
    normalView,
  );
  const macroMultiplier = clamp(samples.macroTint.rgb.mul(2), vec3(0.65), vec3(1.35));
  midColor = midColor
    .mul(familyMultiplier)
    .mul(macroMultiplier)
    .mul(genome.colorMultiplier);
  midColor = mix(
    midColor,
    colorNode(render.shorelineColor),
    samples.wetnessShoreline.g.mul(render.shorelineStrength),
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

  const nearMacro = mix(vec3(1), macroMultiplier, render.nearMacroStrength);
  const nearFamily = mix(vec3(1), familyMultiplier, materialBake.families.nearStrength);
  const nearDetailed = mix(
    proceduralColor
      .mul(genome.colorMultiplier)
      .mul(nearMacro)
      .mul(nearFamily)
      .mul(float(1).sub(
        samples.wetnessShoreline.r.mul(render.wetDarkening * render.nearWetnessScale),
      )),
    midColor,
    render.nearMaterialBlend,
  );

  const nearBlendEnd = render.nearDistance + render.transitionDistance;
  const farBlendEnd = render.farDistance + render.transitionDistance;
  const nearBlend = smoothstep(render.nearDistance, nearBlendEnd, cameraDistance);
  const farBlend = smoothstep(render.farDistance, farBlendEnd, cameraDistance);

  const farColor = samples.farColor.rgb.mul(genome.colorMultiplier);
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
  );
  const readyColor = select(
    gpuState.stale.greaterThan(0.5),
    mix(bakedColor, proceduralColor, render.staleProceduralBlend),
    bakedColor,
  );
  const publishedColor = select(
    gpuState.blend.greaterThan(PUBLISHED_BLEND_THRESHOLD),
    readyColor,
    mix(proceduralColor, readyColor, gpuState.blend),
  );
  return {
    color: select(gpuState.ready.greaterThan(0.5), publishedColor, proceduralColor),
    roughness: readyRoughness,
    normal: readyNormal,
  };
}

export function createTerrainMaterialBakedColor(options) {
  return createTerrainMaterialBakedSurface(options).color;
}
