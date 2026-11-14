/**
 * Deterministic low-frequency indirect bounce illumination for baked underground
 * geometry (`LightBake.js`).
 *
 * Lit rock walls and floors are aggregated into coarse spatial bounce surfels.
 * Any receiving vertex gathers nearby bounce energy weighted by surface-to-surface
 * facing and raymarched against `DensityGrid.solidAt` so warm bounced light
 * fills dark tunnel intervals without leaking through solid rock walls.
 */

const SURF_BIAS = 1024;
const SURF_Y_MUL = 2048;
const SURF_Z_MUL = 2048 * 2048;

function cellKey(ix, iy, iz) {
  return (ix + SURF_BIAS) + (iy + SURF_BIAS) * SURF_Y_MUL + (iz + SURF_BIAS) * SURF_Z_MUL;
}

/**
 * Builds bounce emitter surfels + spatial lookup bins from already-baked
 * terrain direct irradiance.
 *
 * @param {object} options
 * @param {import('./DensityGrid.js').DensityGrid} options.grid
 * @param {Float32Array} options.positions
 * @param {Float32Array} options.normals
 * @param {Float32Array} options.directLight
 * @param {number} [options.cellSize=1.25]
 * @param {number} [options.radius=9.5]
 * @param {number} [options.maxEnergy=2.2]
 */
export function createBounceField({
  grid,
  positions,
  normals,
  directLight,
  cellSize = 1.25,
  radius = 9.5,
  maxEnergy = 2.2,
}) {
  const buckets = new Map();
  const invCell = 1 / cellSize;
  const count = positions.length / 3;

  for (let v = 0; v < count; v += 1) {
    const r = directLight[v * 3];
    const g = directLight[v * 3 + 1];
    const b = directLight[v * 3 + 2];
    const luma = r * 0.3 + g * 0.5 + b * 0.2;
    if (luma < 0.025) continue;

    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    const key = cellKey(Math.floor(px * invCell), Math.floor(py * invCell), Math.floor(pz * invCell));

    let entry = buckets.get(key);
    if (!entry) {
      entry = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, r: 0, g: 0, b: 0, n: 0 };
      buckets.set(key, entry);
    }
    entry.x += px; entry.y += py; entry.z += pz;
    entry.nx += nx; entry.ny += ny; entry.nz += nz;
    entry.r += r; entry.g += g; entry.b += b;
    entry.n += 1;
  }

  const surfels = [];
  const bins = new Map();
  const binSize = Math.max(2, radius);
  const invBin = 1 / binSize;
  const nudge = grid.voxel * 0.65;

  for (const entry of buckets.values()) {
    const inv = 1 / entry.n;
    const nLen = Math.hypot(entry.nx, entry.ny, entry.nz);
    if (nLen < 1e-4) continue;
    const nx = entry.nx / nLen, ny = entry.ny / nLen, nz = entry.nz / nLen;
    // Clamp indirect reflectance energy and apply warm mineral rock bounce tint.
    const r = Math.min(maxEnergy, entry.r * inv * 0.98);
    const g = Math.min(maxEnergy, entry.g * inv * 0.91);
    const b = Math.min(maxEnergy, entry.b * inv * 0.82);
    if (r + g + b < 0.04) continue;

    const sx = entry.x * inv + nx * nudge;
    const sy = entry.y * inv + ny * nudge;
    const sz = entry.z * inv + nz * nudge;
    const surfel = { x: sx, y: sy, z: sz, nx, ny, nz, r, g, b };
    const idx = surfels.push(surfel) - 1;

    const bKey = cellKey(Math.floor(sx * invBin), Math.floor(sy * invBin), Math.floor(sz * invBin));
    let list = bins.get(bKey);
    if (!list) {
      list = [];
      bins.set(bKey, list);
    }
    list.push(idx);
  }

  return { grid, surfels, bins, binSize, radius };
}

/**
 * Adds visibility-tested secondary bounce light onto baked vertices.
 *
 * @param {ReturnType<createBounceField>} field
 * @param {object} target
 * @param {Float32Array} target.positions
 * @param {Float32Array} target.normals
 * @param {Float32Array} target.light
 * @param {Float32Array} target.dir
 * @param {Float32Array} target.shade
 * @param {number} target.shadeSize
 * @param {number} [target.strength=0.44]
 * @param {number} [target.wrap=0.52]
 */
