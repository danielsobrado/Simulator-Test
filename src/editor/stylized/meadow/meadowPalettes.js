import { MEADOW_SHAPE_COUNT } from './meadowGrassShapes.js';

/**
 * The meadow's pigment per biome (`grass.meadow.palette`).
 *
 * grass-test paints one field, so it has one blade base and tip. A world of
 * biomes wants its taiga cooler and its savanna drier than that meadow, without
 * a draw per colour. So each biome's palette index rides in the stem's look code
 * beside its silhouette — `code = shape + 3 × (palette + 8 × growth)`, one
 * small integer per tile id — and the pigment reads its base and tip from a
 * uniform array by that index. No attribute is added; the batch stays one draw.
 */
export const MAX_MEADOW_PALETTES = 8;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function hex(value, path) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new Error(`Invalid editor configuration: ${path} must be a #rrggbb colour.`);
  }
  return value;
}

/**
 * @param {object | null | undefined} source `base`, `tip`, optional `brightness`
 *   and `byTileId: { [tileId]: { base, tip, lush? } }`; `lush` (0..1, default 1)
 *   scales the green-ward patch and hollow tints, which turn a dry palette olive
 * @param {string} path for error messages
 * @returns {null | { palettes: {base: string, tip: string, lush: number}[], brightness: number, table: Uint8Array }}
 *   null paints the meadow with the shared grass tuning instead; `table` is the
 *   palette index per tile id (0, the base palette, where unlisted)
 */
export function resolveMeadowPalettes(source, path) {
  if (source == null) return null;
  const palettes = [{ base: hex(source.base, `${path}.base`), tip: hex(source.tip, `${path}.tip`), lush: 1 }];
  const brightness = source.brightness ?? 1;
  if (!Number.isFinite(brightness) || brightness < 0 || brightness > 4) {
    throw new Error(`Invalid editor configuration: ${path}.brightness must be a number in [0, 4].`);
  }
  const table = new Uint8Array(256);
  const byColour = new Map();
  for (const [tile, entry] of Object.entries(source.byTileId ?? {})) {
    const id = Number(tile);
    if (!Number.isInteger(id) || id < 0 || id > 255) {
      throw new Error(`Invalid editor configuration: ${path}.byTileId key ${tile} is not a tile id.`);
    }
    const base = hex(entry?.base, `${path}.byTileId.${tile}.base`);
    const tip = hex(entry?.tip, `${path}.byTileId.${tile}.tip`);
    const lush = entry.lush ?? 1;
    if (!Number.isFinite(lush) || lush < 0 || lush > 1) {
      throw new Error(`Invalid editor configuration: ${path}.byTileId.${tile}.lush must be a number in [0, 1].`);
    }
    const key = `${base}${tip}${lush}`.toLowerCase();
    if (!byColour.has(key)) {
      if (palettes.length === MAX_MEADOW_PALETTES) {
        throw new Error(
          `Invalid editor configuration: ${path}.byTileId names more than ${MAX_MEADOW_PALETTES - 1} distinct palettes.`,
        );
      }
      byColour.set(key, palettes.length);
      palettes.push({ base, tip, lush });
    }
    table[id] = byColour.get(key);
  }
  return { palettes, brightness, table };
}

/**
 * The look code per tile id the ground sampler hands each stem.
 *
 * @param {Uint8Array} shapeTable shape id per tile id
 * @param {Uint8Array | null} paletteTable palette index per tile id
 * @param {Uint8Array | null} growthTable growth profile index per tile id
 */
export function encodeLookTable(shapeTable, paletteTable, growthTable = null) {
  if (!paletteTable && !growthTable) return Uint16Array.from(shapeTable);
  const table = new Uint16Array(256);
  for (let tile = 0; tile < 256; tile += 1) {
    table[tile] = shapeTable[tile] + MEADOW_SHAPE_COUNT * ((paletteTable?.[tile] ?? 0) + MAX_MEADOW_PALETTES * (growthTable?.[tile] ?? 0));
  }
  return table;
}
