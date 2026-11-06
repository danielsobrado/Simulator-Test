import * as THREE from 'three/webgpu';
import { dot, float, materialColor, materialNormal, materialRoughness, mix, normalWorld, positionGeometry, vec3, vertexColor } from 'three/tsl';

import { WEATHER_FAMILIES, weatherTownSurface } from './townWeathering.js';
import { TOWN_WET_FAMILIES, wetTownSurface } from './townWetness.js';
import { filterSpecularRoughness } from './specularAntialiasing.js';
import { buildingShadeEmission } from '../../editor/stylized/forest/foliageLight.js';

/**
 * One palette for a whole town — and for every workshop building, so a house
 * looks the same in the workshop, as a baked object and in a settlement.
 *
 * The style of the terrain's painted rocks, not their colours: quiet painterly
 * planes (median-softened surface sets, restrained relief), and the rocks' sky
 * fill, ground bounce and distance air (`buildingShadeEmission`). Each town keeps
 * its own palette — its culture's stone, its slate or terracotta roofs, its
 * limewash, ochre or rose render, its timber tone (SettlementProfile,
 * SettlementDressing) — so no two peoples' towns read alike.
 */
export const TOWN_GROUND = Object.freeze([0.47, 0.41, 0.33]);

/** A multiplier per material family, in linear colour. */
const FAMILY_GRADE = Object.freeze({
  stone: [0.98, 0.96, 0.92],
  mortar: [1.0, 0.97, 0.92],
  wood: [0.98, 0.95, 0.90],
  roof: [0.95, 0.92, 0.88],
});
/**
 * Joint mortar of bare masonry, as a share of the stone it binds. Recessed joints
 * read darker than the faces they part already, from baked crevice occlusion:
 * much below this and the joints outdraw the stone, near black from any distance.
 */
const JOINT_DARKENING = 0.92;
const WEATHER_OF_SLOT = Object.freeze({ stone: 'stone', wood: 'timber', roof: 'roof' });
/**
 * A little of the medieval kit's daylight in each family — warm grey stone,
 * cream render, brown timber — at its own brightness, lifted by `gain`. `keep`
 * is how much of the town's own hue stays: high, so granite stays cool grey and
 * sandstone warm, rose render rose and ochre ochre. Pulled harder (keep 0.2-0.4)
 * every town came out the same warm limestone. Roofs take no pull at all:
 * slate against terracotta is the first thing that tells two towns apart.
 */
const KIT_HUE = Object.freeze({
  stone: Object.freeze({ hue: [1.24, 1.0, 0.74], keep: 0.78, gain: 1.04 }),
  // The rubble photograph is darker and greyer than dressed faces: lifted, and pulled a little more.
  rubble: Object.freeze({ hue: [1.24, 1.0, 0.74], keep: 0.55, gain: 1.28 }),
  render: Object.freeze({ hue: [1.14, 1.0, 0.78], keep: 0.72, gain: 1.14 }),
  wood: Object.freeze({ hue: [1.28, 0.96, 0.70], keep: 0.65, gain: 0.94 }),
});
const LUMA = [0.3, 0.55, 0.15];
const FORGED_IRON = new THREE.Color('#464039');
/**
 * Restrained surface relief so masonry, timber and roof planes read with the same
 * clean bevelled faceting as the stylized rock pack rather than noisy photo-grit.
 */
const RELIEF = Object.freeze({ stone: 1.05, wood: 1.0, mortar: 0.95, roof: 1.0 });

function kitHued(albedo, { hue, keep, gain }) {
  const scale = 1 / (hue[0] * LUMA[0] + hue[1] * LUMA[1] + hue[2] * LUMA[2]);
  const target = vec3(...hue.map((channel) => channel * scale * gain));
  return mix(target.mul(dot(albedo, vec3(...LUMA))), albedo.mul(gain), keep);
}
/** Offset, in metres, between two instances' weathering, from their stable seed. */
const SEED_SPREAD = 173;

