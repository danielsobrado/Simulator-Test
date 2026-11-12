/**
 * Grass silhouettes, ported from grass-test's `grassShapes.js`.
 *
 * The donor bakes one silhouette per field into its blade template. Here every
 * blade carries its shape as an id and the vertex shader applies the profile, so
 * one template per LOD band draws every biome's grass in a single batch — reeds
 * in the wetland, broadleaves in the tropics — without a draw per shape.
 *
 * Grass is fill-rate bound long before it is triangle bound: every shape draws
 * the same vertices, so the only cost that varies is how many pixels a blade
 * covers — the integral of width(r) × widthScale. The donor measured broadleaf
 * at widthScale 1.6 costing 44% frame time at the same triangle count, and keeps
 * every shape within ~1.35× of slender's 0.5; these are its values.
 */
export const MEADOW_GRASS_SHAPES = Object.freeze({
  slender: Object.freeze({ id: 0, label: 'Slender', wind: 1, rest: 1, curve: 1, widthScale: 1, width: (r) => 1 - r }),
  reed: Object.freeze({ id: 1, label: 'Reed', wind: .45, rest: .28, curve: .35, widthScale: 0.55, width: (r) => 1 - r ** 5 }),
  broadleaf: Object.freeze({ id: 2, label: 'Broadleaf', wind: .7, rest: .7, curve: .75, widthScale: 0.85, width: (r) => Math.sqrt(Math.max(0, 1 - r * r)) }),
});

/** Reuse the density uniform's spare channels for structure, shared by blades,
 * cards and live profile updates. No extra instance data or shader branch. */
export function meadowGrowthResponse(profile) {
  const shape = MEADOW_GRASS_SHAPES[profile.shape] ?? MEADOW_GRASS_SHAPES.slender;
  return [profile.density, shape.wind, shape.rest, shape.curve];
}

/**
 * Silhouettes an accent plant may wear (a growth profile's `accents`): the three
 * a biome's own grass can be, plus leaves that only make sense as plants in the
 * sward. The extra ones have no far-card art, so they are never a profile's
 * `shape`, and the look code's radix (MEADOW_SHAPE_COUNT) is unchanged.
 */
export const MEADOW_PLANT_SHAPES = Object.freeze({
  slender: 0, reed: 1, broadleaf: 2,
  /** A leaf on a stalk: pinched at the foot, widest at mid height, pointed. */
  lance: 3,
  /** A long strap leaf: full width most of the way up, then a short taper. */
  strap: 4,
});

/** The noise that sorts stems into plants: clump size, and an offset clear of the tuft field's. */
export const MEADOW_PLANT_FIELD = Object.freeze({ meters: 0.9, offset: Object.freeze([17.3, 53.9]) });
/** Spread of meadowNoise round 0.5, for turning a share of stems into a threshold. */
const PLANT_NOISE_SD = 0.14;

/** Standard normal quantile (Tukey's lambda approximation); enough for a share. */
function quantile(p) {
  return 4.91 * (p ** 0.14 - (1 - p) ** 0.14);
}

/**
 * A profile's accents as the two uniform rows the shader reads:
 * `[shape id, noise threshold, height scale, width scale]`. The first accent
 * takes the noise's high tail and the second its low tail; an absent accent's
 * threshold is out of the noise's range.
 */
export function meadowAccentRows(profile) {
  const row = (accent, sign) => (accent
    ? [MEADOW_PLANT_SHAPES[accent.shape], 0.5 + sign * PLANT_NOISE_SD * quantile(1 - accent.share), accent.height ?? 1, accent.width ?? 1]
    : [0, sign * 9, 1, 1]);
  return { high: row(profile.accents?.[0], 1), low: row(profile.accents?.[1], -1) };
}

export const DEFAULT_MEADOW_SHAPE = 'slender';
/** Shapes a look code spans before its palette index: code = shape + count × palette. */
export const MEADOW_SHAPE_COUNT = Object.keys(MEADOW_GRASS_SHAPES).length;

export function meadowShapeId(name) {
  return (MEADOW_GRASS_SHAPES[name] ?? MEADOW_GRASS_SHAPES[DEFAULT_MEADOW_SHAPE]).id;
}

/**
 * The shape each biome's grass wears, as a lookup by tile id. Unlisted biomes
 * take the default. Resolved from `grass.meadow.shapes.byTileId`.
 *
 * @param {Record<string, string> | undefined} byTileId
 * @returns {Uint8Array} 256 entries, shape id per tile id
 */
export function resolveShapeTable(byTileId, fallback = DEFAULT_MEADOW_SHAPE) {
  const table = new Uint8Array(256).fill(meadowShapeId(fallback));
  for (const [tile, name] of Object.entries(byTileId ?? {})) {
    const id = Number(tile);
    if (!Number.isInteger(id) || id < 0 || id > 255) {
      throw new Error(`Invalid editor configuration: grass.meadow.shapes.byTileId key ${tile} is not a tile id.`);
    }
    if (!MEADOW_GRASS_SHAPES[name]) {
      throw new Error(`Invalid editor configuration: grass.meadow.shapes.byTileId.${tile} names an unknown shape "${name}".`);
    }
    table[id] = MEADOW_GRASS_SHAPES[name].id;
  }
  return table;
}
