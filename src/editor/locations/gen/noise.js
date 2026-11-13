/** Deterministic CPU noise for location generation. Seeds are integers. */

export function createRng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function lattice(x, y, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iy, iz, seed), b = lattice(ix + 1, iy, iz, seed);
  const c = lattice(ix, iy + 1, iz, seed), d = lattice(ix + 1, iy + 1, iz, seed);
  const e = lattice(ix, iy, iz + 1, seed), f = lattice(ix + 1, iy, iz + 1, seed);
  const g = lattice(ix, iy + 1, iz + 1, seed), h = lattice(ix + 1, iy + 1, iz + 1, seed);
  const near = a + (b - a) * u + (c - a + (a - b - c + d) * u) * v;
  const far = e + (f - e) * u + (g - e + (e - f - g + h) * u) * v;
  return near + (far - near) * w;
}

/** Fractal value noise in roughly [0, 1]. */
export function fbm3(x, y, z, seed = 0, octaves = 3) {
  let sum = 0, amplitude = 0.5, norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise3(x, y, z, seed + octave * 17) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    x *= 2.03; y *= 2.03; z *= 2.03;
  }
  return sum / norm;
}

/** Sharp creases in [0, 1]: 1 on the crease. */
export function ridged3(x, y, z, seed = 0) {
  return 1 - Math.abs(valueNoise3(x, y, z, seed) * 2 - 1);
}
