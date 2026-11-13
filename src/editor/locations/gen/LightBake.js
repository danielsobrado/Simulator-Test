/**
 * Bakes a location's lights into its vertices.
 *
 * An underground scene is lit by dozens of lamps and none of them move, so the
 * cost belongs behind the loading screen rather than in every frame. Each light
 * is marched through the density volume toward each vertex in range, and what it
 * loses on the way is Beer-Lambert absorption in the medium it crossed: rock
 * swallows it (a shadow), ice takes the red first and passes blue (the glow of a
 * thin wall). One rule gives shadows, coloured transmission and thin-edge
 * brightness without a runtime light.
 *
 * Per vertex it writes:
 *  - `light`  rgb irradiance, already shaped by the surface normal
 *  - `dir`    the dominant light direction scaled by how directional it is (0..1),
 *             so the shader can re-shade detail normals and place a highlight
 *  - `shade`  x: ambient occlusion, y: thickness of solid behind the surface in metres
 */

/**
 * @typedef {object} BakedLight
 * @property {number} x @property {number} y @property {number} z
 * @property {[number, number, number]} color linear rgb, premultiplied by intensity
 * @property {number} range metres at which it reaches zero
 * @property {number} [radius] source size in metres; softens the inverse square
 * @property {boolean} [flat] daylight through an opening or a roof: no inverse-square falloff
 */

const AO_REACH = [1.3, 2.6, 5.2];

/**
 * @param {object} options
 * @param {import('./DensityGrid.js').DensityGrid} options.grid
 * @param {Float32Array} options.positions
 * @param {Float32Array} options.normals
 * @param {BakedLight[]} options.lights
 * @param {(vertex: number) => number} options.iceAt 0 rock .. 1 ice, per vertex
 * @param {{ rock: number[], ice: number[] }} options.absorption per-metre rgb extinction
 * @param {number} [options.wrapIce] how far light wraps around an ice surface
 */
export function bakeLighting({ grid, positions, normals, lights, iceAt, absorption, wrapIce = 0.9 }) {
  const count = positions.length / 3;
  const light = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const shade = new Float32Array(count * 2);
  const step = grid.voxel;
  const sigma = [0, 0, 0];

  for (let v = 0; v < count; v += 1) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    const ice = iceAt(v);
    for (let c = 0; c < 3; c += 1) sigma[c] = absorption.rock[c] + (absorption.ice[c] - absorption.rock[c]) * ice;
    const thinnest = Math.min(sigma[0], sigma[1], sigma[2]);
    const wrap = 0.12 + (wrapIce - 0.12) * ice;
    // Start clear of the surface so the vertex's own wall only counts when the light is behind it.
    const sx = px + nx * step * 0.8, sy = py + ny * step * 0.8, sz = pz + nz * step * 0.8;
    const jitter = ((v * 0.61803398875) % 1) * step;
    let r = 0, g = 0, b = 0, dx = 0, dy = 0, dz = 0, weight = 0;

    for (const source of lights) {
      const lx = source.x - sx, ly = source.y - sy, lz = source.z - sz;
      const distance = Math.hypot(lx, ly, lz);
      if (distance >= source.range) continue;
      const ux = lx / distance, uy = ly / distance, uz = lz / distance;
      const facing = (nx * ux + ny * uy + nz * uz + wrap) / (1 + wrap);
      if (facing <= 0) continue;
      const fade = 1 - (distance / source.range) ** 2;
      const radius = source.radius ?? 1;
      const falloff = source.flat ? fade * fade : (fade * fade) / (1 + (distance / radius) ** 2);
      let solid = 0;
      for (let t = jitter; t < distance; t += step) {
        if (grid.solidAt(sx + ux * t, sy + uy * t, sz + uz * t)) {
          solid += step;
          if (solid * thinnest > 7) break;
        }
      }
      const reach = falloff * facing;
      const cr = source.color[0] * reach * Math.exp(-sigma[0] * solid);
      const cg = source.color[1] * reach * Math.exp(-sigma[1] * solid);
      const cb = source.color[2] * reach * Math.exp(-sigma[2] * solid);
      const luma = cr * 0.3 + cg * 0.5 + cb * 0.2;
      r += cr; g += cg; b += cb;
      dx += ux * luma; dy += uy * luma; dz += uz * luma; weight += luma;
    }
    light[v * 3] = r; light[v * 3 + 1] = g; light[v * 3 + 2] = b;
    if (weight > 1e-6) { dir[v * 3] = dx / weight; dir[v * 3 + 1] = dy / weight; dir[v * 3 + 2] = dz / weight; }

    let occlusion = 0;
    for (const reach of AO_REACH) {
      const d = reach * step;
      occlusion += Math.min(1, Math.max(0, 1 - grid.sample(px + nx * d, py + ny * d, pz + nz * d) / d));
    }
    shade[v * 2] = 1 - 0.8 * (occlusion / AO_REACH.length);

    let thickness = 0;
    while (thickness < 8 && grid.solidAt(px - nx * (thickness + step), py - ny * (thickness + step), pz - nz * (thickness + step))) {
      thickness += step;
    }
    shade[v * 2 + 1] = thickness;
  }
  return { light, dir, shade };
}
