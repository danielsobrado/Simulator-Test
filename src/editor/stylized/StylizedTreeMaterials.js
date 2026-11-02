import * as THREE from 'three/webgpu';
import {
  attribute,
  clamp,
  dot,
  float,
  max,
  mix,
  normalView,
  oneMinus,
  positionGeometry,
  positionLocal,
  positionView,
  positionViewDirection,
  pow,
  saturate,
  texture,
  triplanarTexture,
  uv,
  vec3,
} from 'three/tsl';
import { authoredTexture } from './AuthoredTextureNode.js';
import { stylizedFbm } from './StylizedNoiseNodes.js';
import { registerTreeWindTime } from './forest/TreeWindTime.js';
import { gradeCanopy, resolveCanopyGrade } from './forest/canopyGrade.js';
import { crownEdgeNodes } from './forest/crownEdge.js';
import { treeBarkEmission, treeFoliageEmission } from './forest/foliageLight.js';
import { foliageMaterialClass } from './forest/FoliageNodeMaterial.js';
import { foliageWindPosition } from './forest/foliageWind.js';
import { treeBendPosition } from './forest/treeSway.js';
import { assignTreeFoliageMaterialData } from '../../render/postprocessing/PostProcessingMaterialData.js';
import { applyBarkWeathering } from './barkWeathering.js';
import { gradeBark, resolveBarkGrade } from './forest/barkGrade.js';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

function paletteValue(palette, config, key) {
  return palette?.[key] ?? config.trees[key];
}

function applyCanopyRim(baseColor, config, palette) {
  const strength = paletteValue(palette, config, 'rimStrength');
  if (!(strength > 0)) return baseColor;
  const facing = saturate(dot(normalView, positionViewDirection));
  const rim = pow(oneMinus(facing), paletteValue(palette, config, 'rimPower'));
  return mix(
    baseColor,
    colorNode(paletteValue(palette, config, 'rimColor')),
    rim.mul(strength),
  );
}

export function createStylizedLeafMaterial({
  source,
  leafMap,
  bounds,
  treeTopY = bounds.maxY,
  // Metres from the trunk axis to the crown's outside; with it, the crown's edge
  // dissolves into the sky (crownEdge.js).
  crownRadius = 0,
  time,
  config,
  palette = null,
  alphaTest = 0,
  preserveSourceColor = false,
  vertexColor = false,
  // Brightens an authored leaf texture before the canopy grade reads it. A dark
  // atlas falls under the grade's dark-texel guard and keeps its raw hue — the
  // forest-pack narrow conifer's brown leaf cards stayed brown and, under
  // foliage lighting and haze, read as pale cream columns in the taiga.
  leafGain = 1,
  // False keeps a painted crown's own texture colour (times COLOR_0 when the
  // geometry carries it) instead of re-grading it onto the shared green ramp:
  // the swamp giants' grey moss and olive leaves are not canopy greens.
  canopyGrade = true,
}) {
  registerTreeWindTime(config, time);
  // Height within the crown from the prototype's own geometry: `positionLocal`
  // here is already placed by the instance matrix (see preInstancePosition), so
  // against the prototype bounds it would read every leaf as the crown top.
  const normalizedHeight = clamp(
    positionGeometry.y.sub(bounds.minY).div(Math.max(0.001, bounds.maxY - bounds.minY)),
    0,
    1,
  );
  // The crown bends with the whole tree from the ground, not from its own base;
  // pivoting at the crown's lowest leaf sheared every canopy like a grass blade.
  const finalPosition = foliageWindPosition({ config, time, topY: treeTopY });

  const gradient = pow(normalizedHeight, config.trees.gradientPower);
  const map = leafMap ?? source?.map ?? null;
  const paletteColor = mix(
    colorNode(paletteValue(palette, config, 'leafBottom')),
    colorNode(paletteValue(palette, config, 'leafTop')),
    gradient,
  );
  // An authored crown keeps its own colour: from its texture, or — for crowns
  // painted per vertex, like grass-test's snow-laden alpine conifers, whose needles
  // and settled snow share one leaf part — from COLOR_0. Only a geometry that
  // carries the attribute may ask for it.
  let authoredColor = null;
  if (preserveSourceColor && map) {
    const painted = authoredTexture(map).rgb.mul(colorNode(source?.color ?? '#ffffff')).mul(leafGain);
    authoredColor = canopyGrade
      ? gradeCanopy(painted, resolveCanopyGrade(config.trees?.canopyGrade))
      : (vertexColor ? painted.mul(attribute('color', 'vec3')) : painted);
  } else if (preserveSourceColor && vertexColor) {
    authoredColor = attribute('color', 'vec3');
  }
  const baseColor = authoredColor ?? paletteColor;
  const variation = stylizedFbm(
    positionLocal.xz.add(positionLocal.y).mul(config.trees.variationScale),
  ).sub(0.5);
  const leafColor = max(
    baseColor.add(
      colorNode(paletteValue(palette, config, 'variationColor'))
        .sub(baseColor)
        .mul(variation)
        .mul(config.trees.variationStrength),
    ),
    vec3(0),
  ).mul(paletteValue(palette, config, 'brightness'));

  const material = new (foliageMaterialClass(THREE.MeshLambertNodeMaterial))({ side: THREE.DoubleSide });
  if (authoredColor) material.foliageTransmissionNode = float(0.8);
  material.positionNode = finalPosition;
  if (authoredColor && map) {
    // A textured crown is lit the way its donor lit it: the graded leaf colour,
    // sky fill in the shaded interior and sun through the leaves. No rim and no
    // noise variation — on a crown of flat cards both key to each card's own
    // facing and paint it in cream and dark-green camouflage patches.
    const crown = authoredColor.mul(paletteValue(palette, config, 'brightness'));
    const edge = crownRadius > 0
      ? crownEdgeNodes(authoredTexture(map).a, {
        cut: alphaTest > 0 ? alphaTest : (source?.alphaTest ?? config.trees.cardAlphaTest ?? 0.32),
        radius: crownRadius,
        height: normalizedHeight,
      })
      : null;
    // Lit less as it takes the sky on, or a sunlit rim would out-shine the sky.
    material.colorNode = edge ? crown.mul(edge.sky.oneMinus()) : crown;
    material.emissiveNode = treeFoliageEmission(crown, edge?.sky);
    material.userData.crownOpacity = edge?.opacity ?? null;
    // Its biome and autumn tints are ratios against the grade, not the palette.
    material.userData.gradedCanopy = canopyGrade;
  } else {
    material.colorNode = applyCanopyRim(leafColor, config, palette);
    // A vertex-painted crown has no leaf map but the same dark interior: without
    // sky fill the alpine conifers render near black beside every other tree.
    if (authoredColor) material.emissiveNode = treeFoliageEmission(leafColor);
  }
  if (map) {
    material.opacityNode = material.userData.crownOpacity ?? authoredTexture(map).a;
    material.alphaTest = alphaTest > 0
      ? alphaTest
      : (source?.alphaTest > 0
        ? source.alphaTest
        : (config.trees.cardAlphaTest ?? 0.32));
  }
  material.transparent = false;
  return assignTreeFoliageMaterialData(material);
}

