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
  texture,
  vec2,
  vec3,
} from 'three/tsl';

const HASH_VECTOR_A = Object.freeze([127.1, 311.7]);
const HASH_VECTOR_B = Object.freeze([269.5, 183.3]);
const HASH_SCALE = 43758.5453;
const SQRT_THREE_OVER_TWO = Math.sqrt(3) * 0.5;
const TRIANGLE_SKEW = 0.5;
const MIN_DETAIL_MULTIPLIER = 0.65;
const MAX_DETAIL_MULTIPLIER = 1.35;

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

  return sampleVariant(atlas, baseUv, vertex0, familyIndex, variantsPerFamily, scaleJitter)
    .mul(weight0)
    .add(sampleVariant(
      atlas, baseUv, vertex1, familyIndex, variantsPerFamily, scaleJitter,
    ).mul(weight1))
    .add(sampleVariant(
      atlas, baseUv, vertex2, familyIndex, variantsPerFamily, scaleJitter,
    ).mul(weight2));
}

function dominantFamily(weights) {
  const rockOrSnow = max(weights.b, weights.a);
  const grassOrDirt = max(weights.r, weights.g);
  const snowWinsRock = weights.a.greaterThan(weights.b);
  const dirtWinsGrass = weights.g.greaterThan(weights.r);
  const rockFamily = select(snowWinsRock, float(3), float(2));
  const groundFamily = select(dirtWinsGrass, float(1), float(0));
  return {
    index: select(rockOrSnow.greaterThan(grassOrDirt), rockFamily, groundFamily),
    dominance: max(rockOrSnow, grassOrDirt),
  };
}

function microVariation(planarMeters, scaleMeters, strength, visibility) {
  const first = sin(dot(planarMeters, vec2(1.73, 2.31)).div(scaleMeters));
  const second = sin(dot(planarMeters, vec2(-2.17, 1.41)).div(scaleMeters * 0.63));
  return first.mul(second).mul(strength).mul(visibility);
}

function projectedDetail({
  atlas,
  planarMeters,
  familyIndex,
  families,
  microVisibility,
}) {
  const sample = stochasticTriSample({
    atlas,
    planarMeters,
    mesoScaleMeters: families.mesoScaleMeters,
    variantCellMeters: families.variantCellMeters,
    familyIndex,
    variantsPerFamily: families.variantsPerFamily,
    scaleJitter: families.scaleJitter,
  });
  const meso = sample.sub(0.5).mul(families.mesoStrength * 2);
  const micro = microVariation(
    planarMeters,
    families.microScaleMeters,
    families.microStrength,
    microVisibility,
  );
  return clamp(
    vec3(1).add(meso).add(vec3(micro)),
    vec3(MIN_DETAIL_MULTIPLIER),
    vec3(MAX_DETAIL_MULTIPLIER),
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
  const dominant = dominantFamily(materialWeights);
  const microVisibility = oneMinus(smoothstep(
    families.microFadeStartDistance,
    families.microFadeEndDistance,
    cameraDistance,
  ));
  const topDetail = projectedDetail({
    atlas,
    planarMeters: worldXZ,
    familyIndex: dominant.index,
    families,
    microVisibility,
  });
  const vertical = terrainHeight.mul(families.projection.verticalScale);
  const sidePlanar = select(
    abs(farNormal.r).greaterThan(abs(farNormal.g)),
    vec2(worldXZ.y, vertical),
    vec2(worldXZ.x, vertical),
  );
  const slope = terrainShape.r;
  const sideDetail = projectedDetail({
    atlas,
    planarMeters: sidePlanar,
    familyIndex: dominant.index,
    families,
    microVisibility,
  });
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
  const dominanceConfidence = clamp(dominant.dominance.mul(2).sub(1), 0, 1);
  const dominanceScale = pow(dominanceConfidence, families.dominantFadePower);
  const strength = dominanceScale.mul(environmentScale).mul(families.strength);
  return mix(vec3(1), projected, strength);
}
