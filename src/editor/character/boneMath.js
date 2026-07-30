/**
 * Rigid 4x4 transforms over flat `Float32Array` storage.
 *
 * The figure poses eighteen bones and skins three meshes from them every frame,
 * so nothing here allocates: every entry point writes into a caller-owned array
 * at a caller-supplied offset. Matrices are column-major — the same layout as
 * `THREE.Matrix4.elements` — so a bone matrix can go straight into a data
 * texture or `Matrix4.fromArray` without a transpose.
 *
 * These four functions are the whole of the source repo's `core/mat4.js` that
 * the character actually used. They are rigid-only on purpose: no scale, no
 * projection, which is what lets `invertRigid` be a transpose plus a dot product
 * instead of a general inverse.
 */

/** Below this the two reference axes are parallel and the cross product is noise. */
const DEGENERATE = 1e-6;

/**
 * Build an orthonormal frame at `p` from a bone axis and a front reference.
 *
 * The bone's local +Y is its own axis — running from its joint toward its child,
 * so a hanging arm has +Y pointing at the floor. +Z is the front reference
 * orthogonalised against it, and +X completes the right-handed frame.
 *
 * `zRef` is only a hint and is routinely near-parallel to the bone axis: a hand
 * pointing along the chest's forward vector while casting hits it exactly. When
 * that happens the frame's roll is genuinely undetermined, so we pick a
 * different reference rather than emitting a zero row that would collapse the
 * whole mesh through the origin.
 */
export function setFrameFromDir(out, o, px, py, pz, yx, yy, yz, zx, zy, zz) {
  let ax = yx;
  let ay = yy;
  let az = yz;
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al; ay /= al; az /= al;

  // X = Y x Zref.
  let xx = ay * zz - az * zy;
  let xy = az * zx - ax * zz;
  let xz = ax * zy - ay * zx;
  let xl = Math.hypot(xx, xy, xz);

  if (xl < DEGENERATE) {
    // Any axis not parallel to the bone will do; the roll it produces is
    // arbitrary but stable, which is all the caller can ask for here.
    const fx = Math.abs(ax) < 0.9 ? 1 : 0;
    const fy = Math.abs(ax) < 0.9 ? 0 : 1;
    xx = ay * 0 - az * fy;
    xy = az * fx - ax * 0;
    xz = ax * fy - ay * fx;
    xl = Math.hypot(xx, xy, xz) || 1;
  }
  xx /= xl; xy /= xl; xz /= xl;

  // Z = X x Y, orthonormal by construction whatever the reference was.
  const czx = xy * az - xz * ay;
  const czy = xz * ax - xx * az;
  const czz = xx * ay - xy * ax;

  out[o] = xx; out[o + 1] = xy; out[o + 2] = xz; out[o + 3] = 0;
  out[o + 4] = ax; out[o + 5] = ay; out[o + 6] = az; out[o + 7] = 0;
  out[o + 8] = czx; out[o + 9] = czy; out[o + 10] = czz; out[o + 11] = 0;
  out[o + 12] = px; out[o + 13] = py; out[o + 14] = pz; out[o + 15] = 1;
}

/**
 * Inverse of a rigid transform: transpose the rotation, then negate the
 * translation through it. Valid only because these frames are orthonormal and
 * unscaled — a general inverse here would be forty times the arithmetic for the
 * same answer.
 */
export function invertRigid(out, oo, m, mo) {
  const xx = m[mo]; const xy = m[mo + 1]; const xz = m[mo + 2];
  const yx = m[mo + 4]; const yy = m[mo + 5]; const yz = m[mo + 6];
  const zx = m[mo + 8]; const zy = m[mo + 9]; const zz = m[mo + 10];
  const tx = m[mo + 12]; const ty = m[mo + 13]; const tz = m[mo + 14];

  out[oo] = xx; out[oo + 1] = yx; out[oo + 2] = zx; out[oo + 3] = 0;
  out[oo + 4] = xy; out[oo + 5] = yy; out[oo + 6] = zy; out[oo + 7] = 0;
  out[oo + 8] = xz; out[oo + 9] = yz; out[oo + 10] = zz; out[oo + 11] = 0;
  out[oo + 12] = -(xx * tx + xy * ty + xz * tz);
  out[oo + 13] = -(yx * tx + yy * ty + yz * tz);
  out[oo + 14] = -(zx * tx + zy * ty + zz * tz);
  out[oo + 15] = 1;
}

/**
 * `out = a * b`. Every product is read into a local before anything is written,
 * so `out` may alias either input.
 */
export function mul(out, oo, a, ao, b, bo) {
  const a00 = a[ao]; const a01 = a[ao + 1]; const a02 = a[ao + 2]; const a03 = a[ao + 3];
  const a10 = a[ao + 4]; const a11 = a[ao + 5]; const a12 = a[ao + 6]; const a13 = a[ao + 7];
  const a20 = a[ao + 8]; const a21 = a[ao + 9]; const a22 = a[ao + 10]; const a23 = a[ao + 11];
  const a30 = a[ao + 12]; const a31 = a[ao + 13]; const a32 = a[ao + 14]; const a33 = a[ao + 15];

  const b00 = b[bo]; const b01 = b[bo + 1]; const b02 = b[bo + 2]; const b03 = b[bo + 3];
  const b10 = b[bo + 4]; const b11 = b[bo + 5]; const b12 = b[bo + 6]; const b13 = b[bo + 7];
  const b20 = b[bo + 8]; const b21 = b[bo + 9]; const b22 = b[bo + 10]; const b23 = b[bo + 11];
  const b30 = b[bo + 12]; const b31 = b[bo + 13]; const b32 = b[bo + 14]; const b33 = b[bo + 15];

  out[oo] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
  out[oo + 1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
  out[oo + 2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
  out[oo + 3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

  out[oo + 4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
  out[oo + 5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
  out[oo + 6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
  out[oo + 7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;

  out[oo + 8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
  out[oo + 9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
  out[oo + 10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
  out[oo + 11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;

  out[oo + 12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
  out[oo + 13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
  out[oo + 14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
  out[oo + 15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
}

/** Transform a point (w = 1) and write three floats to `out` at `od`. */
export function xformPoint(m, mo, x, y, z, out, od) {
  out[od] = m[mo] * x + m[mo + 4] * y + m[mo + 8] * z + m[mo + 12];
  out[od + 1] = m[mo + 1] * x + m[mo + 5] * y + m[mo + 9] * z + m[mo + 13];
  out[od + 2] = m[mo + 2] * x + m[mo + 6] * y + m[mo + 10] * z + m[mo + 14];
}
