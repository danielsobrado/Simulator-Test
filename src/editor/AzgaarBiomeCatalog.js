const CUSTOM_TILE_ID_START = 32;
const CUSTOM_TILE_ID_END = 254;

const STANDARD_DEFINITIONS = [
  ['Marine', '#466eab', '🌊', 'water', false, false],
  ['Hot desert', '#fbe79f', '🏜️', 'desert', false, false],
  ['Cold desert', '#b5b887', '🏜️', 'desert', false, false],
  ['Savanna', '#d2d082', '🌾', 'plains', true, true],
  ['Grassland', '#c8d68f', '🌿', 'plains', true, false],
  ['Tropical seasonal forest', '#b6d95d', '🌴', 'forest', true, true],
  ['Temperate deciduous forest', '#29bc56', '🌳', 'forest', true, true],
  ['Tropical rainforest', '#7dcb35', '🌴', 'forest', true, true],
  ['Temperate rainforest', '#409c43', '🌲', 'forest', true, true],
  ['Taiga', '#4b6b32', '🌲', 'forest', true, true],
  ['Tundra', '#96784b', '🌱', 'snow', false, false],
  ['Glacier', '#d5e7eb', '🧊', 'snow', false, false],
  ['Wetland', '#0b9131', '🪷', 'swamp', true, true],
];
const STANDARD_HABITABILITY = [0, 4, 10, 22, 30, 50, 100, 80, 90, 12, 4, 0, 12];
const STANDARD_MOVEMENT_COST = [10, 200, 150, 60, 50, 70, 70, 80, 90, 200, 1000, 5000, 150];
const STANDARD_ICON_DENSITY = [0, 3, 2, 120, 120, 120, 120, 150, 150, 100, 5, 0, 250];

function keyForName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function validColor(color) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    ? color.toLowerCase()
    : null;
}