export function gatherBounceLight(field, {
  positions,
  normals,
  light,
  dir,
  shade,
  shadeSize,
  strength = 0.44,
  wrap = 0.52,
}) {
  const { grid, surfels, bins, binSize, radius } = field;
  if (surfels.length === 0 || strength <= 0) return;

  const invBin = 1 / binSize;
  const binSpan = Math.ceil(radius / binSize);
  const step = Math.max(0.35, grid.voxel * 1.15);
  const radiusSq = radius * radius;
  const count = positions.length / 3;

  for (let v = 0; v < count; v += 1) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    const sx = px + nx * (grid.voxel * 0.72);
    const sy = py + ny * (grid.voxel * 0.72);
    const sz = pz + nz * (grid.voxel * 0.72);

    const bx0 = Math.floor(px * invBin);
    const by0 = Math.floor(py * invBin);
    const bz0 = Math.floor(pz * invBin);

    let br = 0, bg = 0, bb = 0, wSum = 0;
    let dx = 0, dy = 0, dz = 0, dWeight = 0;

    for (let ox = -binSpan; ox <= binSpan; ox += 1) {
      for (let oy = -binSpan; oy <= binSpan; oy += 1) {
        for (let oz = -binSpan; oz <= binSpan; oz += 1) {
          const list = bins.get(cellKey(bx0 + ox, by0 + oy, bz0 + oz));
          if (!list) continue;
          for (let k = 0; k < list.length; k += 1) {
            const s = surfels[list[k]];
            const vx = s.x - sx, vy = s.y - sy, vz = s.z - sz;
            const distSq = vx * vx + vy * vy + vz * vz;
            if (distSq < 0.25 || distSq >= radiusSq) continue;

            const dist = Math.sqrt(distSq);
            const ux = vx / dist, uy = vy / dist, uz = vz / dist;
            const emitFace = -(s.nx * ux + s.ny * uy + s.nz * uz);
            if (emitFace <= 0.04) continue;

            const recvFace = (nx * ux + ny * uy + nz * uz + wrap) / (1 + wrap);
            if (recvFace <= 0) continue;

            // Block any bounce across solid rock walls separating passages.
            let occluded = false;
            const marchEnd = dist - step * 0.5;
            for (let t = step; t < marchEnd; t += step) {
              if (grid.solidAt(sx + ux * t, sy + uy * t, sz + uz * t)) {
                occluded = true;
                break;
              }
            }
            if (occluded) continue;

            const fade = 1 - distSq / radiusSq;
            const form = (fade * fade * emitFace * recvFace) / (1 + distSq * 0.09);
            br += s.r * form;
            bg += s.g * form;
            bb += s.b * form;
            wSum += form;

            const bounceLuma = (s.r * 0.3 + s.g * 0.5 + s.b * 0.2) * form;
            dx += ux * bounceLuma; dy += uy * bounceLuma; dz += uz * bounceLuma;
            dWeight += bounceLuma;
          }
        }
      }
    }

    if (wSum <= 1e-6) continue;
    // Bounded hemisphere coverage prevents large chambers with many surfels from washing out uniformly.
    const coverage = wSum / (wSum + 0.45);
    const normFactor = (strength * coverage) / wSum;
    const bounceAO = 0.45 + 0.55 * shade[v * shadeSize];
    const ar = br * normFactor * bounceAO;
    const ag = bg * normFactor * bounceAO;
    const ab = bb * normFactor * bounceAO;

    const prevR = light[v * 3], prevG = light[v * 3 + 1], prevB = light[v * 3 + 2];
    const prevLuma = prevR * 0.3 + prevG * 0.5 + prevB * 0.2;
    light[v * 3] = prevR + ar;
    light[v * 3 + 1] = prevG + ag;
    light[v * 3 + 2] = prevB + ab;

    // In dark indirect-only areas, give bakeDir a gentle bounce gradient so rock relief remains legible.
    if (dWeight > 1e-6 && prevLuma < 0.28) {
      const bDirLen = Math.hypot(dx, dy, dz) || 1;
      const bounceConf = Math.min(1, dWeight / 0.12);
      const mixShare = Math.max(0, Math.min(0.4, 0.4 * (1 - prevLuma / 0.28) * bounceConf));
      const odx = dir[v * 3], ody = dir[v * 3 + 1], odz = dir[v * 3 + 2];
      const bxDir = (dx / bDirLen) * 0.5;
      const byDir = (dy / bDirLen) * 0.5;
      const bzDir = (dz / bDirLen) * 0.5;
      dir[v * 3] = odx * (1 - mixShare) + bxDir * mixShare;
      dir[v * 3 + 1] = ody * (1 - mixShare) + byDir * mixShare;
      dir[v * 3 + 2] = odz * (1 - mixShare) + bzDir * mixShare;
    }
  }
}
