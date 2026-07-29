import { mixSeed } from './ProceduralRandom.js';

/**
 * Per-unit shape irregularity for masonry and roof tiles.
 *
 * Implements the stone-shape rules in
 * docs/plans/procedural-medieval-construction/04-masonry-and-stone-generation.md
 * §8 ("vary corners in a controlled plane", "stronger irregularity for rubble
 * than ashlar", "reduce irregularity at structural dressings") and §14 (seed
 * locality: a unit's shape depends only on its own stable index).
 *
 * The guardrail is §19 — near walls must read as constructed stonework, not
 * noise-displaced boxes. Jitter therefore stays inside the course band the
 * packer assigned; nothing here moves a unit into its neighbour's course.
 */

/**
 * Amplitude at `irregularity === 1`, before the per-category scale.
 *
 * These are deliberately 4x the amplitudes that were hard-coded in `addStone`
 * before 2026-07-25, so `irregularity: LEGACY_IRREGULARITY` (0.25) restores the
 * previous jitter *magnitude*. Individual stones do not land on their previous
 * values, because decorrelating the hash lanes (see below) necessarily repaints
 * which stone gets which offset. Old assets therefore keep their character and
 * their determinism, not their exact vertices.
 */
const AMPLITUDE = Object.freeze({
  width: 0.104,
  height: 0.084,
  depth: 0.152,
  rotationX: 0.024,
  rotationY: 0.032,
  rotationZ: 0.044,
  skewTop: 0.088,
  skewBottom: 0.072,
  protrusion: 0.22,
});

/** Recipe value that reproduces the pre-2026-07-25 hard-coded jitter. */
export const LEGACY_IRREGULARITY = 0.25;

/** Default for newly authored assets. */
export const DEFAULT_IRREGULARITY = 0.45;

/**
 * Structural dressings stay crisp so arches, corners and copings keep reading
 * as cut stone while field masonry goes rough (04-…md §8, §10).
 */
export const IRREGULARITY_CATEGORY_SCALE = Object.freeze({
  field: 1,
  shingle: 1,
  coping: 0.5,
  ashlar: 0.45,
  quoin: 0.35,
  voussoir: 0.3,
  // Crenellation ornaments: slightly quieter than field rubble so the crown
  // reads as worked stone without the full field jitter budget.
  merlon: 0.55,
});

/**
 * Rotate the local +Z axis by an XYZ-order Euler triple, scaled by `distance`.
 *
 * This is the third column of `Matrix4.makeRotationFromEuler` for order 'XYZ',
 * which is all a face-normal offset needs. Written out rather than going
 * through `THREE.Vector3.applyEuler` so this module stays free of Three.js and
 * can be imported by the pure recipe schema in `ProceduralAssetStore.js`.
 *
 * Independent of the Z term by construction: rolling about Z cannot move the Z
 * axis.
 */
function offsetAlongLocalZ(rotation, distance) {
  const sinX = Math.sin(rotation[0]);
  const cosX = Math.cos(rotation[0]);
  const sinY = Math.sin(rotation[1]);
  const cosY = Math.cos(rotation[1]);
  return [
    distance * sinY,
    -distance * sinX * cosY,
    distance * cosX * cosY,
  ];
}

/**
 * As `offsetAlongLocalZ`, but for the local +Y axis (second matrix column).
 *
 * Masonry units face along their local +Z, so that is where their protrusion
 * belongs. A roof tile lies flat: its surface normal is local +Y, and pushing it
 * along +Z would slide it up and down the slope instead of lifting it proud of
 * its neighbours.
 */
export function offsetAlongLocalY(rotation, distance) {
  const sinX = Math.sin(rotation[0]);
  const cosX = Math.cos(rotation[0]);
  const sinY = Math.sin(rotation[1]);
  const cosY = Math.cos(rotation[1]);
  const sinZ = Math.sin(rotation[2]);
  const cosZ = Math.cos(rotation[2]);
  return [
    distance * -cosY * sinZ,
    distance * (cosX * cosZ - sinX * sinZ * sinY),
    distance * (sinX * cosZ + cosX * sinZ * sinY),
  ];
}

/**
 * A 32-bit hash yields four uncorrelated byte lanes. The pre-2026-07-25 kernel
 * pulled nine lanes from one hash at shifts 0/4/6/8/12/14/16/20/24, so several
 * lanes shared bits and, for example, wide stones tended to rotate the same
 * way. Three hashes give twelve clean lanes instead.
 *
 * The first hash keeps its original constant and lane order so the width,
 * height, depth and bevel lanes are unchanged from before the split.
 */