function fallbackCustomColor(sourceId) {
  let value = Math.imul(sourceId + 1, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  const red = 64 + ((value >>> 16) & 0x7f);
  const green = 64 + ((value >>> 8) & 0x7f);
  const blue = 64 + (value & 0x7f);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function createDefinition({
  sourceId,
  tileId,
  name,
  color,
  icon,
  standard,
  terrainClass,
  supportsGrass,
  supportsTrees,
  habitability,
  movementCost,
  reliefIconDensity,
  reliefIcons,
}) {
  return Object.freeze({
    sourceId,
    tileId,
    key: standard ? `azgaar_${keyForName(name)}` : `azgaar_custom_${sourceId}`,
    name,
    color,
    icon,
    standard,
    terrainClass,
    supportsGrass,
    supportsTrees,
    habitability,
    movementCost,
    reliefIconDensity,
    reliefIcons: Object.freeze([...reliefIcons]),
  });
}

export const AZGAAR_STANDARD_BIOMES = Object.freeze(
  STANDARD_DEFINITIONS.map((
    [name, color, icon, terrainClass, supportsGrass, supportsTrees],
    sourceId,
  ) => createDefinition({
    sourceId,
    tileId: sourceId,
    name,
    color,
    icon,
    standard: true,
    terrainClass,
    supportsGrass,
    supportsTrees,
    habitability: STANDARD_HABITABILITY[sourceId],
    movementCost: STANDARD_MOVEMENT_COST[sourceId],
    reliefIconDensity: STANDARD_ICON_DENSITY[sourceId],
    reliefIcons: [],
  })),
);

function normalizeBiomeMetadata(source) {
  if (!Array.isArray(source)) return source ?? {};
  const result = {
    name: [],
    color: [],
    habitability: [],
    cost: [],
    iconsDensity: [],
    icons: [],
  };
  for (const biome of source) {
    if (!Number.isInteger(biome?.i) || biome.i < 0 || biome.removed === true) continue;
    result.name[biome.i] = biome.name;
    result.color[biome.i] = biome.color;
    result.habitability[biome.i] = biome.habitability;
    result.cost[biome.i] = biome.cost;
    result.iconsDensity[biome.i] = biome.iconsDensity;
    result.icons[biome.i] = biome.icons;
  }
  return result;
}

function customSourceIds(biomesData, observedSourceIds) {
  const ids = new Set();
  const names = Array.isArray(biomesData?.name) ? biomesData.name : [];
  const colors = Array.isArray(biomesData?.color) ? biomesData.color : [];
  const metadataLength = Math.max(names.length, colors.length);
  for (let sourceId = AZGAAR_STANDARD_BIOMES.length; sourceId < metadataLength; sourceId += 1) {
    if (
      (typeof names[sourceId] === 'string' && names[sourceId].trim() !== '')
      || validColor(colors[sourceId])
    ) {
      ids.add(sourceId);
    }
  }
  for (const sourceId of observedSourceIds ?? []) {
    if (Number.isInteger(sourceId) && sourceId >= AZGAAR_STANDARD_BIOMES.length) {
      ids.add(sourceId);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function normalizedTokens(text) {
  return new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function includesConfiguredKeyword(text, values) {
  if (!Array.isArray(values)) return false;
  const tokens = normalizedTokens(text);
  return values.some((value) => {
    const keyword = String(value).trim().toLowerCase();
    if (!keyword) return false;
    if (/[^a-z0-9]/.test(keyword)) return String(text).toLowerCase().includes(keyword);
    return tokens.has(keyword);
  });
}

function inferCustomSemantics(name, reliefIcons, config) {
  const nameText = name.toLowerCase();
  const iconText = reliefIcons.join(' ').toLowerCase();
  if (includesConfiguredKeyword(nameText, config?.customBiomeWaterKeywords)) {
    return { terrainClass: 'water', supportsGrass: false, supportsTrees: false };
  }
  if (includesConfiguredKeyword(nameText, config?.customBiomeSnowKeywords)) {
    return { terrainClass: 'snow', supportsGrass: false, supportsTrees: false };
  }
  if (includesConfiguredKeyword(nameText, config?.customBiomeDesertKeywords)) {
    return { terrainClass: 'desert', supportsGrass: false, supportsTrees: false };
  }
  if (includesConfiguredKeyword(nameText, config?.customBiomeSwampKeywords)) {
    return { terrainClass: 'swamp', supportsGrass: true, supportsTrees: true };
  }
  if (includesConfiguredKeyword(nameText, config?.customBiomeForestKeywords)) {
    return { terrainClass: 'forest', supportsGrass: true, supportsTrees: true };
  }
  return {
    terrainClass: 'plains',
    supportsGrass: true,
    supportsTrees: includesConfiguredKeyword(iconText, config?.customBiomeTreeIconKeywords),
  };
}

export function createAzgaarBiomeDefinitions(
  sourceBiomeMetadata = {},
  observedSourceIds = [],
  semanticConfig = null,
) {
  const biomesData = normalizeBiomeMetadata(sourceBiomeMetadata);
  const names = Array.isArray(biomesData?.name) ? biomesData.name : [];
  const colors = Array.isArray(biomesData?.color) ? biomesData.color : [];
  const habitability = Array.isArray(biomesData?.habitability) ? biomesData.habitability : [];
  const movementCost = Array.isArray(biomesData?.cost) ? biomesData.cost : [];
  const iconDensity = Array.isArray(biomesData?.iconsDensity) ? biomesData.iconsDensity : [];
  const icons = Array.isArray(biomesData?.icons) ? biomesData.icons : [];
  const standard = AZGAAR_STANDARD_BIOMES.map((definition) => createDefinition({
    ...definition,
    name: typeof names[definition.sourceId] === 'string' && names[definition.sourceId].trim()
      ? names[definition.sourceId].trim()
      : definition.name,
    color: validColor(colors[definition.sourceId]) ?? definition.color,
    habitability: Number.isFinite(habitability[definition.sourceId])
      ? Math.max(0, habitability[definition.sourceId])
      : definition.habitability,
    movementCost: Number.isFinite(movementCost[definition.sourceId])
      ? Math.max(0, movementCost[definition.sourceId])
      : definition.movementCost,
    reliefIconDensity: Number.isFinite(iconDensity[definition.sourceId])
      ? Math.max(0, Math.round(iconDensity[definition.sourceId]))
      : definition.reliefIconDensity,
    reliefIcons: Array.isArray(icons[definition.sourceId])
      ? icons[definition.sourceId].filter((icon) => typeof icon === 'string')
      : definition.reliefIcons,
  }));
  const customIds = customSourceIds(biomesData, observedSourceIds);
  if (customIds.some((sourceId) => sourceId > 255)) {
    throw new Error('Azgaar biome source ids must fit in an unsigned byte (0–255).');
  }
  if (customIds.length > CUSTOM_TILE_ID_END - CUSTOM_TILE_ID_START + 1) {
    throw new Error(
      `Azgaar map defines ${customIds.length} custom biomes; at most `
      + `${CUSTOM_TILE_ID_END - CUSTOM_TILE_ID_START + 1} are supported.`,
    );
  }
  const custom = customIds.map((sourceId, index) => {
    const name = typeof names[sourceId] === 'string' && names[sourceId].trim()
      ? names[sourceId].trim()
      : `Custom biome ${sourceId}`;
    const reliefIcons = Array.isArray(icons[sourceId])
      ? icons[sourceId].filter((icon) => typeof icon === 'string')
      : [];
    return createDefinition({
      sourceId,
      tileId: CUSTOM_TILE_ID_START + index,
      name,
      color: validColor(colors[sourceId]) ?? fallbackCustomColor(sourceId),
      icon: '🗺️',
      standard: false,
      ...inferCustomSemantics(name, reliefIcons, semanticConfig),
      habitability: Number.isFinite(habitability[sourceId])
        ? Math.max(0, habitability[sourceId])
        : 0,
      movementCost: Number.isFinite(movementCost[sourceId])
        ? Math.max(0, movementCost[sourceId])
        : 0,
      reliefIconDensity: Number.isFinite(iconDensity[sourceId])
        ? Math.max(0, Math.round(iconDensity[sourceId]))
        : 0,
      reliefIcons,
    });
  });
  return Object.freeze([...standard, ...custom]);
}

export const AZGAAR_CUSTOM_TILE_ID_RANGE = Object.freeze({
  minimum: CUSTOM_TILE_ID_START,
  maximum: CUSTOM_TILE_ID_END,
});
