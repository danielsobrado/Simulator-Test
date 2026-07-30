/**
 * Procedural character geometry — the primitives.
 *
 * Nothing on this figure is authored in a DCC tool. Every surface is a lofted
 * tube, a swept ring or a Bezier-blended shell evaluated from the bind-pose
 * skeleton, so the whole drow is a few hundred lines of tables and a
 * smooth-normal pass.
 *
 * Normals are never derived analytically. Everything is built as positions plus
 * indices and then run through one area-weighted smooth-normal pass, which is
 * both less code and immune to the sign errors that analytic normals on a swept
 * surface invite. Closed rings share their seam vertex rather than duplicating
 * it, so the seam is smooth too.
 *
 * Build time only — none of this runs after load, and it allocates freely.
 */

import * as THREE from 'three';

/** Segments around a limb. 14 is smooth at the distances this is seen from. */
export const SEG = 14;

export class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    /** (matId, ao) on the body; (shellT, ao) on the fur. */
    this.aux = [];
    this.bi = []; // bone indices, 4 per vertex
    this.bw = []; // bone weights, 4 per vertex
    this.idx = [];
    /** Fur supplies its own normals; everything else has them derived. */
    this.explicitNormals = false;
  }

  /** @returns {number} the new vertex's index */
  vert(x, y, z, u, v, matId, ao, b0, w0, b1, w1) {
    this.pos.push(x, y, z);
    this.nrm.push(0, 0, 0);
    this.uv.push(u, v);
    this.aux.push(matId, ao);
    this.bi.push(b0, b1 || 0, 0, 0);
    this.bw.push(w0, w1 || 0, 0, 0);
    return this.pos.length / 3 - 1;
  }

  normal(vi, x, y, z) {
    this.nrm[vi * 3] = x;
    this.nrm[vi * 3 + 1] = y;
    this.nrm[vi * 3 + 2] = z;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  quad(a, b, c, d) {
    // Both diagonals of every quad get used across the mesh; alternating is not
    // worth the bookkeeping on shapes this smooth.
    this.idx.push(a, b, c, a, c, d);
  }
}

/**
 * Area-weighted smooth normals.
 *
 * Area weighting rather than plain averaging: a long thin triangle at a cap
 * would otherwise pull the pole normal off toward its own plane.
 */
export function computeNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3; const b = idx[i + 1] * 3; const c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a]; const uy = pos[b + 1] - pos[a + 1]; const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a]; const vy = pos[c + 1] - pos[a + 1]; const vz = pos[c + 2] - pos[a + 2];
    // Un-normalised cross product: its length is twice the triangle area, which
    // is exactly the weight we want.
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    n[a] += fx; n[a + 1] += fy; n[a + 2] += fz;
    n[b] += fx; n[b + 1] += fy; n[b + 2] += fz;
    n[c] += fx; n[c + 1] += fy; n[c + 2] += fz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Ring helper: `[cx, cy, cz, rx, rz, ao, b0, w0, b1, w1]`. */
export function ring(cx, cy, cz, rx, rz, ao, bones) {
  return [cx, cy, cz, rx, rz, ao, bones[0], bones[1], bones[2], bones[3]];
}

/**
 * Loft a closed tube through a list of rings.
 *
 * The cross-section plane is derived from the direction to the neighbouring
 * rings, so a limb that bends in the bind pose still gets circular sections
 * rather than sheared ones.
 *
 * @param {Builder} B
 * @param {number[][]} rings
 * @param {number} matId
 * @param {[number,number,number]} ref reference axis the section frame avoids
 */
export function loft(B, rings, matId, ref, capStart, capEnd) {
  const n = rings.length;
  const first = [];
  let prevRow = null;
  let vAcc = 0;

  for (let r = 0; r < n; r++) {
    const cur = rings[r];
    const prev = rings[Math.max(0, r - 1)];
    const next = rings[Math.min(n - 1, r + 1)];

    let ax = next[0] - prev[0]; let ay = next[1] - prev[1]; let az = next[2] - prev[2];
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;

    // U = axis x ref, W = axis x U — the two axes of the section plane.
    let ux = ay * ref[2] - az * ref[1];
    let uy = az * ref[0] - ax * ref[2];
    let uz = ax * ref[1] - ay * ref[0];
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const wx = ay * uz - az * uy;
    const wy = az * ux - ax * uz;
    const wz = ax * uy - ay * ux;

    if (r > 0) {
      vAcc += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    }

    // Texture coordinates are metres of surface, not normalised. Every scale in
    // the fabric shader — the weave, the yarn slub — is a physical size, and
    // normalised UVs would make each of them a different size on every part of
    // the body.
    const circ = Math.PI * (cur[3] + cur[4]);

    const row = [];
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const px = cur[0] + ux * cur[3] * sa + wx * cur[4] * ca;
      const py = cur[1] + uy * cur[3] * sa + wy * cur[4] * ca;
      const pz = cur[2] + uz * cur[3] * sa + wz * cur[4] * ca;
      row.push(B.vert(
        px, py, pz,
        (s / SEG) * circ, vAcc,
        matId, cur[5], cur[6], cur[7], cur[8], cur[9],
      ));
    }

    if (prevRow) {
      for (let s = 0; s < SEG; s++) {
        const s2 = (s + 1) % SEG;
        B.quad(prevRow[s], prevRow[s2], row[s2], row[s]);
      }
    }
    if (r === 0) first.push(...row);
    prevRow = row;
  }

  // Caps: a fan to a centre vertex placed on the ring's own axis.
  if (capStart) capRing(B, rings[0], rings[1], first, matId, true);
  if (capEnd) capRing(B, rings[n - 1], rings[n - 2], prevRow, matId, false);
}

