/**
 * Linear blend skinning, read out of the transform texture.
 *
 * Two bones per vertex, which is all the figure's geometry ever writes — the
 * builders blend across a joint with `[boneA, 1-w, boneB, w]` and nothing needs a
 * third influence. Four would double the texel fetches for no visible gain.
 *
 * The skin matrices are `world * inverseBind`, so this produces **world-space**
 * positions directly. That is only correct because the character meshes sit at
 * the scene origin with an identity object matrix and never move — the figure
 * carries the drow to where the player is, not the `Object3D`. `CharacterView`
 * is where that invariant is established.
 */

import {
  attribute, int, ivec2, mat3, mat4, textureLoad, vec4,
} from 'three/tsl';

/**
 * @param {import('three').DataTexture} transformTexture
 */
export function createSkinNodes(transformTexture) {
  const boneIdx = attribute('boneIdx', 'vec4');
  const boneWt = attribute('boneWt', 'vec4');

  const i0 = int(boneIdx.x);
  const i1 = int(boneIdx.y);
  const wA = boneWt.x;
  const wB = boneWt.y;

  // Rows 0-3 of the texture are the four columns of each bone's matrix, one
  // column of texels per bone.
  const column = (bone, row) => textureLoad(transformTexture, ivec2(bone, int(row)));
  const a0 = column(i0, 0); const a1 = column(i0, 1);
  const a2 = column(i0, 2); const a3 = column(i0, 3);
  const b0 = column(i1, 0); const b1 = column(i1, 1);
  const b2 = column(i1, 2); const b3 = column(i1, 3);

  const mA = mat4(a0, a1, a2, a3);
  const mB = mat4(b0, b1, b2, b3);
  // Rotation only, for normals. Built from the same texels rather than casting
  // the mat4, so nothing depends on how the backend spells that cast.
  const rA = mat3(a0.xyz, a1.xyz, a2.xyz);
  const rB = mat3(b0.xyz, b1.xyz, b2.xyz);

  return {
    /** @param {import('three/tsl').Node} local bind-pose position */
    position(local) {
      // Join as (vec3, float), not (node, 1) — if `local` is ever typed wider than
      // vec3, `vec4(local, 1)` overflows JoinNode's component budget and three.js
      // logs "Length of parameters exceeds maximum length of function 'vec4()'".
      const p = vec4(local.xyz, 1);
      return mA.mul(p).xyz.mul(wA).add(mB.mul(p).xyz.mul(wB));
    },
    /** @param {import('three/tsl').Node} local bind-pose normal */
    normal(local) {
      return rA.mul(local).mul(wA).add(rB.mul(local).mul(wB)).normalize();
    },
  };
}
