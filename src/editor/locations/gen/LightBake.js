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
 *  - `shade`  x: ambient occlusion, y: thickness of solid behind the surface in metres,
 *             z: 1 where nothing stands between the surface and the sky (always 0 in a closed volume) —
 *             where snow can fall and weather can reach
 */

/**
 * @typedef {object} BakedLight
 * @property {number} x @property {number} y @property {number} z
 * @property {[number, number, number]} color linear rgb, premultiplied by intensity
 * @property {number} range metres at which it reaches zero
 * @property {number} [radius] source size in metres; softens the inverse square
 * @property {boolean} [flat] daylight through an opening or a roof: no inverse-square falloff
 * @property {[number, number, number]} [direction] unit vector toward a sun or a patch of sky: the light is
 *   parallel, does not fall off, and is shadowed by whatever stands within `range` metres along it
 */

const AO_REACH = [1.3, 2.6, 5.2];
/** Optical depth past which light through a solid is not worth tracing further. */
const OPAQUE = 7;
/** Components of the `shade` attribute. */
export const SHADE_SIZE = 3;

/**
 * @param {object} options
 * @param {import('./DensityGrid.js').DensityGrid} options.grid
 * @param {import('./PropOcclusionGrid.js').PropOcclusionGrid|null} [options.propGrid]
 * @param {{ minTransmit?: number, contactStrength?: number, isProp?: boolean }|null} [options.propShadows]
 * @param {Float32Array} options.positions
 * @param {Float32Array} options.normals
 * @param {BakedLight[]} options.lights
 * @param {(vertex: number) => number} options.iceAt 0 rock .. 1 ice: what the ground around the vertex is made of,
 *   and so what light reaching it has had to cross
 * @param {(vertex: number) => number} [options.wrapAt] 0 .. 1: how far light wraps round the surface itself;
 *   defaults to `iceAt`, which is right for the volume's own surface
 * @param {(x: number, y: number, z: number) => number} [options.mediumAt] 0 rock .. 1 ice at a point inside the
 *   volume. When given, light is dimmed by what it actually passed through (rock under an ice roof is lit
 *   blue through the ice, not blacked out as if the roof were rock); without it, `iceAt` stands in.
 * @param {{ rock: number[], ice: number[] }} options.absorption per-metre rgb extinction
 * @param {number} [options.wrapIce] how far light wraps around an ice surface
 */
