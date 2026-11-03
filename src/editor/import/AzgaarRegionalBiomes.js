/**
 * Regional biomes carved out of an Azgaar map at import: cells of the named
 * states that wear one of `fromBiomes` and get at most `maxPrecipitation` are
 * moved to a new custom biome, which then flows through the ordinary custom
 * biome path (AzgaarBiomeCatalog.js, terrain ids 32–254). The map file itself is
 * never changed; only the document handed to the importer is.
 *
 * `relief: canyon` asks the terrain to raise mesas and cut canyons there
 * (world/CanyonRelief.js), stamped into the world like the ridges.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const RELIEFS = Object.freeze(['canyon']);

function fail(path, message) {
  throw new Error(`Invalid editor configuration: ${path} ${message}.`);
}

export function validateRegionalBiomes(regions, path = 'import.azgaarRegionalBiomes') {
  if (regions == null) return [];
  if (!Array.isArray(regions)) fail(path, 'must be a list');
  regions.forEach((region, index) => {
    const at = `${path}[${index}]`;
    if (typeof region?.name !== 'string' || !region.name.trim()) fail(`${at}.name`, 'must be a name');
    if (!HEX_COLOR.test(region.color ?? '')) fail(`${at}.color`, 'must be a #rrggbb colour');
    if (!Array.isArray(region.states) || !region.states.length
        || region.states.some((state) => typeof state !== 'string')) {
      fail(`${at}.states`, 'must list Azgaar state names');
    }
    if (!Array.isArray(region.fromBiomes) || !region.fromBiomes.length
        || region.fromBiomes.some((id) => !Number.isInteger(id) || id < 0 || id > 255)) {
      fail(`${at}.fromBiomes`, 'must list Azgaar biome ids');
    }
    if (region.maxPrecipitation !== undefined && !(region.maxPrecipitation >= 0)) {
      fail(`${at}.maxPrecipitation`, 'must be a number ≥ 0');
    }
    if (region.relief !== undefined && !RELIEFS.includes(region.relief)) {
      fail(`${at}.relief`, `must be one of ${RELIEFS.join(', ')}`);
    }
  });
  return regions;
}

function appendBiome(document, sourceId, region) {
  if (Array.isArray(document.pack?.biomes)) {
    return {
      biomesData: document.biomesData,
      pack: { ...document.pack, biomes: [...document.pack.biomes, { i: sourceId, name: region.name, color: region.color }] },
    };
  }
  const data = document.biomesData ?? {};
  const withEntry = (key, value) => {
    const list = Array.isArray(data[key]) ? [...data[key]] : [];
    list[sourceId] = value;
    return list;
  };
  return {
    biomesData: {
      ...data,
      name: withEntry('name', region.name),
      color: withEntry('color', region.color),
      habitability: withEntry('habitability', 0),
      iconsDensity: withEntry('iconsDensity', 0),
      icons: withEntry('icons', []),
      cost: withEntry('cost', 200),
    },
    pack: document.pack,
  };
}

function nextSourceId(document) {
  const ids = Array.isArray(document.pack?.biomes)
    ? document.pack.biomes.map((biome) => biome.i)
    : [(document.biomesData?.name?.length ?? 13) - 1];
  return Math.max(12, ...ids.filter(Number.isInteger)) + 1;
}

/** The document with each region's cells moved to its own biome; unchanged when none match. */
export function applyRegionalBiomes(document, regions) {
  let result = document;
  for (const region of validateRegionalBiomes(regions)) {
    const states = new Set((result.pack?.states ?? [])
      .filter((state) => state && region.states.includes(state.name))
      .map((state) => state.i));
    if (!states.size) continue;
    const from = new Set(region.fromBiomes);
    const maxPrecipitation = region.maxPrecipitation ?? Infinity;
    const sourceId = nextSourceId(result);
    const grid = result.grid?.cells ?? [];
    let moved = 0;
    const cells = (result.pack?.cells ?? []).map((cell) => {
      if (!states.has(cell?.state) || !from.has(cell.biome)
          || !((grid[cell.g]?.prec ?? 0) <= maxPrecipitation)) return cell;
      moved += 1;
      return { ...cell, biome: sourceId };
    });
    if (!moved) continue;
    const { biomesData, pack } = appendBiome(result, sourceId, region);
    result = { ...result, biomesData, pack: { ...pack, cells } };
  }
  return result;
}

/** Source ids of the regional biomes that ask for canyon relief, as the import found them. */
export function canyonBiomeSourceIds(definitions, regions) {
  const names = new Set((regions ?? [])
    .filter((region) => region.relief === 'canyon')
    .map((region) => region.name.trim()));
  return definitions
    .filter((definition) => !definition.standard && names.has(definition.name))
    .map((definition) => definition.sourceId);
}