/**
 * Grade one workshop material. Weathering is placed in the mesh's own frame,
 * where the ground is y = 0, so it follows every instance; `seed` (a node)
 * shifts the pattern, so a street of one pooled variant is not weathered alike.
 *
 * @param {object} material a workshop material (ProceduralWorkshopMaterials)
 * @param {string} slot its material family
 * @param {{ plastered?: boolean, seed?: import('three/tsl').Node }} [options]
 *   whether the `mortar` family is a rendered wall, and the weathering offset seed
 */
export function gradeTownMaterial(material, slot, { plastered = true, seed = float(0) } = {}) {
  if (slot === 'metal') {
    // The workshop's fittings are brass; a town's hinges, studs, brackets and
    // shutter stays are warm forged iron, lifted by the shared sky/ground bounce.
    material.color.copy(FORGED_IRON);
    material.metalness = 0.5;
    material.roughness = 0.62;
  }
  const grade = FAMILY_GRADE[slot];
  if (!grade) {
    // Emissive and metal families are left as authored; the dithered instance
    // material still wants an explicit colour node to vary.
    material.colorNode ??= materialColor;
    if (slot === 'metal') {
      const shade = buildingShadeEmission(material.colorNode, { fill: 1.4, bounce: 1.6 });
      material.emissiveNode = material.emissiveNode ? material.emissiveNode.add(shade) : shade;
    }
    return;
  }
  // A masonry finish dressed in the town's rubble set is a stone wall, graded as stone;
  // without one, its `mortar` family is the joint mortar behind the blocks.
  const rubble = slot === 'mortar' && !plastered && Boolean(material.map);
  const role = rubble ? 'stone' : slot;
  if (material.normalMap && RELIEF[role]) material.normalScale.multiplyScalar(RELIEF[role]);
  const joints = slot === 'mortar' && !plastered && !rubble;
  const familyKey = slot === 'mortar' && !rubble ? (plastered ? 'plaster' : 'mortar') : WEATHER_OF_SLOT[role];
  const family = WEATHER_FAMILIES[familyKey];
  const tone = joints ? grade.map((channel) => channel * JOINT_DARKENING) : grade;
  const spread = seed.mul(SEED_SPREAD);
  // Three multiplies vertex colours in after the colour node, which would put the
  // per-stone palette back after it was graded: take it in here instead.
  const painted = material.vertexColors ? materialColor.rgb.mul(vertexColor().rgb) : materialColor.rgb;
  material.vertexColors = false;
  let albedo = painted.mul(vec3(...(rubble ? FAMILY_GRADE.stone : tone)));
  const hued = rubble ? KIT_HUE.rubble : slot === 'mortar' ? (plastered ? KIT_HUE.render : null) : KIT_HUE[slot];
  if (hued) albedo = kitHued(albedo, hued);
  material.colorNode = weatherTownSurface(albedo, {
    place: positionGeometry.add(vec3(spread, 0, spread.mul(0.61))),
    up: normalWorld.y,
    height: positionGeometry.y,
    family,
  });
  const wet = wetTownSurface(material.colorNode, material.roughnessNode ?? materialRoughness,
    normalWorld.y, TOWN_WET_FAMILIES[familyKey]);
  material.colorNode = wet.color;
  material.roughnessNode = wet.roughness;
  const shadeEmission = buildingShadeEmission(material.colorNode);
  material.emissiveNode = material.emissiveNode ? material.emissiveNode.add(shadeEmission) : shadeEmission;
  if (material.normalMap && !material.normalNode) {
    // Share the lit normal's sample and UV transform. A separate texture() here
    // made the shader fetch the same normal map twice for every visible wall.
    const normal = materialNormal.getTexture('normal').xyz.mul(2).sub(1);
    const scale = materialNormal.getCache('normalScale', 'vec2');
    material.roughnessNode = filterSpecularRoughness(wet.roughness, normal.mul(vec3(scale, 1)));
  }
}