export function bakeLighting({
  grid,
  propGrid = null,
  propShadows = null,
  positions,
  normals,
  lights,
  iceAt,
  wrapAt = iceAt,
  mediumAt = null,
  absorption,
  wrapIce = 0.9,
}) {
  const count = positions.length / 3;
  const light = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const shade = new Float32Array(count * SHADE_SIZE);
  const step = grid.voxel;
  const sigma = [0, 0, 0], crossed = [0, 0, 0];
  const top = grid.min.y + grid.ny * grid.voxel;
  const isProp = Boolean(propShadows?.isProp);
  const startOffset = propShadows?.startOffset ?? (isProp ? 0.20 : 0.14);
  const endMargin = propShadows?.endMargin ?? 0.28;
  const minTransmit = propShadows?.minTransmit ?? 0.14;
  const contactStrength = propShadows?.contactStrength ?? 0.72;

  for (let v = 0; v < count; v += 1) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    const ice = iceAt(v);
    for (let c = 0; c < 3; c += 1) sigma[c] = absorption.rock[c] + (absorption.ice[c] - absorption.rock[c]) * ice;
    const thinnest = Math.min(sigma[0], sigma[1], sigma[2]);
    const wrap = 0.12 + (wrapIce - 0.12) * wrapAt(v);
    // Start clear of the surface so the vertex's own terrain voxel only counts when the light is behind it.
    const sx = px + nx * step * 0.8, sy = py + ny * step * 0.8, sz = pz + nz * step * 0.8;
    const rx = isProp ? px + nx * 0.02 : sx;
    const ry = isProp ? py + ny * 0.02 : sy;
    const rz = isProp ? pz + nz * 0.02 : sz;
    const pox = px + nx * (isProp ? 0.09 : 0.04);
    const poy = py + ny * (isProp ? 0.09 : 0.04);
    const poz = pz + nz * (isProp ? 0.09 : 0.04);
    const jitter = ((v * 0.61803398875) % 1) * step;
    let r = 0, g = 0, b = 0, dx = 0, dy = 0, dz = 0, weight = 0;

    for (const source of lights) {
      let ux, uy, uz, distance = source.range, falloff = 1;
      if (source.direction) {
        [ux, uy, uz] = source.direction;
      } else {
        const lx = source.x - rx, ly = source.y - ry, lz = source.z - rz;
        distance = Math.hypot(lx, ly, lz);
        if (distance >= source.range) continue;
        const safeDist = Math.max(distance, 1e-4);
        ux = lx / safeDist; uy = ly / safeDist; uz = lz / safeDist;
        const fade = 1 - (distance / source.range) ** 2;
        const effDist = Math.max(distance, isProp ? 0.46 : 0.28);
        const effRadius = Math.max(source.radius ?? 1, isProp ? 0.85 : 0.4);
        falloff = source.flat ? fade * fade : (fade * fade) / (1 + (effDist / effRadius) ** 2);
      }
      const nearWrap = isProp && !source.flat && !source.direction && distance < 0.75
        ? Math.min(0.65, wrap + (1 - distance / 0.75) * 0.32)
        : wrap;
      const facing = (nx * ux + ny * uy + nz * uz + nearWrap) / (1 + nearWrap);
      if (facing <= 0) continue;
      // Light is dimmed by what it crosses. Where it first meets solid decides what that is: the
      // ray stops being worth following once that medium has swallowed it.
      crossed[0] = sigma[0]; crossed[1] = sigma[1]; crossed[2] = sigma[2];
      let solid = 0, limit = OPAQUE / thinnest;
      for (let t = jitter; t < distance; t += step) {
        if (grid.solidAt(sx + ux * t, sy + uy * t, sz + uz * t)) {
          if (solid === 0 && mediumAt) {
            const share = mediumAt(sx + ux * t, sy + uy * t, sz + uz * t);
            for (let c = 0; c < 3; c += 1) crossed[c] = absorption.rock[c] + (absorption.ice[c] - absorption.rock[c]) * share;
            limit = OPAQUE / Math.min(crossed[0], crossed[1], crossed[2]);
          }
          solid += step;
          if (solid > limit) break;
        }
      }
      const reach = falloff * facing;
      let propTransmit = 1;
      if (propGrid && !source.flat && !source.direction) {
        propTransmit = propGrid.transmittanceRay(pox, poy, poz, ux, uy, uz, distance, {
          startOffset,
          endMargin,
          minTransmit,
        });
      }
      const transmit = reach * propTransmit;
      const cr = source.color[0] * transmit * Math.exp(-crossed[0] * solid);
      const cg = source.color[1] * transmit * Math.exp(-crossed[1] * solid);
      const cb = source.color[2] * transmit * Math.exp(-crossed[2] * solid);
      const luma = cr * 0.3 + cg * 0.5 + cb * 0.2;
      r += cr; g += cg; b += cb;
      dx += ux * luma; dy += uy * luma; dz += uz * luma; weight += luma;
    }
    light[v * 3] = r; light[v * 3 + 1] = g; light[v * 3 + 2] = b;
    if (weight > 1e-6) {
      // Scale directionality by irradiance confidence so dark recesses stay calm without specular speckles.
      const confidence = Math.min(1, weight / 0.16);
      const inv = confidence / weight;
      dir[v * 3] = dx * inv;
      dir[v * 3 + 1] = dy * inv;
      dir[v * 3 + 2] = dz * inv;
    }

    let occlusion = 0;
    for (const reach of AO_REACH) {
      const d = reach * step;
      occlusion += Math.min(1, Math.max(0, 1 - grid.sample(px + nx * d, py + ny * d, pz + nz * d) / d));
    }
    const terrainOccScale = isProp ? 0.45 : 0.76;
    const terrainAO = 1 - terrainOccScale * (occlusion / AO_REACH.length);
    const contactAO = propGrid
      ? propGrid.contactAO(px, py, pz, nx, ny, nz, {
        grid,
        selfClearance: isProp ? Math.max(0.28, propGrid.resolution * 1.75) : 0.16,
        strength: contactStrength,
        minAO: isProp ? 0.38 : 0.26,
      })
      : 1;
    shade[v * SHADE_SIZE] = isProp
      ? terrainAO * (0.44 + 0.56 * contactAO)
      : terrainAO * (0.34 + 0.66 * contactAO);

    let thickness = 0;
    while (thickness < 8 && grid.solidAt(px - nx * (thickness + step), py - ny * (thickness + step), pz - nz * (thickness + step))) {
      thickness += step;
    }
    shade[v * SHADE_SIZE + 1] = thickness;

    if (grid.open) {
      let open = 1;
      for (let y = sy + step; y < top; y += step) {
        if (grid.solidAt(sx, y, sz)) { open = 0; break; }
      }
      shade[v * SHADE_SIZE + 2] = open;
    }
  }
  return { light, dir, shade };
}
