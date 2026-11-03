/**
 * How each biome's ground and water answer the player and spells
 * (config/biome-looks.yaml `surface` defaults and per-row `ripples`, `prints`,
 * `dunes`):
 *
 *   ripples  the water ripple field (water/RippleField.js): wave `speed` (m/s),
 *            `fade` (seconds for a ring to die away), `splash` (gain on every
 *            disturbance) and ambient `drops` per second (insects, canopy drip).
 *   prints   footprints and spell craters (stylized/deformation): how much of
 *            the biome's bare `ground` takes them besides snow and beach, how
 *            long they stay (`lifetime`, s) and the `tint` pressed ground takes.
 *   dunes    the wind ripples on `arid: sand` ground (materials/AridSubstrateNodes.js):
 *            `wavelength` (m), `wind` (degrees from +x toward +z), relief
 *            `height` and crest `sharpness` (0 a sine, 1 a steep lee face).
 *
 * Ripples and prints describe the region round the player, so they resolve to
 * dense per-tile tables that BiomeSurfaceResponse blends on the CPU. Dunes are
 * spatial and resolve per sand tile for the terrain shader.
 */

/** Pattern lattice cells per metre of the terrain's `fine` frame (TerrainTransitionNodes). */
export const DUNE_LATTICE_SCALE = 1.3;
/** The sand ripple the terrain drew before dunes were tunable: lattice frequency (4, 1). */
export const DEFAULT_DUNE = Object.freeze({ a: 4, b: 1, height: 1, sharpness: 0 });

const DEFAULT_SURFACE = Object.freeze({
  ripples: Object.freeze({ speed: 1.4, fade: 3, splash: 1, drops: 0 }),
  prints: Object.freeze({ ground: 0, lifetime: 90, tint: '#b8ada3' }),
});
const RIPPLE_LIMITS = Object.freeze({ speed: [0.05, 4], fade: [0.1, 30], splash: [0, 4], drops: [0, 60] });
const PRINT_LIMITS = Object.freeze({ ground: [0, 1], lifetime: [1, 600] });
const DUNE_LIMITS = Object.freeze({ wavelength: [0.05, 2], wind: [-360, 360], height: [0, 3], sharpness: [0, 1] });
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function fail(path, message) {
  throw new Error(`Invalid biome look configuration: ${path} ${message}.`);
}

function inRange(value, [low, high], path) {
  if (!Number.isFinite(value) || value < low || value > high) fail(path, `must be within [${low}, ${high}]`);
  return value;
}

function record(value, path, limits, extra = []) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (limits[key]) result[key] = inRange(entry, limits[key], `${path}.${key}`);
    else if (extra.includes(key)) result[key] = entry;
    else fail(`${path}.${key}`, `is not one of ${[...Object.keys(limits), ...extra].join(', ')}`);
  }
  return result;
}

function tint(value, path) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) fail(path, 'must be a #rrggbb colour');
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/**
 * The integer lattice frequency nearest a wavelength and wind heading. The
 * terrain's sand pattern must close over the 512-cell pattern period, so only
 * whole frequencies are drawable; the wavelength snaps to the nearest one.
 */
export function duneLatticeFrequency(wavelength, windDegrees) {
  const cycles = 1 / (DUNE_LATTICE_SCALE * wavelength);
  const angle = windDegrees * Math.PI / 180;
  let a = Math.round(cycles * Math.cos(angle));
  const b = Math.round(cycles * Math.sin(angle));
  if (a === 0 && b === 0) a = 1;
  return { a, b };
}

/**
 * @param {object|undefined} defaults `biomeLooks.surface`
 * @param {Iterable<[number, object, string]>} rows `[tileId, row, path]`
 */
export function resolveBiomeSurfaceLooks(defaults, rows) {
  const base = {
    ripples: { ...DEFAULT_SURFACE.ripples, ...record(defaults?.ripples, 'biomeLooks.surface.ripples', RIPPLE_LIMITS) },
    prints: { ...DEFAULT_SURFACE.prints, ...record(defaults?.prints, 'biomeLooks.surface.prints', PRINT_LIMITS, ['tint']) },
  };
  const table = (value) => new Float32Array(256).fill(value);
  const ripples = Object.fromEntries(Object.entries(base.ripples).map(([key, value]) => [key, table(value)]));
  const prints = {
    ground: table(base.prints.ground),
    lifetime: table(base.prints.lifetime),
    tint: new Float32Array(256 * 3),
  };
  const baseTint = tint(base.prints.tint, 'biomeLooks.surface.prints.tint');
  for (let id = 0; id < 256; id += 1) prints.tint.set(baseTint, id * 3);
  const dunes = {};
  for (const [id, row, path] of rows) {
    for (const [key, value] of Object.entries(record(row.ripples, `${path}.ripples`, RIPPLE_LIMITS))) ripples[key][id] = value;
    const print = record(row.prints, `${path}.prints`, PRINT_LIMITS, ['tint']);
    if (print.ground !== undefined) prints.ground[id] = print.ground;
    if (print.lifetime !== undefined) prints.lifetime[id] = print.lifetime;
    if (print.tint !== undefined) prints.tint.set(tint(print.tint, `${path}.prints.tint`), id * 3);
    if (row.dunes !== undefined) {
      const dune = record(row.dunes, `${path}.dunes`, DUNE_LIMITS);
      const frequency = dune.wavelength === undefined && dune.wind === undefined
        ? { a: DEFAULT_DUNE.a, b: DEFAULT_DUNE.b }
        : duneLatticeFrequency(dune.wavelength ?? 0.19, dune.wind ?? 14);
      dunes[id] = Object.freeze({ ...frequency, height: dune.height ?? 1, sharpness: dune.sharpness ?? 0 });
    }
  }
  return Object.freeze({ ripples: Object.freeze(ripples), prints: Object.freeze(prints), dunes: Object.freeze(dunes) });
}
