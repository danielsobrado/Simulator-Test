import {
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  oneMinus,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import { createTerrainOrientedMicroDetail } from './TerrainMaterialMicroDetailNodes.js';

const HASH_VECTOR_A = Object.freeze([127.1, 311.7]);
const HASH_VECTOR_B = Object.freeze([269.5, 183.3]);
const HASH_SCALE = 43758.5453;
const SQRT_THREE_OVER_TWO = Math.sqrt(3) * 0.5;
const TRIANGLE_SKEW = 0.5;
const MIN_DETAIL_MULTIPLIER = 0.65;
const MAX_DETAIL_MULTIPLIER = 1.35;
const MAX_SECONDARY_BLEND = 0.5;
const SECONDARY_FADE_WIDTH = 0.18;
const MIN_PAIR_WEIGHT = 0.0001;

function hash2(cell, vector, offset = 0) {
  return fract(
    sin(dot(cell.add(vec2(offset, offset * 0.618)), vec2(vector[0], vector[1])))
      .mul(HASH_SCALE),
  );
}

function rotateQuarterTurns(uvNode, hashNode) {
  const quarter = floor(hashNode.mul(4));
  return select(
    quarter.lessThan(1),
    uvNode,
    select(
      quarter.lessThan(2),
      vec2(uvNode.y, uvNode.x.negate()),
      select(
        quarter.lessThan(3),
        uvNode.negate(),
        vec2(uvNode.y.negate(), uvNode.x),
      ),
    ),
  );
}

function sampleVariant(atlas, baseUv, vertex, familyIndex, variantsPerFamily, scaleJitter) {
  const variantHash = hash2(vertex, HASH_VECTOR_A);
  const transformHash = hash2(vertex, HASH_VECTOR_B, 13.7);
  const mirrorHash = hash2(vertex, HASH_VECTOR_A, 29.3);
  const shiftX = hash2(vertex, HASH_VECTOR_B, 41.1);
  const shiftY = hash2(vertex, HASH_VECTOR_A, 57.9);
  const scaleHash = hash2(vertex, HASH_VECTOR_B, 71.3);
  const variant = floor(variantHash.mul(variantsPerFamily));
  const layer = familyIndex.mul(variantsPerFamily).add(variant);
  const scale = mix(float(1 - scaleJitter), float(1 + scaleJitter), scaleHash);
  let sampleUv = baseUv.mul(scale).add(vec2(shiftX, shiftY));
  sampleUv = rotateQuarterTurns(sampleUv, transformHash);
  sampleUv = select(
    mirrorHash.greaterThan(0.5),
    vec2(sampleUv.x.negate(), sampleUv.y),
    sampleUv,
  );
  return texture(atlas, sampleUv).depth(layer).rgb;
}

function stochasticTriSample({
  atlas,
  planarMeters,
  mesoScaleMeters,
  variantCellMeters,
  familyIndex,
  variantsPerFamily,
  scaleJitter,
  contrastPreservation,
}) {
  const baseUv = planarMeters.div(mesoScaleMeters);
  const grid = planarMeters.div(variantCellMeters);
  const skewed = vec2(
    grid.x.add(grid.y.mul(TRIANGLE_SKEW)),
    grid.y.mul(SQRT_THREE_OVER_TWO),
  );
  const cell = floor(skewed);
  const local = fract(skewed);
  const sum = local.x.add(local.y);
  const upper = sum.greaterThan(1);
  const vertex0 = select(upper, cell.add(vec2(1, 1)), cell);
  const vertex1 = cell.add(vec2(1, 0));
  const vertex2 = cell.add(vec2(0, 1));
  const weight0 = select(upper, sum.sub(1), oneMinus(sum));
  const weight1 = select(upper, oneMinus(local.y), local.x);
  const weight2 = select(upper, oneMinus(local.x), local.y);

  const blended = sampleVariant(
    atlas, baseUv, vertex0, familyIndex, variantsPerFamily, scaleJitter,
  ).mul(weight0)
    .add(sampleVariant(
      atlas, baseUv, vertex1, familyIndex, variantsPerFamily, scaleJitter,
    ).mul(weight1))
    .add(sampleVariant(
      atlas, baseUv, vertex2, familyIndex, variantsPerFamily, scaleJitter,
    ).mul(weight2));
  const weightLength = max(
    sqrt(weight0.mul(weight0).add(weight1.mul(weight1)).add(weight2.mul(weight2))),
    0.58,
  );
  const restored = clamp(
    vec3(0.5).add(blended.sub(0.5).div(weightLength)),
    vec3(0),
    vec3(1),
  );
  return mix(blended, restored, contrastPreservation);
}

function stochasticSingleSample({
  atlas,
  planarMeters,
  mesoScaleMeters,
  variantCellMeters,
  familyIndex,
  variantsPerFamily,
  scaleJitter,
}) {
  const baseUv = planarMeters.div(mesoScaleMeters);
  const cell = floor(planarMeters.div(variantCellMeters));
  return sampleVariant(atlas, baseUv, cell, familyIndex, variantsPerFamily, scaleJitter);
}

function topTwoFamilies(weights) {
  const grassWinsDirt = weights.r.greaterThan(weights.g);
  const groundTopWeight = select(grassWinsDirt, weights.r, weights.g);
  const groundTopIndex = select(grassWinsDirt, float(0), float(1));
  const groundRunnerWeight = select(grassWinsDirt, weights.g, weights.r);
  const groundRunnerIndex = select(grassWinsDirt, float(1), float(0));

  const rockWinsSnow = weights.b.greaterThan(weights.a);
  const coldTopWeight = select(rockWinsSnow, weights.b, weights.a);
  const coldTopIndex = select(rockWinsSnow, float(2), float(3));
  const coldRunnerWeight = select(rockWinsSnow, weights.a, weights.b);
  const coldRunnerIndex = select(rockWinsSnow, float(3), float(2));

  const groundWins = groundTopWeight.greaterThan(coldTopWeight);
  const primaryWeight = select(groundWins, groundTopWeight, coldTopWeight);
  const primaryIndex = select(groundWins, groundTopIndex, coldTopIndex);
  const winnerRunnerWeight = select(groundWins, groundRunnerWeight, coldRunnerWeight);
  const winnerRunnerIndex = select(groundWins, groundRunnerIndex, coldRunnerIndex);
  const loserTopWeight = select(groundWins, coldTopWeight, groundTopWeight);
  const loserTopIndex = select(groundWins, coldTopIndex, groundTopIndex);
  const winnerRunnerWins = winnerRunnerWeight.greaterThan(loserTopWeight);

  return {
    primaryIndex,
    primaryWeight,
    secondaryIndex: select(winnerRunnerWins, winnerRunnerIndex, loserTopIndex),
    secondaryWeight: select(winnerRunnerWins, winnerRunnerWeight, loserTopWeight),
  };
}

function projectedDetail({
  atlas,
  planarMeters,
  familyIndex,
  families,
  microVisibility,
  secondary = false,
}) {
  const sampleOptions = {
    atlas,
    planarMeters,
    mesoScaleMeters: families.mesoScaleMeters,
    variantCellMeters: families.variantCellMeters,
    familyIndex,
    variantsPerFamily: families.variantsPerFamily,
    scaleJitter: families.scaleJitter,
    contrastPreservation: families.contrastPreservation,
  };
  const sample = secondary
    ? stochasticSingleSample(sampleOptions)
    : stochasticTriSample(sampleOptions);
  const meso = sample.sub(0.5).mul(families.mesoStrength * 2);
  const micro = createTerrainOrientedMicroDetail({
    planarMeters,
    scaleMeters: families.microScaleMeters,
    strength: families.microStrength,
    visibility: microVisibility,
  });
  return clamp(
    vec3(1).add(meso).add(vec3(micro)),
    vec3(MIN_DETAIL_MULTIPLIER),
    vec3(MAX_DETAIL_MULTIPLIER),
  );
}

function secondaryBlend(pair, families) {
  const pairWeight = max(pair.primaryWeight.add(pair.secondaryWeight), MIN_PAIR_WEIGHT);
  const ratio = pair.secondaryWeight.div(pairWeight);
  const visibility = smoothstep(
    families.secondaryMinWeight,
    families.secondaryMinWeight + SECONDARY_FADE_WIDTH,
    pair.secondaryWeight,
  );
  return clamp(
    ratio.mul(families.secondaryBlendStrength).mul(visibility),
    0,
    MAX_SECONDARY_BLEND,
  );
}

export function createTerrainMaterialFamilyMultiplier({
  atlas,
  worldXZ,
  terrainHeight,
  cameraDistance,
  materialWeights,
  terrainShape,
  farNormal,
  wetness,
  canopy,
  families,
}) {
  if (!atlas || !families?.enabled) return vec3(1);
  const pair = topTwoFamilies(materialWeights);
  const blend = secondaryBlend(pair, families);
  const microVisibility = oneMinus(smoothstep(
    families.microFadeStartDistance,
    families.microFadeEndDistance,
    cameraDistance,
  ));
  const topPrimary = projectedDetail({
    atlas,
    planarMeters: worldXZ,
    familyIndex: pair.primaryIndex,
    families,
    microVisibility,
  });
  const topSecondary = projectedDetail({
    atlas,
    planarMeters: worldXZ,
    familyIndex: pair.secondaryIndex,
    families,
    microVisibility,
    secondary: true,
  });
  const topDetail = mix(topPrimary, topSecondary, blend);
  const vertical = terrainHeight.mul(families.projection.verticalScale);
  const sidePlanar = select(
    abs(farNormal.r).greaterThan(abs(farNormal.g)),
    vec2(worldXZ.y, vertical),
    vec2(worldXZ.x, vertical),
  );
  const slope = terrainShape.r;
  const sidePrimary = projectedDetail({
    atlas,
    planarMeters: sidePlanar,
    familyIndex: pair.primaryIndex,
    families,
    microVisibility,
  });
  const sideSecondary = projectedDetail({
    atlas,
    planarMeters: sidePlanar,
    familyIndex: pair.secondaryIndex,
    families,
    microVisibility,
    secondary: true,
  });
  const sideDetail = mix(sidePrimary, sideSecondary, blend);
  const projectionBlend = smoothstep(
    families.projection.slopeStart,
    families.projection.slopeFull,
    slope,
  );
  const projected = select(
    slope.lessThan(families.projection.slopeStart),
    topDetail,
    select(
      slope.greaterThan(families.projection.slopeFull),
      sideDetail,
      mix(topDetail, sideDetail, projectionBlend),
    ),
  );
  const environmentScale = mix(float(1), float(families.environment.wetDetailScale), wetness)
    .mul(mix(float(1), float(families.environment.canopyDetailScale), canopy));
  const pairConfidence = clamp(pair.primaryWeight.add(pair.secondaryWeight), 0, 1);
  const confidenceScale = pow(pairConfidence, families.dominantFadePower);
  const strength = confidenceScale.mul(environmentScale).mul(families.strength);
  return mix(vec3(1), projected, strength);
}
