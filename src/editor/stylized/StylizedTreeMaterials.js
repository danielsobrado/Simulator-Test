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
  positionViewDirection,
  pow,
  saturate,
  vec3,
} from 'three/tsl';
import { authoredTexture } from './AuthoredTextureNode.js';
import { stylizedFbm } from './StylizedNoiseNodes.js';
import { registerTreeWindTime } from './forest/TreeWindTime.js';
import { gradeCanopy, resolveCanopyGrade } from './forest/canopyGrade.js';
import { crownEdgeNodes } from './forest/crownEdge.js';
import { treeFoliageEmission } from './forest/foliageLight.js';
import { addTreeEmission, createTreeSurfaceMaterial } from './forest/TreeSurfaceMaterial.js';
import { foliageWindPosition } from './forest/foliageWind.js';
import { assignTreeFoliageMaterialData } from '../../render/postprocessing/PostProcessingMaterialData.js';
export { createAuthoredTrunkMaterial, createStylizedTrunkMaterial } from './forest/TreeBarkMaterial.js';

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
    const painted = authoredTexture(map).rgb.mul(colorNode(source?.color ?? '#ffffff')).mul(leafGain)
      .mul(vertexColor ? attribute('color', 'vec3') : 1);
    authoredColor = canopyGrade
      ? gradeCanopy(painted, resolveCanopyGrade(config.trees?.canopyGrade))
      : painted;
  } else if (preserveSourceColor && vertexColor) {
    authoredColor = attribute('color', 'vec3').mul(colorNode(source?.color ?? '#ffffff'));
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

  const material = createTreeSurfaceMaterial(preserveSourceColor ? source : null, { foliage: true });
  material.map = map;
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
    addTreeEmission(material, treeFoliageEmission(crown, edge?.sky));
    material.userData.crownOpacity = edge?.opacity ?? null;
    // Its biome and autumn tints are ratios against the grade, not the palette.
    material.userData.gradedCanopy = canopyGrade;
  } else {
    material.colorNode = applyCanopyRim(leafColor, config, palette);
    // A vertex-painted crown has no leaf map but the same dark interior: without
    // sky fill the alpine conifers render near black beside every other tree.
    if (authoredColor) addTreeEmission(material, treeFoliageEmission(leafColor));
  }
  if (map) {
    material.opacityNode = material.userData.crownOpacity ?? authoredTexture(map).a;
    if (source?.alphaMap) material.opacityNode = material.opacityNode.mul(authoredTexture(source.alphaMap).g);
    if (source?.opacity < 1) material.opacityNode = material.opacityNode.mul(source.opacity);
    material.alphaTest = alphaTest > 0
      ? alphaTest
      : (source?.alphaTest > 0
        ? source.alphaTest
        : (config.trees.cardAlphaTest ?? 0.32));
  }
  material.transparent = false;
  return assignTreeFoliageMaterialData(material);
}
