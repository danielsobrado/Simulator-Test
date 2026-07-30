/**
 * The one thing that crosses to the GPU each frame.
 *
 * Rows 0-3 hold the bone skinning matrices, one column per bone and one row per
 * matrix column. Rows 4 and beyond hold the simulated cloth node grids, one
 * panel after another. A single `upload()` per frame writes both into a
 * pre-allocated staging array and flags one texture update.
 *
 * Nothing else goes up: no per-frame buffers, no matrix uniforms, no vertex
 * data. That is also why the port keeps this rather than reaching for
 * `THREE.SkinnedMesh` — the cloth mesh needs a texture-fetch vertex program
 * whatever happens, and once that texture exists it may as well carry the bones
 * for the body, the fur, the shadow pass and the depth prepass too.
 *
 * Allocation per frame: none.
 */

import * as THREE from 'three';
import { BONE_COUNT } from './characterBones.js';

/** Wide enough for the widest of the bone count or any panel's column count. */
const TEX_W = 48;
const TEX_H = 64;
/** First texture row available to cloth panels; 0-3 are the bone matrices. */
const CLOTH_ROW0 = 4;

export class CharacterTransformTexture {
  /**
   * @param {import('./cloth/ClothPanel.js').ClothPanel[]} panels
   */
  constructor(panels) {
    this.panels = panels;
    this.data = new Float32Array(TEX_W * TEX_H * 4);

    /** Flat (rowBase, cols, rows, 0) per panel, for the cloth vertex program. */
    this.panelParams = new Float32Array(panels.length * 4);
    let row = CLOTH_ROW0;
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      if (p.cols > TEX_W) {
        throw new Error(`Cloth panel "${p.name}" is wider than the transform texture.`);
      }
      p.nodeRow = row;
      this.panelParams[i * 4] = row;
      this.panelParams[i * 4 + 1] = p.cols;
      this.panelParams[i * 4 + 2] = p.rows;
      row += p.rows;
    }
    if (row > TEX_H) {
      throw new Error(`Transform texture is too short for ${panels.length} cloth panels.`);
    }
    this.usedRows = row;

    this.texture = new THREE.DataTexture(
      this.data, TEX_W, TEX_H, THREE.RGBAFormat, THREE.FloatType,
    );
    // Every read is an integer texel fetch, so this is never filtered — which is
    // as well, because float textures are not filterable without a feature flag.
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.name = 'drow-transforms';
    this.texture.needsUpdate = true;
  }

  /**
   * @param {import('./CharacterFigure.js').CharacterFigure} figure
   */
  upload(figure) {
    const d = this.data;
    const skin = figure.skin;

    // Written as four separate row writes rather than one blit, because the
    // texture is column-major in bones and row-major in memory.
    for (let b = 0; b < BONE_COUNT; b++) {
      const s = b * 16;
      for (let c = 0; c < 4; c++) {
        const o = (c * TEX_W + b) * 4;
        d[o] = skin[s + c * 4];
        d[o + 1] = skin[s + c * 4 + 1];
        d[o + 2] = skin[s + c * 4 + 2];
        d[o + 3] = skin[s + c * 4 + 3];
      }
    }

    for (let pi = 0; pi < this.panels.length; pi++) {
      const p = this.panels[pi];
      const pos = p.pos;
      for (let j = 0; j < p.rows; j++) {
        const rowO = (p.nodeRow + j) * TEX_W * 4;
        for (let i = 0; i < p.cols; i++) {
          const s = (j * p.cols + i) * 3;
          const o = rowO + i * 4;
          d[o] = pos[s];
          d[o + 1] = pos[s + 1];
          d[o + 2] = pos[s + 2];
          d[o + 3] = 1;
        }
      }
    }

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

export { TEX_W, TEX_H, CLOTH_ROW0 };
