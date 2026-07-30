/**
 * The drow's three materials.
 *
 * All three are `MeshPhysicalNodeMaterial`, so the character is lit by the same
 * sun and reads the same shadow maps as the terrain, the trees and the buildings.
 * The source repo shaded its figure against its own sky LUT and cascade stack;
 * reproducing that here would have meant a second lighting model in the scene,
 * and a character lit differently from the ground it stands on looks pasted on no
 * matter how good the fabric is.
 *
 * The body and the garments differ in exactly one thing — where their vertices
 * come from. The surface shading is literally the same graph.
 *
 * Nothing here samples `viewportDepthTexture` or `viewportOpaqueMipTexture`.
 * Those are whole-frame costs that a mesh pays merely by existing in the
 * material, culled or not (see CLAUDE.md and
 * `docs/perf-investigation-2026-07-28.md`), and a character that is on screen
 * only in walk mode must not levy one.
 * `test/character-material-contract.test.js` pins it.
 */

import * as THREE from 'three/webgpu';
import {
  attribute, clamp, dot, float, fract, positionLocal, sin, smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import { createSkinNodes } from './characterSkinNodes.js';
import { createClothSurfaceNodes } from './clothSurfaceNodes.js';
import { createDrowFabricNodes } from './drowFabricNodes.js';

/**
 * Threads per metre. Coarse hand-woven wool, which puts the weave right at the
 * edge of visibility at the distance the figure is normally framed — present in
 * a close-up, gone by ten metres.
 */
const WEAVE_DENSITY = 210;

/** Strand cells per metre on the fur. 260 is a 3.8 mm pitch. */
const FUR_DENSITY = 260;

function baseMaterial(name) {
  const material = new THREE.MeshPhysicalNodeMaterial();
  material.name = name;
  // Every garment is an open sheet and the cowl is a shell, so both faces are
  // visible.
  material.side = THREE.DoubleSide;
  material.metalness = 0;
  material.sheenRoughness = 0.65;
  return material;
}

/**
 * The skinned body: head, ears, eyes, scarf, cowl, torso, arms, boots.
 *
 * @param {object} options
 * @param {import('three').DataTexture} options.transformTexture
 * @param {ReturnType<import('./DrowPalette.js').createDrowPalette>} options.palette
 * @param {import('three').Vector3} options.sunDirection
 */
export function createDrowBodyMaterial({ transformTexture, palette, sunDirection }) {
  const skin = createSkinNodes(transformTexture);
  const fabric = createDrowFabricNodes({
    palette, sunDirection, weaveDensity: WEAVE_DENSITY,
  });

  const material = baseMaterial('drow-body');
  material.positionNode = skin.position(positionLocal);
  material.normalNode = skin.normal(attribute('normal', 'vec3'));
  material.colorNode = fabric.colorNode;
  material.roughnessNode = fabric.roughnessNode;
  material.sheenNode = fabric.sheenNode;
  material.emissiveNode = fabric.emissiveNode;
  material.userData.drowUniforms = fabric.uniforms;
  return material;
}

/**
 * The simulated garments: robe, piwafwi, sleeves, hair.
 *
 * This is the only material with a real tangent frame — the Catmull-Rom
 * reconstruction hands back both surface derivatives — so it is the one that
 * gets the weave's normal perturbation and the hair's anisotropic streak.
 */
export function createDrowClothMaterial({ transformTexture, palette, sunDirection }) {
  const cloth = createClothSurfaceNodes(transformTexture);
  const surface = cloth.surface(positionLocal.xy);

  const fabric = createDrowFabricNodes({
    palette,
    sunDirection,
    weaveDensity: WEAVE_DENSITY,
    tangents: { tangentU: surface.tangentU, tangentV: surface.tangentV },
  });

  const material = baseMaterial('drow-cloth');
  material.positionNode = surface.position;
  material.normalNode = fabric.weaveNormal(surface.normal);
  material.colorNode = fabric.colorNode;
  material.roughnessNode = fabric.roughnessNode;
  material.sheenNode = fabric.sheenNode;
  // The hair's highlight rides in on the emissive channel. It is a specular lobe
  // wearing a disguise: three.js's own `anisotropy` input wants a tangent frame
  // built from a `position` attribute, and on this mesh `position` is a panel
  // parameter, not a location. Computing the lobe explicitly against the scene
  // sun is both correct and the only thing that fits.
  material.emissiveNode = fabric.emissiveNode.add(fabric.hairStreak());
  material.userData.drowUniforms = fabric.uniforms;
  return material;
}

/**
 * Shell fur on the hood rim and the cuffs.
 *
 * Each shell is a copy of the trim's surface pushed further out; this decides,
 * per pixel per shell, whether a strand is still present there. Two hashed
 * quantities per strand cell do all the work:
 *
 *   length   how far up the shell stack a strand survives. Uniform-length fur
 *            reads as a sponge; the variation is what makes it fur.
 *   radius   the strand's cross-section, tapering to nothing at its own tip, so
 *            the silhouette is pointed rather than cut off flat.
 *
 * `aux.x` is the shell parameter here rather than a material slot, so this
 * material does not use the palette's slot lookup at all.
 */
export function createDrowFurMaterial({ transformTexture, palette, sunDirection }) {
  const skin = createSkinNodes(transformTexture);
  const aux = attribute('aux', 'vec2');
  const shell = aux.x;
  const baked = aux.y;

  const material = baseMaterial('drow-fur');
  material.positionNode = skin.position(positionLocal);
  material.normalNode = skin.normal(attribute('normal', 'vec3'));

  // Strand cells, in metres of surface: `uv.x` is arc length around the band and
  // `uv.y` runs across it, both written in metres by the band builder, so hood
  // fur and cuff fur come out at the same physical scale.
  const cell = uv().mul(FUR_DENSITY);
  const cellId = cell.floor();
  const id = fract(sin(dot(cellId, vec2(12.9898, 78.233))).mul(43758.5453));
  const id2 = fract(sin(dot(cellId, vec2(39.3468, 11.135))).mul(24634.6345));
  const local = fract(cell).sub(0.5);
  const strandRadius = local.length().mul(2);

  // A strand survives up the stack as far as its own hashed length, and thins as
  // it goes, so tips come to a point at different heights.
  const strandLength = float(0.35).add(id.mul(0.65));
  const alive = smoothstep(strandLength, strandLength.sub(0.22), shell);
  const taper = clamp(float(1).sub(shell.div(strandLength.max(0.001))), 0, 1);
  const width = float(0.35).add(id2.mul(0.35)).mul(taper);
  const coverage = smoothstep(width, width.mul(0.55), strandRadius).mul(alive);

  material.opacityNode = coverage;
  material.alphaTest = 0.32;
  // Silver-white, darkening into the roots where the band is buried in its own
  // depth. `sheenTint` slot 6 is the fur's colour.
  const silver = vec3(palette.sheenTint[24], palette.sheenTint[25], palette.sheenTint[26]);
  const albedo = vec3(palette.albedo[24], palette.albedo[25], palette.albedo[26]);
  const rootShade = float(0.35).add(shell.mul(0.65));
  material.colorNode = albedo.mul(baked).mul(rootShade);
  material.roughnessNode = float(palette.albedo[27]);
  material.sheenNode = silver.mul(palette.params[24]);
  material.userData.drowUniforms = null;
  return material;
}

export { WEAVE_DENSITY, FUR_DENSITY };
