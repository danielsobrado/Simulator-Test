const LAND_HEIGHT = 20;
const NO_DISTANCE = 0xffff;
const MAX_SIGNED_DISTANCE = 0x7fff;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(minimum, maximum, value) {
  const amount = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function byte(value) {
  return Math.round(clamp(value, 0, 1) * 255);
}

function indexAt(x, y, width, height) {
  return clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);
}

function terrainNeighborElevation(elevation, index, center, land) {
  const neighbor = elevation[index];
  return land && neighbor < LAND_HEIGHT ? center : neighbor;
}

function distanceToSeeds(seeds, width, height) {
  const length = width * height;
  let hasSeed = false;
  const costs = new Uint32Array(length);
  for (let index = 0; index < length; index += 1) {
    if (seeds[index]) {
      costs[index] = 0;
      hasSeed = true;
    } else {
      costs[index] = 0xffffffff;
    }
  }
  if (!hasSeed) return new Uint16Array(length).fill(NO_DISTANCE);

  const relax = (index, neighbor, weight) => {
    if (neighbor < 0 || neighbor >= length || costs[neighbor] === 0xffffffff) return;
    costs[index] = Math.min(costs[index], costs[neighbor] + weight);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x > 0) relax(index, index - 1, 3);
      if (y > 0) relax(index, index - width, 3);
      if (x > 0 && y > 0) relax(index, index - width - 1, 4);
      if (x + 1 < width && y > 0) relax(index, index - width + 1, 4);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (x + 1 < width) relax(index, index + 1, 3);
      if (y + 1 < height) relax(index, index + width, 3);
      if (x + 1 < width && y + 1 < height) relax(index, index + width + 1, 4);
      if (x > 0 && y + 1 < height) relax(index, index + width - 1, 4);
    }
  }

  const distances = new Uint16Array(length);
  for (let index = 0; index < length; index += 1) {
    distances[index] = Math.min(NO_DISTANCE - 1, Math.round(costs[index] / 3));
  }
  return distances;
}

function createCoastDistances(elevation, width, height) {
  const seeds = new Uint8Array(elevation.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const land = elevation[index] >= LAND_HEIGHT;
      const touchesOpposite = (x > 0 && (elevation[index - 1] >= LAND_HEIGHT) !== land)
        || (x + 1 < width && (elevation[index + 1] >= LAND_HEIGHT) !== land)
        || (y > 0 && (elevation[index - width] >= LAND_HEIGHT) !== land)
        || (y + 1 < height && (elevation[index + width] >= LAND_HEIGHT) !== land)
        || (land && (x === 0 || y === 0 || x + 1 === width || y + 1 === height));
      seeds[index] = touchesOpposite ? 1 : 0;
    }
  }
  const unsigned = distanceToSeeds(seeds, width, height);
  const signed = new Int16Array(elevation.length);
  for (let index = 0; index < signed.length; index += 1) {
    const distance = Math.min(MAX_SIGNED_DISTANCE, unsigned[index]);
    signed[index] = elevation[index] >= LAND_HEIGHT ? distance : -distance;
  }
  return signed;
}

function markLine(seeds, width, height, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    const x = clamp(Math.round(start[0] + dx * amount), 0, width - 1);
    const y = clamp(Math.round(start[1] + dy * amount), 0, height - 1);
    seeds[y * width + x] = 1;
  }
}

function createRiverDistances(riverId, rivers, width, height) {
  const seeds = new Uint8Array(width * height);
  if (rivers?.length) {
    for (const river of rivers) {
      for (let index = 1; index < river.points.length; index += 1) {
        markLine(seeds, width, height, river.points[index - 1], river.points[index]);
      }
    }
  } else {
    for (let index = 0; index < riverId.length; index += 1) {
      seeds[index] = riverId[index] > 0 ? 1 : 0;
    }
  }
  return distanceToSeeds(seeds, width, height);
}

function requireFinite(config, name) {
  const value = config?.[name];
  if (!Number.isFinite(value)) {
    throw new Error(`Azgaar guidance configuration ${name} must be finite.`);
  }
  return value;
}

function requirePositive(config, name) {
  const value = requireFinite(config, name);
  if (value <= 0) {
    throw new Error(`Azgaar guidance configuration ${name} must be positive.`);
  }
  return value;
}

function pixelRadius(kilometers, metersPerAtlasPixel) {
  return Math.max(1, Math.round(kilometers * 1000 / metersPerAtlasPixel));
}

function biomeForestAffinity(biomes) {
  const result = new Map();
  for (const biome of biomes ?? []) {
    if (!Number.isInteger(biome?.sourceId)) continue;
    const affinity = biome.terrainClass === 'forest' ? 1 : biome.supportsTrees ? 0.25 : 0;
    result.set(biome.sourceId, affinity);
  }
  return result;
}