function bumpNormal(height) {
  const positionDerivativeX = positionView.dFdx();
  const positionDerivativeY = positionView.dFdy();
  const tangentX = positionDerivativeY.cross(normalView);
  const tangentY = normalView.cross(positionDerivativeX);
  const determinant = positionDerivativeX.dot(tangentX);
  const gradient = determinant.sign().mul(
    height.dFdx().mul(tangentX).add(height.dFdy().mul(tangentY)),
  );
  return determinant.abs().mul(normalView).sub(gradient).normalize();
}

/**
 * Bark takes the same ground-pivoted bend as its crown (`sway` = { time, config,
 * topY }), so the trunk curves with the canopy instead of standing still under it.
 */
function withTrunkSway(material, sway) {
  if (sway?.time) material.positionNode = treeBendPosition(sway);
  return material;
}

/** After weathering, so moss and soil take the same fill as the bark. */
function withBarkLight(material) {
  material.emissiveNode = treeBarkEmission(material.colorNode);
  return material;
}

export function createAuthoredTrunkMaterial({
  source,
  sourceMap = null,
  barkTextures = null,
  barkScale = 0.8,
  barkWeathering = null,
  barkGrade = null,
  sway = null,
}) {
  if (!barkTextures) {
    const material = new THREE.MeshLambertNodeMaterial({
      side: source?.side ?? THREE.FrontSide,
    });
    const baseColor = colorNode(source?.color ?? '#ffffff');
    const albedo = sourceMap
      ? authoredTexture(sourceMap).rgb.mul(baseColor)
      : baseColor;
    material.colorNode = gradeBark(albedo, resolveBarkGrade(barkGrade));
    return withBarkLight(withTrunkSway(applyBarkWeathering(material, { settings: barkWeathering }), sway));
  }

  const albedoHeight = triplanarTexture(
    texture(barkTextures.albedoHeight),
    null,
    null,
    barkScale,
  );
  const normalRoughness = triplanarTexture(
    texture(barkTextures.normalRoughness),
    null,
    null,
    barkScale,
  );
  const decodedAlbedo = albedoHeight.rgb.mul(albedoHeight.rgb);
  const sourceColor = colorNode(source?.color ?? '#6b4a30');
  const barkColor = mix(sourceColor, decodedAlbedo.mul(1.35), 0.72)
    .mul(albedoHeight.a.mul(0.45).add(0.68));

  const material = new THREE.MeshStandardNodeMaterial({
    side: source?.side ?? THREE.FrontSide,
  });
  material.colorNode = gradeBark(barkColor, resolveBarkGrade(barkGrade));
  material.normalNode = bumpNormal(albedoHeight.a.mul(0.045));
  material.roughnessNode = normalRoughness.b;
  material.metalness = 0;
  return withBarkLight(withTrunkSway(applyBarkWeathering(material, { settings: barkWeathering }), sway));
}

export function createStylizedTrunkMaterial({ textures, config, palette = null, sway = null }) {
  const bark = texture(textures.color, uv().mul(config.trees.barkScale)).rgb;
  const ao = texture(textures.ao, uv().mul(config.trees.barkScale)).r;
  const relief = texture(textures.height, uv().mul(config.trees.barkScale)).r;
  const tint = colorNode(paletteValue(palette, config, 'barkTint'));
  const barkColor = mix(bark, tint, paletteValue(palette, config, 'barkTintStrength'))
    .mul(mix(1, ao, config.trees.barkAoStrength))
    .mul(mix(0.82, 1.18, relief.mul(config.trees.barkRelief)))
    .mul(paletteValue(palette, config, 'barkBrightness'));
  const material = new THREE.MeshLambertNodeMaterial();
  material.colorNode = barkColor;
  return withTrunkSway(material, sway);
}