const HASH_SHAPE = 0x5f3759df;
const HASH_ROTATION = 0x9e3779b9;
const HASH_SKEW = 0x85ebca6b;

function laneSigned(hash, shift) {
  return ((((hash >>> shift) & 255) / 255) - 0.5) * 2;
}

function laneUnit(hash, shift) {
  return ((hash >>> shift) & 255) / 255;
}

export function irregularityAmount(recipe, category = 'field') {
  const requested = Number.isFinite(recipe?.irregularity)
    ? recipe.irregularity
    : DEFAULT_IRREGULARITY;
  const clamped = Math.max(0, Math.min(1, requested));
  return clamped * (IRREGULARITY_CATEGORY_SCALE[category] ?? 1);
}

/**
 * Derive the jittered `beveledBox` parameters for one unit.
 *
 * `params` carries the packer's intent (width/height/depth/position/rotation).
 * Explicit `bevelRatio` or `skew` in `params` always win, matching the previous
 * behaviour where dressings could opt out of shaping.
 *
 * @returns {{width:number,height:number,depth:number,position:number[],
 *   rotation:number[],bevelRatio:number,skew:number[],protrusion:number}}
 */
export function stoneJitter(recipe, params, stableIndex, category = 'field', {
  protrusionAxis = 'z',
} = {}) {
  const amount = irregularityAmount(recipe, category);
  const shapeHash = mixSeed(recipe.seed ^ HASH_SHAPE, stableIndex);
  const rotationHash = mixSeed(recipe.seed ^ HASH_ROTATION, stableIndex);
  const skewHash = mixSeed(recipe.seed ^ HASH_SKEW, stableIndex);

  const rotation = params.rotation ?? [0, 0, 0];
  const position = params.position ?? [0, 0, 0];

  const jitteredRotation = [
    rotation[0] + laneSigned(rotationHash, 0) * AMPLITUDE.rotationX * amount,
    rotation[1] + laneSigned(rotationHash, 8) * AMPLITUDE.rotationY * amount,
    rotation[2] + laneSigned(rotationHash, 16) * AMPLITUDE.rotationZ * amount,
  ];

  // Push the unit out of (or into) its own face plane. This is the strongest
  // silhouette cue in hand-built masonry and it must follow the unit's own
  // orientation, so a rotated tower block protrudes radially rather than along
  // world +Z.
  //
  // Scaled by the *smallest* face dimension, not by depth. A tower block's depth
  // is the whole wall thickness — around 1.7 m — so scaling by depth threw
  // 0.3 m-wide blocks a third of a metre clear of the wall and they read as
  // detached rubble instead of bonded stone (04-…md §19).
  const protrusion = laneSigned(rotationHash, 24)
    * AMPLITUDE.protrusion
    * Math.min(params.width, params.depth)
    * amount;
  let jitteredPosition = position;
  if (protrusion !== 0) {
    const offset = protrusionAxis === 'y'
      ? offsetAlongLocalY(jitteredRotation, protrusion)
      : offsetAlongLocalZ(jitteredRotation, protrusion);
    jitteredPosition = [
      position[0] + offset[0],
      position[1] + offset[1],
      position[2] + offset[2],
    ];
  }

  return {
    width: params.width * (1 + laneSigned(shapeHash, 0) * AMPLITUDE.width * amount),
    height: params.height * (1 + laneSigned(shapeHash, 8) * AMPLITUDE.height * amount),
    depth: params.depth * (1 + laneSigned(shapeHash, 16) * AMPLITUDE.depth * amount),
    position: jitteredPosition,
    rotation: jitteredRotation,
    // Bevel span widens with irregularity but never collapses, so a perfectly
    // regular wall still catches light on its arrises (05-…md §5).
    bevelRatio: params.bevelRatio
      ?? (0.06 + laneUnit(shapeHash, 24) * (0.03 + 0.05 * amount)),
    skew: params.skew ?? [
      laneSigned(skewHash, 0) * params.width * AMPLITUDE.skewTop * amount,
      laneSigned(skewHash, 8) * params.width * AMPLITUDE.skewBottom * amount,
    ],
    protrusion,
  };
}