function resolveTuning(config, metersPerAtlasPixel) {
  const temperatureMin = requireFinite(config, 'temperatureNormalizationMinC');
  const temperatureMax = requireFinite(config, 'temperatureNormalizationMaxC');
  const mountainReliefStart = requireFinite(config, 'mountainReliefStart');
  const mountainReliefEnd = requireFinite(config, 'mountainReliefEnd');
  if (temperatureMax <= temperatureMin) {
    throw new Error('Azgaar guidance temperature normalization range is invalid.');
  }
  if (mountainReliefEnd <= mountainReliefStart) {
    throw new Error('Azgaar guidance mountain relief range is invalid.');
  }
  return Object.freeze({
    coastInfluencePixels: pixelRadius(
      requirePositive(config, 'coastInfluenceKilometers'),
      metersPerAtlasPixel,
    ),
    riverInfluencePixels: pixelRadius(
      requirePositive(config, 'riverInfluenceKilometers'),
      metersPerAtlasPixel,
    ),
    ruggednessOffset: pixelRadius(
      requirePositive(config, 'ruggednessSampleKilometers'),
      metersPerAtlasPixel,
    ),
    ruggednessElevationDelta: requirePositive(config, 'ruggednessElevationDelta'),
    valleyElevationDelta: requirePositive(config, 'valleyElevationDelta'),
    valleyRuggednessSuppression: requireFinite(config, 'valleyRuggednessSuppression'),
    precipitationScale: requirePositive(config, 'precipitationNormalization'),
    temperatureMin,
    temperatureRange: temperatureMax - temperatureMin,
    mountainReliefStart,
    mountainReliefEnd,
    mountainReliefWeight: requireFinite(config, 'mountainReliefWeight'),
    mountainRuggednessWeight: requireFinite(config, 'mountainRuggednessWeight'),
    snowTemperatureWeight: requireFinite(config, 'snowTemperatureWeight'),
    snowReliefWeight: requireFinite(config, 'snowReliefWeight'),
    snowBias: requireFinite(config, 'snowBias'),
    temperateCenter: requireFinite(config, 'temperateCenter'),
    temperateRange: requirePositive(config, 'temperateRange'),
    forestMoistureWeight: requireFinite(config, 'forestMoistureWeight'),
    forestTemperatureWeight: requireFinite(config, 'forestTemperatureWeight'),
    forestBiomeWeight: requireFinite(config, 'forestBiomeWeight'),
    forestSnowPenalty: requireFinite(config, 'forestSnowPenalty'),
    agricultureMoistureCenter: requireFinite(config, 'agricultureMoistureCenter'),
    agricultureMoistureRange: requirePositive(config, 'agricultureMoistureRange'),
    agricultureMoistureWeight: requireFinite(config, 'agricultureMoistureWeight'),
    agricultureTemperatureWeight: requireFinite(config, 'agricultureTemperatureWeight'),
    agricultureFlatnessWeight: requireFinite(config, 'agricultureFlatnessWeight'),
    agricultureLowlandWeight: requireFinite(config, 'agricultureLowlandWeight'),
    agricultureSettlementWeight: requireFinite(config, 'agricultureSettlementWeight'),
    wetnessMoistureWeight: requireFinite(config, 'wetnessMoistureWeight'),
    wetnessRiverWeight: requireFinite(config, 'wetnessRiverWeight'),
    wetnessCoastWeight: requireFinite(config, 'wetnessCoastWeight'),
    wetnessReliefPenalty: requireFinite(config, 'wetnessReliefPenalty'),
    harborScoreNormalization: requirePositive(config, 'harborScoreNormalization'),
  });
}

