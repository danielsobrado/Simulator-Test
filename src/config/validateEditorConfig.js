import { validateSimulationConfig } from './validateSimulationConfig.js';

const REQUIRED_POSITIVE_PATHS = Object.freeze([
  Object.freeze(['map', 'tileSize']),
  Object.freeze(['map', 'chunkSize']),
  Object.freeze(['import', 'azgaarAtlasLongEdge']),
  Object.freeze(['import', 'azgaarOceanTransitionKilometers']),
  Object.freeze(['world', 'chunkSize']),
  Object.freeze(['world', 'prefetchSeconds']),
  Object.freeze(['world', 'maxResidentChunks']),
  Object.freeze(['world', 'maxCpuChunks']),
  Object.freeze(['world', 'floatingOriginThreshold']),
  Object.freeze(['world', 'minimapCells']),
  Object.freeze(['world', 'heightScale']),
  Object.freeze(['camera', 'viewSize']),
  Object.freeze(['player', 'fovDegrees']),
  Object.freeze(['player', 'walkSpeed']),
  Object.freeze(['player', 'runMultiplier']),
  Object.freeze(['player', 'jumpSpeed']),
  Object.freeze(['player', 'gravity']),
  Object.freeze(['player', 'eyeHeight']),
  Object.freeze(['player', 'stepHeight']),
  Object.freeze(['player', 'groundSnapDistance']),
  Object.freeze(['player', 'mouseSensitivity']),
  Object.freeze(['renderer', 'maxPixelRatio']),
  Object.freeze(['terrain', 'sculptStrength']),
]);

const REQUIRED_BOOLEAN_PATHS = Object.freeze([
  Object.freeze(['renderer', 'antialias']),
  Object.freeze(['renderer', 'forceWebGL']),
]);

function readPath(value, path) {
  return path.reduce((current, segment) => current?.[segment], value);
}

function assertPositiveNumber(config, path) {
  const value = readPath(config, path);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid editor configuration: ${path.join('.')} must be positive.`);
  }
}

function assertFiniteNumber(config, path) {
  if (!Number.isFinite(readPath(config, path))) {
    throw new Error(`Invalid editor configuration: ${path.join('.')} must be finite.`);
  }
}

function assertBoolean(config, path) {
  if (typeof readPath(config, path) !== 'boolean') {
    throw new Error(`Invalid editor configuration: ${path.join('.')} must be boolean.`);
  }
}

function assertNonNegativeInteger(config, path) {
  const value = readPath(config, path);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid editor configuration: ${path.join('.')} must be a non-negative integer.`);
  }
}

function assertTileIds(value, fieldName) {
  if (!Array.isArray(value)
      || value.length === 0
      || value.some((tileId) => !Number.isInteger(tileId) || tileId < 0 || tileId > 255)) {
    throw new Error(`Invalid editor configuration: ${fieldName} must contain unsigned-byte tile ids.`);
  }
}

