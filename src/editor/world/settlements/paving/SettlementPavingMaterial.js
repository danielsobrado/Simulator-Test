import * as THREE from 'three/webgpu';
import { attribute, color, dot, float, fract, mix, mx_noise_float, positionWorld, sin, smoothstep, step, texture, uv, vec2, vec3 } from 'three/tsl';
import { treadPaving } from '../../../../render/materials/townWeathering.js';
import { TOWN_WET_FAMILIES, wetTownSurface } from '../../../../render/materials/townWetness.js';
import { buildingShadeEmission } from '../../../stylized/forest/foliageLight.js';
import { TOWN_GROUND } from '../view/SettlementGrade.js';

/** Paving wears a hint of the town's own stone over the photographed surface. */
const STONE_TINT = Object.freeze({
  granite: '#f4f0e8',
  limestone: '#fff4dc',
  // Warm enough to belong to its town, short of turning grey flags orange.
  sandstone: '#f8e8d4',
});
/**
 * Polygon offset per layer, on top of its geometric lift: distant paving
 * shares depth precision with the terrain a few centimetres beneath it.
 */
/** The earth photograph is darker than the tone it is tinted to; this brings the product back to it. */
const EARTH_LIFT = 1.75;
const DEPTH_BIAS = Object.freeze({ earth: -2, cobble: -3, flagstone: -4 });

/**
 * The occlusion layer's material: black, laid over the ground by how much sky a
 * vertex has lost (SettlementPavingGeometry.addShade). One for every town.
 */
export function createShadeMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({
    color: '#0d0b09',
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -10,
  });
  material.opacityNode = attribute('pavingEdge', 'float').oneMinus().pow(2.2).mul(0.34);
  material.name = 'settlement-ground-shade';
  return material;
}

/**
 * The material of one paving layer in one surface set.
 *
 * @param {'earth'|'cobble'|'flagstone'} layer
 * @param {{ color: THREE.Texture, normal: THREE.Texture, arm: THREE.Texture }} set
 * @param {string} stoneStyle the settlement's stone, for the tint
 */
export function createPavingMaterial(layer, set, stoneStyle) {
  const material = new THREE.MeshStandardNodeMaterial({
    // Earth is the town's one ground tone — the same the walls are washed with at their feet.
    color: layer === 'earth'
      ? new THREE.Color().setRGB(TOWN_GROUND[0] * EARTH_LIFT, TOWN_GROUND[1] * EARTH_LIFT, TOWN_GROUND[2] * EARTH_LIFT)
      : (STONE_TINT[stoneStyle] ?? '#ffffff'),
    map: set.color,
    normalMap: set.normal,
    // Restrained relief to sit with the stylized terrain and boulders.
    normalScale: new THREE.Vector2(1.0, 1.0),
    // Packed AO / roughness / metalness: three reads AO from red, roughness from green.
    roughnessMap: set.arm,
    aoMap: set.arm,
    aoMapIntensity: 1,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    envMapIntensity: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: DEPTH_BIAS[layer],
    polygonOffsetUnits: DEPTH_BIAS[layer] * 2,
  });
  // The border breaks up stone by stone: toward the edge only texels standing
  // proud survive — the occlusion map is dark in the joints, so those go first.
  // The cut is also scattered by a fine grain fixed in the world, so the edge is
  // a thinning of grit over a metre rather than a line: the paving runs out
  // into the grass, and one layer into the next, without a seam.
  const cut = smoothstep(0.05, 1, attribute('pavingEdge', 'float'));
  const grain = fract(sin(dot(positionWorld.xz.mul(31), vec2(12.9898, 78.233))).mul(43758.5453));
  material.opacityNode = step(cut, texture(set.arm, uv()).r.mul(0.38).add(grain.mul(0.58)).add(0.04));
  material.alphaTest = 0.5;
  // Paving lies flat open to the rain: stone's darkening and wet gloss, so a
  // street in the rain reads wet rather than only foggy.
  const wet = wetTownSurface(untiledColour(set.color, set.arm, material.color), texture(set.arm, uv()).g, float(1), TOWN_WET_FAMILIES.stone);
  material.colorNode = wet.color;
  material.roughnessNode = wet.roughness;
  material.emissiveNode = buildingShadeEmission(material.colorNode, { fill: 1.35, bounce: 0.8 });
  material.name = `settlement-paving-${layer}-${set.name}`;
  return material;
}

/**
 * How dark a joint gets in the colour itself. Three applies the occlusion map
 * to ambient light only, so under sun a joint between setts was as bright as
 * the stones and a square read as one flat sheet.
 */
const JOINT_SHADE = 0.42;
/** The second sample's frame: turned, rescaled and shifted against the first, so their repeats never align. */
const ALT_TURN = 1.13;
const ALT_SCALE = 0.83;


/**
 * A photographed set repeats every tile, and across a square the repeat reads
 * as a grid. Two samples — the set as laid, and the set turned and rescaled —
 * are blended by noise a few tiles across, and a broad drift moves the tone, so
 * no two tiles of a street are alike. Trodden grime gathers in patches over
 * that. Joints darken from the laid sample's occlusion, so the stones read
 * in sun as well as shade. Normals stay on the laid sample: the repeat is seen
 * in colour, not in relief.
 */
function untiledColour(map, arm, tint) {
  const laid = uv();
  const [cos, sin_] = [Math.cos(ALT_TURN), Math.sin(ALT_TURN)];
  const turned = vec2(laid.x.mul(cos).sub(laid.y.mul(sin_)), laid.x.mul(sin_).add(laid.y.mul(cos))).mul(ALT_SCALE).add(vec2(0.37, 0.71));
  const blend = smoothstep(-0.28, 0.28, mx_noise_float(vec3(laid.mul(0.31), 0.5)));
  const drift = mx_noise_float(vec3(laid.mul(0.11), 3.7)).mul(0.16).add(1);
  const joints = mix(float(JOINT_SHADE), float(1), smoothstep(0.25, 0.85, texture(arm, laid).r));
  const surface = mix(texture(map, laid).rgb, texture(map, turned).rgb, blend).mul(color(tint)).mul(drift).mul(joints);
  return treadPaving(surface, laid);
}