export function deriveAzgaarWorldGuidance({
  raw,
  rivers,
  width,
  height,
  physicalWidthMeters,
  biomes,
  config,
}) {
  if (!Number.isFinite(physicalWidthMeters) || physicalWidthMeters <= 0) {
    throw new Error('Azgaar guidance requires a positive physical world width.');
  }
  const metersPerAtlasPixel = physicalWidthMeters / width;
  const tuning = resolveTuning(config, metersPerAtlasPixel);
  const coastDistance = createCoastDistances(raw.elevation, width, height);
  const riverDistance = createRiverDistances(raw.riverId, rivers, width, height);
  const length = width * height;
  const moisture = new Uint8Array(length);
  const continentalness = new Uint8Array(length);
  const wetness = new Uint8Array(length);
  const mountainness = new Uint8Array(length);
  const ruggedness = new Uint8Array(length);
  const valleyness = new Uint8Array(length);
  const snowPotential = new Uint8Array(length);
  const forestPotential = new Uint8Array(length);
  const agriculturalPotential = new Uint8Array(length);
  const harborPotential = new Uint8Array(length);
  const forestAffinity = biomeForestAffinity(biomes);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const elevation = raw.elevation[index];
      const land = elevation >= LAND_HEIGHT;
      const relief = land ? clamp((elevation - LAND_HEIGHT) / (100 - LAND_HEIGHT), 0, 1) : 0;
      const temperature = clamp(
        (raw.temperature[index] - tuning.temperatureMin) / tuning.temperatureRange,
        0,
        1,
      );
      const localMoisture = clamp(raw.precipitation[index] / tuning.precipitationScale, 0, 1);
      const coast = land
        ? clamp(coastDistance[index] / tuning.coastInfluencePixels, 0, 1)
        : 0;
      const river = riverDistance[index] === NO_DISTANCE
        ? 0
        : 1 - clamp(riverDistance[index] / tuning.riverInfluencePixels, 0, 1);
      const left = terrainNeighborElevation(
        raw.elevation,
        indexAt(x - tuning.ruggednessOffset, y, width, height),
        elevation,
        land,
      );
      const right = terrainNeighborElevation(
        raw.elevation,
        indexAt(x + tuning.ruggednessOffset, y, width, height),
        elevation,
        land,
      );
      const north = terrainNeighborElevation(
        raw.elevation,
        indexAt(x, y - tuning.ruggednessOffset, width, height),
        elevation,
        land,
      );
      const south = terrainNeighborElevation(
        raw.elevation,
        indexAt(x, y + tuning.ruggednessOffset, width, height),
        elevation,
        land,
      );
      const localRuggedness = land
        ? clamp(
          Math.max(Math.abs(right - left), Math.abs(south - north))
            / tuning.ruggednessElevationDelta,
          0,
          1,
        )
        : 0;
      const surrounding = (left + right + north + south) / 4;
      const localValleyness = land
        ? clamp((surrounding - elevation) / tuning.valleyElevationDelta, 0, 1)
          * (1 - localRuggedness * tuning.valleyRuggednessSuppression)
        : 0;
      const mountain = land
        ? clamp(
          smoothstep(tuning.mountainReliefStart, tuning.mountainReliefEnd, relief)
            * tuning.mountainReliefWeight
            + localRuggedness * tuning.mountainRuggednessWeight,
          0,
          1,
        )
        : 0;
      const snow = land
        ? clamp(
          (1 - temperature) * tuning.snowTemperatureWeight
            + relief * tuning.snowReliefWeight
            - tuning.snowBias,
          0,
          1,
        )
        : 0;
      const temperate = 1 - clamp(
        Math.abs(temperature - tuning.temperateCenter) / tuning.temperateRange,
        0,
        1,
      );
      const forestBiome = forestAffinity.get(raw.biomeId[index]) ?? 0;
      const forest = land
        ? clamp(
          localMoisture * tuning.forestMoistureWeight
            + temperate * tuning.forestTemperatureWeight
            + forestBiome * tuning.forestBiomeWeight
            - snow * tuning.forestSnowPenalty,
          0,
          1,
        )
        : 0;
      const moistureBalance = 1 - clamp(
        Math.abs(localMoisture - tuning.agricultureMoistureCenter)
          / tuning.agricultureMoistureRange,
        0,
        1,
      );
      const settlement = clamp(raw.settlementScore[index] / 0xffff, 0, 1);
      const agriculture = land
        ? clamp(
          moistureBalance * tuning.agricultureMoistureWeight
            + temperate * tuning.agricultureTemperatureWeight
            + (1 - localRuggedness) * tuning.agricultureFlatnessWeight
            + (1 - mountain) * tuning.agricultureLowlandWeight
            + settlement * tuning.agricultureSettlementWeight,
          0,
          1,
        )
        : 0;

      moisture[index] = byte(localMoisture);
      continentalness[index] = byte(coast);
      wetness[index] = byte(land
        ? localMoisture * tuning.wetnessMoistureWeight
          + river * tuning.wetnessRiverWeight
          + (1 - coast) * tuning.wetnessCoastWeight
          - relief * tuning.wetnessReliefPenalty
        : 1);
      ruggedness[index] = byte(localRuggedness);
      valleyness[index] = byte(localValleyness);
      mountainness[index] = byte(mountain);
      snowPotential[index] = byte(snow);
      forestPotential[index] = byte(forest);
      agriculturalPotential[index] = byte(agriculture);
      harborPotential[index] = raw.harborScore[index] > 0
        ? byte(raw.harborScore[index] / tuning.harborScoreNormalization)
        : 0;
    }
  }

  return Object.freeze({
    coastDistance,
    riverDistance,
    moisture,
    continentalness,
    wetness,
    mountainness,
    ruggedness,
    valleyness,
    snowPotential,
    forestPotential,
    agriculturalPotential,
    harborPotential,
  });
}

export const AZGAAR_LAND_HEIGHT = LAND_HEIGHT;
export const WORLD_GUIDANCE_NO_DISTANCE = NO_DISTANCE;