function capRing(B, r, neighbour, row, matId, isStart) {
  let ax = r[0] - neighbour[0]; let ay = r[1] - neighbour[1]; let az = r[2] - neighbour[2];
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al; ay /= al; az /= al;
  const ext = Math.max(r[3], r[4]) * 0.7;
  const c = B.vert(
    r[0] + ax * ext, r[1] + ay * ext, r[2] + az * ext,
    0.5, 0.5, matId, r[5], r[6], r[7], r[8], r[9],
  );
  for (let s = 0; s < SEG; s++) {
    const s2 = (s + 1) % SEG;
    if (isStart) B.tri(c, row[s2], row[s]);
    else B.tri(c, row[s], row[s2]);
  }
}

/** Rings along a straight bone segment, interpolating radius and bone weights. */
export function limbRings(x0, y0, z0, x1, y1, z1, r0, r1, steps, boneA, boneB, ao, from, to) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Weight ramps from boneA to boneB across the segment, so the joint bends
    // smoothly instead of creasing at one ring.
    const w = Math.min(1, Math.max(0, (t - from) / (to - from)));
    const r = r0 + (r1 - r0) * t;
    out.push(ring(
      x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t,
      r, r, ao, [boneA, 1 - w, boneB, w],
    ));
  }
  return out;
}

/**
 * Pack a builder into a `BufferGeometry`.
 *
 * Six attribute buffers, which matters: WebGPU allows eight per pipeline, and
 * exceeding it does not degrade — the mesh silently fails to draw. Anything new
 * has to be packed into the spare lanes of `aux`, not added as a seventh buffer.
 */
export function finishGeometry(name, B) {
  const pos = new Float32Array(B.pos);
  const idx = new Uint32Array(B.idx);
  const nrm = B.explicitNormals ? new Float32Array(B.nrm) : computeNormals(pos, idx);

  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(B.uv), 2));
  geometry.setAttribute('aux', new THREE.BufferAttribute(new Float32Array(B.aux), 2));
  geometry.setAttribute('boneIdx', new THREE.BufferAttribute(new Float32Array(B.bi), 4));
  geometry.setAttribute('boneWt', new THREE.BufferAttribute(new Float32Array(B.bw), 4));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.computeBoundingSphere();

  geometry.userData.characterStats = {
    vertices: pos.length / 3,
    triangles: idx.length / 3,
  };
  return geometry;
}

/**
 * Bone blend along the spine, by bind-pose height.
 *
 * Returned as a closure over the rig rather than reading module constants: the
 * blend bands are fractions of the pelvis-to-neck span, so a taller drow's spine
 * weights land in the same places on its own body.
 */
export function makeSpineBones(rig, bones) {
  const { pelvisY, spineY, chestY, neckY } = rig.anchors;
  const { B_ROOT, B_SPINE, B_CHEST, B_NECK } = bones;
  // The lowest band starts a little below the pelvis, where the robe's waistband
  // sits and the torso mesh begins.
  const low = pelvisY - 0.07;
  return function spineBones(y) {
    if (y < spineY) {
      const t = Math.min(1, Math.max(0, (y - low) / (spineY - low)));
      return [B_ROOT, 1 - t * 0.5, B_SPINE, t * 0.5];
    }
    if (y < chestY) {
      const t = (y - spineY) / (chestY - spineY);
      return [B_SPINE, 1 - t, B_CHEST, t];
    }
    const t = Math.min(1, (y - chestY) / (neckY - chestY));
    return [B_CHEST, 1 - t * 0.35, B_NECK, t * 0.35];
  };
}
