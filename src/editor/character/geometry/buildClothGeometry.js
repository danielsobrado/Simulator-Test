/**
 * The render mesh for the simulated garments.
 *
 * It carries no positions of its own — `position` is `(u, v, panelIndex)` and the
 * vertex shader reconstructs the surface by Catmull-Rom interpolation of the
 * panel's simulated node grid. That decoupling is what lets a 36x12 verlet solve
 * render as a smooth 72x32 surface, and it means the simulation cost is
 * completely independent of how finely the garment is tessellated.
 *
 * Four attribute buffers, and no normals: the vertex shader has the surface's
 * two tangents in hand from the same interpolation, so shipping normals would be
 * a fifth buffer carrying data that is already there.
 *
 * The panel's grid dimensions ride along per vertex in `panel` rather than
 * arriving as a uniform array indexed by a panel id. It costs two floats a vertex
 * and removes dynamic uniform indexing from the vertex program entirely — which
 * matters more than the bytes, because that index would otherwise be an
 * interpolated float being rounded back to an integer.
 */

import * as THREE from 'three';
import { CLOTH_ROW0 } from '../CharacterTransformTexture.js';

/**
 * @param {import('../cloth/ClothPanel.js').ClothPanel[]} panels
 */
export function buildClothGeometry(panels) {
  const pos = [];
  const uv = [];
  const aux = [];
  const panel = [];
  const idx = [];

  for (let pi = 0; pi < panels.length; pi++) {
    const p = panels[pi];
    if (p.nodeRow < CLOTH_ROW0) {
      // `CharacterTransformTexture` assigns the rows. Building the mesh first
      // would bake row 0 — the bone matrices — in as every panel's node grid.
      throw new Error(`Cloth panel "${p.name}" has no transform-texture row yet.`);
    }
    const cu = p.renderCols;
    const cv = p.renderRows;
    const base = pos.length / 3;

    for (let j = 0; j <= cv; j++) {
      const v = j / cv;
      for (let i = 0; i <= cu; i++) {
        const u = i / cu;
        pos.push(u, v, 0);
        uv.push(u * p.weaveU, v * p.weaveV);
        // (matId, ao). Garments darken toward the hem, where they sit in their
        // own folds and close to the ground.
        aux.push(p.matId, p.aoTop + (p.aoBottom - p.aoTop) * v);
        panel.push(p.cols, p.rows, p.nodeRow, 0);
      }
    }

    const stride = cu + 1;
    for (let j = 0; j < cv; j++) {
      for (let i = 0; i < cu; i++) {
        const a = base + j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
  }

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  const geometry = new THREE.BufferGeometry();
  geometry.name = 'drow-cloth';
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geometry.setAttribute('aux', new THREE.BufferAttribute(new Float32Array(aux), 2));
  geometry.setAttribute('panel', new THREE.BufferAttribute(new Float32Array(panel), 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // `position` is a parameter triple, not a location, so a bounding sphere
  // computed from it is meaningless. The mesh is drawn with culling off for
  // exactly this reason; give three.js something finite so it never tries.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);

  geometry.userData.characterStats = {
    vertices: positions.length / 3,
    triangles: indices.length / 3,
  };
  return geometry;
}