function assertAssetString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid editor configuration: ${fieldName} is required.`);
  }
}

function validateStylizedSurface(config) {
  const surface = config.stylizedSurface;
  if (!surface) return;
  assertBoolean(config, ['stylizedSurface', 'enabled']);
  if (!surface.enabled) return;
  assertBoolean(config, ['stylizedSurface', 'rocks', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'flowers', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'trees', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'water', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'sky', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'sky', 'shadows']);

  const positivePaths = [
    ['stylizedSurface', 'grass', 'bladesPerCell'],
    ['stylizedSurface', 'grass', 'minWidth'],
    ['stylizedSurface', 'grass', 'maxWidth'],
    ['stylizedSurface', 'grass', 'minLength'],
    ['stylizedSurface', 'grass', 'maxLength'],
    ['stylizedSurface', 'wind', 'speed'],
    ['stylizedSurface', 'wind', 'frequency'],
    ['stylizedSurface', 'color', 'brightness'],
    ['stylizedSurface', 'color', 'gradientEnd'],
    ['stylizedSurface', 'color', 'gradientPower'],
    ['stylizedSurface', 'translucency', 'power'],
    ['stylizedSurface', 'patch', 'scale'],
    ['stylizedSurface', 'patch', 'bias'],
    ['stylizedSurface', 'dirt', 'scale'],
    ['stylizedSurface', 'dirt', 'softness'],
    ['stylizedSurface', 'path', 'blendCells'],
    ['stylizedSurface', 'rocks', 'perChunk'],
    ['stylizedSurface', 'rocks', 'minScale'],
    ['stylizedSurface', 'rocks', 'maxScale'],
    ['stylizedSurface', 'rocks', 'radius'],
    ['stylizedSurface', 'rocks', 'falloff'],
    ['stylizedSurface', 'flowers', 'perChunk'],
    ['stylizedSurface', 'flowers', 'minSize'],
    ['stylizedSurface', 'flowers', 'maxSize'],
    ['stylizedSurface', 'flowers', 'bendFrequency'],
    ['stylizedSurface', 'flowers', 'brightness'],
    ['stylizedSurface', 'trees', 'perChunk'],
    ['stylizedSurface', 'trees', 'clearRadius'],
    ['stylizedSurface', 'trees', 'minScale'],
    ['stylizedSurface', 'trees', 'maxScale'],
    ['stylizedSurface', 'trees', 'brightness'],
    ['stylizedSurface', 'trees', 'gradientPower'],
    ['stylizedSurface', 'trees', 'variationScale'],
    ['stylizedSurface', 'trees', 'flutterSpeed'],
    ['stylizedSurface', 'trees', 'barkScale'],
    ['stylizedSurface', 'trees', 'barkBrightness'],
    ['stylizedSurface', 'water', 'scale'],
    ['stylizedSurface', 'water', 'cellSmoothness'],
    ['stylizedSurface', 'water', 'edgeSoftness'],
    ['stylizedSurface', 'water', 'cellSpeed'],
    ['stylizedSurface', 'water', 'noiseScale'],
    ['stylizedSurface', 'water', 'fadeDistance'],
    ['stylizedSurface', 'water', 'fadeStrength'],
    ['stylizedSurface', 'ground', 'variationScale'],
    ['stylizedSurface', 'ground', 'grainScale'],
    ['stylizedSurface', 'sky', 'radius'],
    ['stylizedSurface', 'sky', 'horizonSpread'],
    ['stylizedSurface', 'sky', 'sunSize'],
    ['stylizedSurface', 'sky', 'sunEdgeSoftness'],
    ['stylizedSurface', 'sky', 'sunEmission'],
    ['stylizedSurface', 'sky', 'sunGlowFalloff'],
    ['stylizedSurface', 'sky', 'cloudScale'],
    ['stylizedSurface', 'sky', 'cloudSharpness'],
    ['stylizedSurface', 'sky', 'cloudRimFalloff'],
    ['stylizedSurface', 'sky', 'ambientIntensity'],
    ['stylizedSurface', 'sky', 'directionalIntensity'],
    ['stylizedSurface', 'sky', 'lightDistance'],
    ['stylizedSurface', 'sky', 'shadowMapSize'],
    ['stylizedSurface', 'sky', 'shadowDistance'],
  ];
  for (const path of positivePaths) assertPositiveNumber(config, path);

  const finitePaths = [
    ['stylizedSurface', 'wind', 'strength'],
    ['stylizedSurface', 'wind', 'turbulence'],
    ['stylizedSurface', 'wind', 'lean'],
    ['stylizedSurface', 'color', 'gradientStart'],
    ['stylizedSurface', 'translucency', 'strength'],
    ['stylizedSurface', 'translucency', 'tipBias'],
    ['stylizedSurface', 'dirt', 'warp'],
    ['stylizedSurface', 'rocks', 'bend'],
    ['stylizedSurface', 'flowers', 'windStrength'],
    ['stylizedSurface', 'flowers', 'windLean'],
    ['stylizedSurface', 'flowers', 'bendAmplitude'],
    ['stylizedSurface', 'trees', 'windStrength'],
    ['stylizedSurface', 'trees', 'flutterAmplitude'],
    ['stylizedSurface', 'trees', 'dip'],
    ['stylizedSurface', 'trees', 'barkRelief'],
    ['stylizedSurface', 'water', 'heightOffset'],
    ['stylizedSurface', 'water', 'edgeThreshold'],
    ['stylizedSurface', 'water', 'flowX'],
    ['stylizedSurface', 'water', 'flowZ'],
    ['stylizedSurface', 'water', 'noiseFlowSpeed'],
    ['stylizedSurface', 'water', 'distortAmount'],
    ['stylizedSurface', 'water', 'midPos'],
    ['stylizedSurface', 'water', 'opacity'],
    ['stylizedSurface', 'water', 'deepOpacity'],
    ['stylizedSurface', 'sky', 'horizonLine'],
    ['stylizedSurface', 'sky', 'sunElevation'],
    ['stylizedSurface', 'sky', 'sunAzimuth'],
    ['stylizedSurface', 'sky', 'sunGlowIntensity'],
    ['stylizedSurface', 'sky', 'cloudSpeed'],
    ['stylizedSurface', 'sky', 'cloudDensity'],
    ['stylizedSurface', 'sky', 'cloudFloor'],
    ['stylizedSurface', 'sky', 'cloudCeiling'],
    ['stylizedSurface', 'sky', 'cloudRimStrength'],
    ['stylizedSurface', 'sky', 'shadowBias'],
    ['stylizedSurface', 'sky', 'shadowNormalBias'],
    ['stylizedSurface', 'sky', 'fogDensity'],
  ];
  for (const path of finitePaths) assertFiniteNumber(config, path);

  assertNonNegativeInteger(config, ['stylizedSurface', 'grass', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'rocks', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'flowers', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'trees', 'residentRadius']);

  if (!Number.isInteger(surface.grass.bladesPerCell)
      || !Number.isInteger(surface.rocks.perChunk)
      || !Number.isInteger(surface.flowers.perChunk)
      || !Number.isInteger(surface.trees.perChunk)) {
    throw new Error('Invalid editor configuration: stylized instance counts must be integers.');
  }
  assertTileIds(surface.grass.tileIds, 'stylizedSurface.grass.tileIds');
  assertTileIds(surface.rocks.tileIds, 'stylizedSurface.rocks.tileIds');
  assertTileIds(surface.flowers.tileIds, 'stylizedSurface.flowers.tileIds');
  assertTileIds(surface.trees.tileIds, 'stylizedSurface.trees.tileIds');
  if (!Number.isInteger(surface.water.tileId) || surface.water.tileId < 0 || surface.water.tileId > 255) {
    throw new Error('Invalid editor configuration: stylizedSurface.water.tileId must be a tile id.');
  }
  if (surface.water.midPos < 0 || surface.water.midPos > 1
      || surface.water.opacity < 0 || surface.water.opacity > 1
      || surface.water.deepOpacity < 0 || surface.water.deepOpacity > 1
      || surface.translucency.tipBias < 0 || surface.translucency.tipBias > 1) {
    throw new Error('Invalid editor configuration: stylized water/translucency blends must be within [0, 1].');
  }
  if (!Array.isArray(surface.wind.direction)
      || surface.wind.direction.length !== 2
      || surface.wind.direction.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid editor configuration: stylizedSurface.wind.direction must be a finite vec2.');
  }
  if (surface.grass.maxWidth < surface.grass.minWidth
      || surface.grass.maxLength < surface.grass.minLength
      || surface.rocks.maxScale < surface.rocks.minScale
      || surface.flowers.maxSize < surface.flowers.minSize
      || surface.trees.maxScale < surface.trees.minScale) {
    throw new Error('Invalid editor configuration: stylized maximum dimensions must cover minimum dimensions.');
  }
  if (surface.color.gradientEnd <= surface.color.gradientStart) {
    throw new Error('Invalid editor configuration: stylized grass gradientEnd must exceed gradientStart.');
  }
  const unitFields = [
    surface.patch.strength,
    surface.dirt.coverage,
    surface.dirt.bladeCut,
    surface.dirt.bladeBlend,
    surface.rocks.flatten,
    surface.flowers.dirtMax,
    surface.trees.variationStrength,
    surface.trees.barkTintStrength,
    surface.trees.barkAoStrength,
    surface.sky.cloudOpacity,
  ];
  if (unitFields.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('Invalid editor configuration: stylized blend strengths must be within [0, 1].');
  }
  if (!Number.isInteger(surface.sky.shadowMapSize)
      || surface.sky.shadowMapSize < 512
      || surface.sky.shadowMapSize > 4096) {
    throw new Error('Invalid editor configuration: stylized sky shadowMapSize must be an integer from 512 to 4096.');
  }
  if (surface.sky.cloudCeiling <= surface.sky.cloudFloor || surface.sky.fogDensity < 0) {
    throw new Error('Invalid editor configuration: stylized sky cloud and fog ranges are invalid.');
  }
  if (surface.streaming) {
    const streaming = surface.streaming;
    if (!Number.isInteger(streaming.grassBuildsPerFrame) || streaming.grassBuildsPerFrame < 1
        || !Number.isInteger(streaming.flowerBuildsPerFrame) || streaming.flowerBuildsPerFrame < 1) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming builds-per-frame must be positive integers.');
    }
    if (streaming.treeBuildsPerFrame !== undefined
        && (!Number.isInteger(streaming.treeBuildsPerFrame) || streaming.treeBuildsPerFrame < 1)) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.treeBuildsPerFrame must be a positive integer.');
    }
    if (streaming.rockBuildsPerFrame !== undefined
        && (!Number.isInteger(streaming.rockBuildsPerFrame) || streaming.rockBuildsPerFrame < 1)) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.rockBuildsPerFrame must be a positive integer.');
    }
    if (!Number.isFinite(streaming.heavyBuildBudgetMs) || streaming.heavyBuildBudgetMs <= 0) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.heavyBuildBudgetMs must be positive.');
    }
  }

  const assetFields = [
    ['stylizedSurface.assets.scene', surface.assets?.scene],
    ['stylizedSurface.assets.rockMaterial', surface.assets?.rockMaterial],
    ['stylizedSurface.assets.trunkMaterial', surface.assets?.trunkMaterial],
    ['stylizedSurface.assets.leafMaterial', surface.assets?.leafMaterial],
    ['stylizedSurface.assets.barkColor', surface.assets?.barkColor],
    ['stylizedSurface.assets.barkAo', surface.assets?.barkAo],
    ['stylizedSurface.assets.barkHeight', surface.assets?.barkHeight],
    ['stylizedSurface.assets.flowerA.mask', surface.assets?.flowerA?.mask],
    ['stylizedSurface.assets.flowerA.zones', surface.assets?.flowerA?.zones],
    ['stylizedSurface.assets.flowerA.gradient', surface.assets?.flowerA?.gradient],
    ['stylizedSurface.assets.flowerB.mask', surface.assets?.flowerB?.mask],
    ['stylizedSurface.assets.flowerB.zones', surface.assets?.flowerB?.zones],
    ['stylizedSurface.assets.flowerB.gradient', surface.assets?.flowerB?.gradient],
  ];
  for (const [fieldName, value] of assetFields) assertAssetString(value, fieldName);
}

export function validateEditorConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid editor configuration: expected a YAML object.');
  }

  for (const path of REQUIRED_POSITIVE_PATHS) assertPositiveNumber(config, path);
  for (const path of REQUIRED_BOOLEAN_PATHS) assertBoolean(config, path);
  assertNonNegativeInteger(config, ['world', 'loadRadius']);
  assertNonNegativeInteger(config, ['world', 'unloadRadius']);

  if (!Number.isSafeInteger(config.world.seed)) {
    throw new Error('Invalid editor configuration: world.seed must be a safe integer.');
  }
  if (!Number.isInteger(config.world.generatorVersion) || config.world.generatorVersion < 1) {
    throw new Error('Invalid editor configuration: world.generatorVersion must be a positive integer.');
  }
  if (!Number.isInteger(config.world.chunkSize)
      || !Number.isInteger(config.world.maxResidentChunks)
      || !Number.isInteger(config.world.maxCpuChunks)
      || !Number.isInteger(config.world.minimapCells)) {
    throw new Error('Invalid editor configuration: world chunk and cache sizes must be integers.');
  }
  if (config.world.loadRadius > config.world.unloadRadius) {
    throw new Error('Invalid editor configuration: world.unloadRadius must cover world.loadRadius.');
  }
  const minimumResidentChunks = (config.world.unloadRadius * 2 + 1) ** 2;
  if (config.world.maxResidentChunks < minimumResidentChunks) {
    throw new Error(`Invalid editor configuration: world.maxResidentChunks must be at least ${minimumResidentChunks} for the unload window.`);
  }
  if (config.world.maxCpuChunks < config.world.maxResidentChunks) {
    throw new Error('Invalid editor configuration: world.maxCpuChunks must cover resident GPU chunks.');
  }
  if (config.world.maxCommitsPerFrame !== undefined
      && (!Number.isInteger(config.world.maxCommitsPerFrame) || config.world.maxCommitsPerFrame < 1)) {
    throw new Error('Invalid editor configuration: world.maxCommitsPerFrame must be a positive integer.');
  }
  if (config.world.commitBudgetMs !== undefined
      && (!Number.isFinite(config.world.commitBudgetMs) || config.world.commitBudgetMs <= 0)) {
    throw new Error('Invalid editor configuration: world.commitBudgetMs must be a positive number.');
  }
  if (config.world.maxCommitsPerFrameIdle !== undefined
      && (!Number.isInteger(config.world.maxCommitsPerFrameIdle)
        || config.world.maxCommitsPerFrameIdle < 1)) {
    throw new Error('Invalid editor configuration: world.maxCommitsPerFrameIdle must be a positive integer.');
  }
  if (config.world.workerCount !== undefined
      && (!Number.isInteger(config.world.workerCount) || config.world.workerCount < 1)) {
    throw new Error('Invalid editor configuration: world.workerCount must be a positive integer.');
  }
  if (!Number.isFinite(config.world.seaLevel)) {
    throw new Error('Invalid editor configuration: world.seaLevel must be finite.');
  }

  if (config.world.farTerrain !== undefined) {
    const far = config.world.farTerrain;
    if (typeof far !== 'object' || far === null || Array.isArray(far)) {
      throw new Error('Invalid editor configuration: world.farTerrain must be an object.');
    }
    if (far.enabled !== undefined && typeof far.enabled !== 'boolean') {
      throw new Error('Invalid editor configuration: world.farTerrain.enabled must be boolean.');
    }
    if (far.radiusMeters !== undefined
        && (!Number.isFinite(far.radiusMeters) || far.radiusMeters <= 0)) {
      throw new Error('Invalid editor configuration: world.farTerrain.radiusMeters must be positive.');
    }
    if (far.resolution !== undefined
        && (!Number.isInteger(far.resolution) || far.resolution < 2)) {
      throw new Error('Invalid editor configuration: world.farTerrain.resolution must be an integer >= 2.');
    }
    if (far.heightBias !== undefined && !Number.isFinite(far.heightBias)) {
      throw new Error('Invalid editor configuration: world.farTerrain.heightBias must be finite.');
    }
    for (const name of ['radialResolution', 'angularResolution', 'rebuildRowsPerFrame']) {
      if (far[name] !== undefined && (!Number.isInteger(far[name]) || far[name] < 2)) {
        throw new Error(`Invalid editor configuration: world.farTerrain.${name} must be an integer >= 2.`);
      }
    }
    for (const name of ['innerRadiusMeters', 'radialFalloff', 'snowFade', 'snowSlopeMax']) {
      if (far[name] !== undefined && (!Number.isFinite(far[name]) || far[name] <= 0)) {
        throw new Error(`Invalid editor configuration: world.farTerrain.${name} must be positive.`);
      }
    }
    if (far.innerRadiusMeters !== undefined && far.radiusMeters !== undefined
        && far.innerRadiusMeters >= far.radiusMeters) {
      throw new Error('Invalid editor configuration: world.farTerrain.innerRadiusMeters must be inside radiusMeters.');
    }
    if (far.rockSlopeStart !== undefined && far.rockSlopeFull !== undefined
        && far.rockSlopeFull <= far.rockSlopeStart) {
      throw new Error('Invalid editor configuration: world.farTerrain.rockSlopeFull must exceed rockSlopeStart.');
    }
  }

  if (config.import.azgaarVerticalExaggeration !== undefined
      && (!Number.isFinite(config.import.azgaarVerticalExaggeration)
        || config.import.azgaarVerticalExaggeration <= 0)) {
    throw new Error('Invalid editor configuration: import.azgaarVerticalExaggeration must be positive.');
  }
  if (config.import.azgaarReliefExponent !== undefined
      && (!Number.isFinite(config.import.azgaarReliefExponent)
        || config.import.azgaarReliefExponent <= 0)) {
    throw new Error('Invalid editor configuration: import.azgaarReliefExponent must be positive.');
  }

  if (config.player.fovDegrees >= 180) {
    throw new Error('Invalid editor configuration: player.fovDegrees must be below 180.');
  }
  if (!Number.isFinite(config.player.maxPitchDegrees)
      || config.player.maxPitchDegrees <= 0
      || config.player.maxPitchDegrees >= 90) {
    throw new Error('Invalid editor configuration: player.maxPitchDegrees must be within (0, 90).');
  }

  if (!Number.isFinite(config.terrain?.minHeight) || !Number.isFinite(config.terrain?.maxHeight)) {
    throw new Error('Invalid editor configuration: terrain height limits must be finite.');
  }
  if (config.terrain.maxHeight <= config.terrain.minHeight) {
    throw new Error('Invalid editor configuration: terrain.maxHeight must exceed terrain.minHeight.');
  }
  if (!Number.isFinite(config.terrain.smoothFactor)
      || config.terrain.smoothFactor <= 0
      || config.terrain.smoothFactor > 1) {
    throw new Error('Invalid editor configuration: terrain.smoothFactor must be within (0, 1].');
  }

  if (!Array.isArray(config.brush?.sizes) || config.brush.sizes.length === 0) {
    throw new Error('Invalid editor configuration: brush.sizes must not be empty.');
  }
  if (config.brush.sizes.some((size) => !Number.isInteger(size) || size <= 0)) {
    throw new Error('Invalid editor configuration: brush.sizes must contain positive integers.');
  }
  if (!config.brush.sizes.includes(config.brush.defaultSize)) {
    throw new Error('Invalid editor configuration: brush.defaultSize must be listed in brush.sizes.');
  }

  validateStylizedSurface(config);
  if (config.simulation !== undefined) {
    validateSimulationConfig(config.simulation);
  }
  return config;
}
