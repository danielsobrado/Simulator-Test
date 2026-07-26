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

const POWER_PREFERENCES = Object.freeze(['high-performance', 'low-power']);

/** Optional: omitting it leaves the choice to the browser. */
function assertPowerPreference(config) {
  const value = config.renderer?.powerPreference;
  if (value === undefined) return;
  if (!POWER_PREFERENCES.includes(value)) {
    throw new Error(
      `Invalid editor configuration: renderer.powerPreference must be one of ${POWER_PREFERENCES.join(', ')}.`,
    );
  }
}

/** Optional: omitting it falls back to parity with the workshop preview. */
function assertToneMappingExposure(config) {
  const value = config.renderer?.toneMappingExposure;
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0 || value > 4) {
    throw new Error(
      'Invalid editor configuration: renderer.toneMappingExposure must be a finite number in (0, 4].',
    );
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

const REGIONAL_CHARACTER_CHANNELS = new Set(['meadow', 'forest', 'scrub', 'rocky']);
const CANOPY_PREFERENCES = new Set(['any', 'core', 'edge', 'open']);

/**
 * Optional placement steering shared by every scatter variant: which biomes it
 * may appear in, which regional district favours it, and whether it belongs
 * under canopy or in the open. All three are absent by default, which leaves the
 * variant eligible everywhere its layer is.
 */
function assertVariantPlacementSteering(variant, path) {
  if (variant.tileIds !== undefined) {
    assertTileIds(variant.tileIds, `${path}.tileIds`);
  }
  if (variant.character !== undefined
      && !REGIONAL_CHARACTER_CHANNELS.has(variant.character)) {
    throw new Error(
      `Invalid editor configuration: ${path}.character must be one of `
      + `${[...REGIONAL_CHARACTER_CHANNELS].join(', ')}.`,
    );
  }
  if (variant.characterStrength !== undefined
      && (!Number.isFinite(variant.characterStrength) || variant.characterStrength <= 0)) {
    throw new Error(
      `Invalid editor configuration: ${path}.characterStrength must be positive.`,
    );
  }
  if (variant.character === undefined && variant.characterStrength !== undefined) {
    throw new Error(
      `Invalid editor configuration: ${path}.characterStrength needs a character channel.`,
    );
  }
  if (variant.canopy !== undefined && !CANOPY_PREFERENCES.has(variant.canopy)) {
    throw new Error(
      `Invalid editor configuration: ${path}.canopy must be one of `
      + `${[...CANOPY_PREFERENCES].join(', ')}.`,
    );
  }
}

function assertPrototypeGroups(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid editor configuration: ${fieldName} must be a non-empty array.`);
  }
  value.forEach((group, groupIndex) => {
    if (!Array.isArray(group)
        || group.length === 0
        || group.some((name) => typeof name !== 'string' || name.trim().length === 0)) {
      throw new Error(
        `Invalid editor configuration: ${fieldName}[${groupIndex}] must contain node names.`,
      );
    }
  });
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
  assertBoolean(config, ['stylizedSurface', 'groundDetails', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'aquaticPlants', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'wildlife', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'wildlife', 'distant', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'wildlife', 'authored', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'sky', 'enabled']);
  assertBoolean(config, ['stylizedSurface', 'sky', 'shadows']);
  assertBoolean(config, ['stylizedSurface', 'sky', 'godRays', 'enabled']);
  const godRaysTechnique = surface.sky.godRays.technique;
  if (!['screen-space', 'volumetric'].includes(godRaysTechnique)) {
    throw new Error(
      'Invalid editor configuration: stylizedSurface.sky.godRays.technique must be screen-space or volumetric.',
    );
  }
  assertBoolean(config, ['stylizedSurface', 'path', 'naturalTrail', 'enabled']);

  const positivePaths = [
    ['stylizedSurface', 'grass', 'bladesPerCell'],
    ['stylizedSurface', 'grass', 'minWidth'],
    ['stylizedSurface', 'grass', 'maxWidth'],
    ['stylizedSurface', 'grass', 'minLength'],
    ['stylizedSurface', 'grass', 'maxLength'],
    ['stylizedSurface', 'grass', 'tiltMax'],
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
    ['stylizedSurface', 'path', 'edgeScale'],
    ['stylizedSurface', 'path', 'naturalTrail', 'scale'],
    ['stylizedSurface', 'path', 'naturalTrail', 'width'],
    ['stylizedSurface', 'path', 'naturalTrail', 'softness'],
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
    ['stylizedSurface', 'groundDetails', 'perChunk'],
    ['stylizedSurface', 'groundDetails', 'minScale'],
    ['stylizedSurface', 'groundDetails', 'maxScale'],
    ['stylizedSurface', 'groundDetails', 'radius'],
    ['stylizedSurface', 'aquaticPlants', 'perChunk'],
    ['stylizedSurface', 'aquaticPlants', 'minScale'],
    ['stylizedSurface', 'aquaticPlants', 'maxScale'],
    ['stylizedSurface', 'aquaticPlants', 'radius'],
    ['stylizedSurface', 'wildlife', 'distant', 'maxBirds'],
    ['stylizedSurface', 'wildlife', 'distant', 'flockSizeMin'],
    ['stylizedSurface', 'wildlife', 'distant', 'flockSizeMax'],
    ['stylizedSurface', 'wildlife', 'distant', 'initialDelayMin'],
    ['stylizedSurface', 'wildlife', 'distant', 'initialDelayMax'],
    ['stylizedSurface', 'wildlife', 'distant', 'intervalMin'],
    ['stylizedSurface', 'wildlife', 'distant', 'intervalMax'],
    ['stylizedSurface', 'wildlife', 'distant', 'durationMin'],
    ['stylizedSurface', 'wildlife', 'distant', 'durationMax'],
    ['stylizedSurface', 'wildlife', 'distant', 'radiusMin'],
    ['stylizedSurface', 'wildlife', 'distant', 'radiusMax'],
    ['stylizedSurface', 'wildlife', 'distant', 'altitudeMin'],
    ['stylizedSurface', 'wildlife', 'distant', 'altitudeMax'],
    ['stylizedSurface', 'wildlife', 'distant', 'size'],
    ['stylizedSurface', 'wildlife', 'authored', 'maxActive'],
    ['stylizedSurface', 'wildlife', 'authored', 'habitatSearchCells'],
    ['stylizedSurface', 'wildlife', 'authored', 'initialDelayMin'],
    ['stylizedSurface', 'wildlife', 'authored', 'initialDelayMax'],
    ['stylizedSurface', 'wildlife', 'authored', 'intervalMin'],
    ['stylizedSurface', 'wildlife', 'authored', 'intervalMax'],
    ['stylizedSurface', 'wildlife', 'authored', 'durationMin'],
    ['stylizedSurface', 'wildlife', 'authored', 'durationMax'],
    ['stylizedSurface', 'wildlife', 'authored', 'radiusMin'],
    ['stylizedSurface', 'wildlife', 'authored', 'radiusMax'],
    ['stylizedSurface', 'wildlife', 'authored', 'altitudeMin'],
    ['stylizedSurface', 'wildlife', 'authored', 'altitudeMax'],
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
    ['stylizedSurface', 'sky', 'godRays', 'resolutionScale'],
    ['stylizedSurface', 'sky', 'godRays', 'density'],
    ['stylizedSurface', 'sky', 'godRays', 'weight'],
    ['stylizedSurface', 'sky', 'godRays', 'exposure'],
    ['stylizedSurface', 'sky', 'godRays', 'dustScale'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'resolutionScale'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'density'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'maxDensity'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'distanceAttenuation'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'fogDensity'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'fogHeightFalloff'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'fogMaxDistance'],
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
    ['stylizedSurface', 'path', 'edgeWarp'],
    ['stylizedSurface', 'path', 'naturalTrail', 'level'],
    ['stylizedSurface', 'path', 'naturalTrail', 'warp'],
    ['stylizedSurface', 'rocks', 'bend'],
    ['stylizedSurface', 'flowers', 'windStrength'],
    ['stylizedSurface', 'flowers', 'windLean'],
    ['stylizedSurface', 'flowers', 'bendAmplitude'],
    ['stylizedSurface', 'trees', 'windStrength'],
    ['stylizedSurface', 'trees', 'flutterAmplitude'],
    ['stylizedSurface', 'trees', 'dip'],
    ['stylizedSurface', 'trees', 'barkRelief'],
    ['stylizedSurface', 'groundDetails', 'heightOffset'],
    ['stylizedSurface', 'aquaticPlants', 'heightOffset'],
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
    ['stylizedSurface', 'sky', 'shadowRadius'],
    ['stylizedSurface', 'sky', 'fogDensity'],
    ['stylizedSurface', 'sky', 'godRays', 'intensity'],
    ['stylizedSurface', 'sky', 'godRays', 'decay'],
    ['stylizedSurface', 'sky', 'godRays', 'dustStrength'],
    ['stylizedSurface', 'sky', 'godRays', 'dustSpeed'],
    ['stylizedSurface', 'sky', 'godRays', 'cloudOcclusion'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'intensity'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'blurSoftness'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'cloudInfluence'],
    ['stylizedSurface', 'sky', 'godRays', 'volumetric', 'fogBaseHeight'],
  ];
  for (const path of finitePaths) assertFiniteNumber(config, path);

  assertNonNegativeInteger(config, ['stylizedSurface', 'grass', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'rocks', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'flowers', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'trees', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'groundDetails', 'residentRadius']);
  assertNonNegativeInteger(config, ['stylizedSurface', 'aquaticPlants', 'residentRadius']);

  if (!Number.isInteger(surface.grass.bladesPerCell)
      || !Number.isInteger(surface.rocks.perChunk)
      || !Number.isInteger(surface.flowers.perChunk)
      || !Number.isInteger(surface.trees.perChunk)
      || !Number.isInteger(surface.groundDetails.perChunk)
      || !Number.isInteger(surface.aquaticPlants.perChunk)) {
    throw new Error('Invalid editor configuration: stylized instance counts must be integers.');
  }
  const distantWildlife = surface.wildlife.distant;
  const authoredWildlife = surface.wildlife.authored;
  for (const [path, value] of [
    ['stylizedSurface.wildlife.distant.maxBirds', distantWildlife.maxBirds],
    ['stylizedSurface.wildlife.distant.flockSizeMin', distantWildlife.flockSizeMin],
    ['stylizedSurface.wildlife.distant.flockSizeMax', distantWildlife.flockSizeMax],
    ['stylizedSurface.wildlife.authored.maxActive', authoredWildlife.maxActive],
    ['stylizedSurface.wildlife.authored.habitatSearchCells', authoredWildlife.habitatSearchCells],
  ]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Invalid editor configuration: ${path} must be a positive integer.`);
    }
  }
  if (distantWildlife.flockSizeMax < distantWildlife.flockSizeMin
      || distantWildlife.flockSizeMax > distantWildlife.maxBirds
      || distantWildlife.initialDelayMax < distantWildlife.initialDelayMin
      || distantWildlife.intervalMax < distantWildlife.intervalMin
      || distantWildlife.durationMax < distantWildlife.durationMin
      || distantWildlife.radiusMax < distantWildlife.radiusMin
      || distantWildlife.altitudeMax < distantWildlife.altitudeMin
      || authoredWildlife.initialDelayMax < authoredWildlife.initialDelayMin
      || authoredWildlife.intervalMax < authoredWildlife.intervalMin
      || authoredWildlife.durationMax < authoredWildlife.durationMin
      || authoredWildlife.radiusMax < authoredWildlife.radiusMin
      || authoredWildlife.altitudeMax < authoredWildlife.altitudeMin) {
    throw new Error('Invalid editor configuration: stylized wildlife maximums must cover minimums.');
  }
  assertAssetString(
    distantWildlife.color,
    'stylizedSurface.wildlife.distant.color',
  );
  assertTileIds(surface.grass.tileIds, 'stylizedSurface.grass.tileIds');
  assertTileIds(surface.rocks.tileIds, 'stylizedSurface.rocks.tileIds');
  assertTileIds(surface.flowers.tileIds, 'stylizedSurface.flowers.tileIds');
  assertTileIds(surface.trees.tileIds, 'stylizedSurface.trees.tileIds');
  assertTileIds(surface.groundDetails.tileIds, 'stylizedSurface.groundDetails.tileIds');
  assertTileIds(surface.aquaticPlants.tileIds, 'stylizedSurface.aquaticPlants.tileIds');
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
      || surface.trees.maxScale < surface.trees.minScale
      || surface.groundDetails.maxScale < surface.groundDetails.minScale
      || surface.aquaticPlants.maxScale < surface.aquaticPlants.minScale) {
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
    surface.path.vergeWidth,
    surface.path.vergeBlend,
    surface.path.vergeCut,
    surface.path.naturalTrail.clearThreshold,
    surface.rocks.flatten,
    surface.flowers.dirtMax,
    surface.trees.variationStrength,
    surface.trees.barkTintStrength,
    surface.trees.barkAoStrength,
    surface.groundDetails.colorVariation,
    surface.aquaticPlants.colorVariation,
    surface.sky.cloudOpacity,
    surface.sky.godRays.decay,
    surface.sky.godRays.dustStrength,
    surface.sky.godRays.cloudOcclusion,
    surface.sky.godRays.volumetric.cloudInfluence,
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
  const godRays = surface.sky.godRays;
  if (!Number.isInteger(godRays.samples) || godRays.samples < 1 || godRays.samples > 64) {
    throw new Error(
      'Invalid editor configuration: stylizedSurface.sky.godRays.samples must be an integer from 1 to 64.',
    );
  }
  if (godRays.resolutionScale > 1) {
    throw new Error(
      'Invalid editor configuration: stylizedSurface.sky.godRays.resolutionScale must be within (0, 1].',
    );
  }
  const volumetric = godRays.volumetric;
  if (!Number.isInteger(volumetric.raymarchSteps)
      || volumetric.raymarchSteps < 8
      || volumetric.raymarchSteps > 128) {
    throw new Error(
      'Invalid editor configuration: stylizedSurface.sky.godRays.volumetric.raymarchSteps must be an integer from 8 to 128.',
    );
  }
  if (volumetric.resolutionScale > 1 || volumetric.maxDensity > 1) {
    throw new Error(
      'Invalid editor configuration: volumetric resolutionScale and maxDensity must be within (0, 1].',
    );
  }
  if (volumetric.intensity < 0 || volumetric.blurSoftness < 0) {
    throw new Error(
      'Invalid editor configuration: volumetric intensity and blurSoftness must be non-negative.',
    );
  }
  if (godRays.intensity < 0 || godRays.dustSpeed < 0) {
    throw new Error(
      'Invalid editor configuration: stylizedSurface.sky.godRays intensity and dustSpeed must be non-negative.',
    );
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
    if (streaming.detailBuildsPerFrame !== undefined
        && (!Number.isInteger(streaming.detailBuildsPerFrame)
          || streaming.detailBuildsPerFrame < 1)) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.detailBuildsPerFrame must be a positive integer.');
    }
    if (!Number.isFinite(streaming.heavyBuildBudgetMs) || streaming.heavyBuildBudgetMs <= 0) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.heavyBuildBudgetMs must be positive.');
    }
    if (streaming.variantPrefetchChunks !== undefined
        && (!Number.isInteger(streaming.variantPrefetchChunks)
          || streaming.variantPrefetchChunks < 0)) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.variantPrefetchChunks must be a non-negative integer.');
    }
    if (streaming.variantAppliesPerFrame !== undefined
        && (!Number.isInteger(streaming.variantAppliesPerFrame)
          || streaming.variantAppliesPerFrame < 1)) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.variantAppliesPerFrame must be a positive integer.');
    }
    if (streaming.variantRescanIntervalMs !== undefined
        && (!Number.isFinite(streaming.variantRescanIntervalMs)
          || streaming.variantRescanIntervalMs < 0)) {
      throw new Error('Invalid editor configuration: stylizedSurface.streaming.variantRescanIntervalMs must be non-negative.');
    }
  }

  const assetFields = [
    ['stylizedSurface.assets.scene', surface.assets?.scene],
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

  for (const variantKind of ['rockVariants', 'bushVariants']) {
    const variants = surface.assets?.[variantKind] ?? [];
    const collectionPath = `stylizedSurface.assets.${variantKind}`;
    if (!Array.isArray(variants) || variants.length === 0) {
      throw new Error(`Invalid editor configuration: ${collectionPath} must be a non-empty array.`);
    }
    variants.forEach((variant, index) => {
      const path = `${collectionPath}[${index}]`;
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
        throw new Error(`Invalid editor configuration: ${path} must be an object.`);
      }
      assertAssetString(variant.scene, `${path}.scene`);
      if (!Number.isFinite(variant.scale) || variant.scale <= 0) {
        throw new Error(`Invalid editor configuration: ${path}.scale must be positive.`);
      }
      if (variant.rootNames !== undefined) {
        if (!Array.isArray(variant.rootNames)
            || variant.rootNames.length === 0
            || variant.rootNames.some(
              (name) => typeof name !== 'string' || name.trim().length === 0,
            )) {
          throw new Error(
            `Invalid editor configuration: ${path}.rootNames must contain node names.`,
          );
        }
      }
      if (variant.weight !== undefined
          && (!Number.isFinite(variant.weight) || variant.weight <= 0)) {
        throw new Error(`Invalid editor configuration: ${path}.weight must be positive.`);
      }
      assertVariantPlacementSteering(variant, path);
    });
  }

  const treeVariants = surface.assets?.treeVariants ?? [];
  if (!Array.isArray(treeVariants)) {
    throw new Error(
      'Invalid editor configuration: stylizedSurface.assets.treeVariants must be an array.',
    );
  }
  treeVariants.forEach((variant, index) => {
    const path = `stylizedSurface.assets.treeVariants[${index}]`;
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
      throw new Error(`Invalid editor configuration: ${path} must be an object.`);
    }
    for (const field of ['scene', 'trunkMaterial', 'leafMaterial']) {
      assertAssetString(variant[field], `${path}.${field}`);
    }
    // A single crown may serve several species; they are distinguished by the
    // species registry's proportions and by biome hue, not by geometry.
    if (Array.isArray(variant.species)) {
      if (variant.species.length === 0) {
        throw new Error(`Invalid editor configuration: ${path}.species is required.`);
      }
      variant.species.forEach((speciesId, speciesIndex) => {
        assertAssetString(speciesId, `${path}.species[${speciesIndex}]`);
      });
    } else {
      assertAssetString(variant.species, `${path}.species`);
    }
    if (!Number.isFinite(variant.scale) || variant.scale <= 0) {
      throw new Error(`Invalid editor configuration: ${path}.scale must be positive.`);
    }
    if (variant.barkProfile !== undefined) {
      const barkProfiles = new Set([
        'spruce',
        'pine',
        'beech',
        'birch',
        'karst_gnarl',
        'snag',
      ]);
      if (!barkProfiles.has(variant.barkProfile)) {
        throw new Error(`Invalid editor configuration: ${path}.barkProfile is unsupported.`);
      }
    }
    if (
      variant.barkScale !== undefined
      && (!Number.isFinite(variant.barkScale) || variant.barkScale <= 0)
    ) {
      throw new Error(`Invalid editor configuration: ${path}.barkScale must be positive.`);
    }
    if (variant.barkSeed !== undefined && !Number.isSafeInteger(variant.barkSeed)) {
      throw new Error(`Invalid editor configuration: ${path}.barkSeed must be a safe integer.`);
    }
    if (variant.prototypeGroups !== undefined) {
      assertPrototypeGroups(variant.prototypeGroups, `${path}.prototypeGroups`);
    }
    // Trees pick their prototype through the species registry, so only the biome
    // gate applies here; regional character and canopy are already expressed by
    // the forest habitat field that placed the tree.
    if (variant.tileIds !== undefined) {
      assertTileIds(variant.tileIds, `${path}.tileIds`);
    }
  });

  const wildlifeVariants = surface.assets?.wildlifeVariants ?? [];
  if (!Array.isArray(wildlifeVariants)
      || (surface.wildlife.authored.enabled && wildlifeVariants.length === 0)) {
    throw new Error(
      'Invalid editor configuration: stylizedSurface.assets.wildlifeVariants '
      + 'must be a non-empty array when authored wildlife is enabled.',
    );
  }
  const wildlifeIds = new Set();
  wildlifeVariants.forEach((variant, index) => {
    const path = `stylizedSurface.assets.wildlifeVariants[${index}]`;
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
      throw new Error(`Invalid editor configuration: ${path} must be an object.`);
    }
    for (const field of ['id', 'scene', 'clip']) {
      assertAssetString(variant[field], `${path}.${field}`);
    }
    if (wildlifeIds.has(variant.id)) {
      throw new Error(`Invalid editor configuration: duplicate wildlife id "${variant.id}".`);
    }
    wildlifeIds.add(variant.id);
    for (const field of ['scale', 'weight', 'animationTimeScale']) {
      if (!Number.isFinite(variant[field]) || variant[field] <= 0) {
        throw new Error(`Invalid editor configuration: ${path}.${field} must be positive.`);
      }
    }
    if (!Number.isFinite(variant.headingOffsetDegrees)) {
      throw new Error(
        `Invalid editor configuration: ${path}.headingOffsetDegrees must be finite.`,
      );
    }
    if (!Number.isInteger(variant.maxActive) || variant.maxActive < 1) {
      throw new Error(
        `Invalid editor configuration: ${path}.maxActive must be a positive integer.`,
      );
    }
    assertTileIds(variant.tileIds, `${path}.tileIds`);
  });

  for (const [layerName, variantsName] of [
    ['groundDetails', 'groundDetailVariants'],
    ['aquaticPlants', 'aquaticVariants'],
  ]) {
    const variants = surface.assets?.[variantsName] ?? [];
    const collectionPath = `stylizedSurface.assets.${variantsName}`;
    if (!Array.isArray(variants) || (surface[layerName].enabled && variants.length === 0)) {
      throw new Error(
        `Invalid editor configuration: ${collectionPath} must be a non-empty array when ${layerName} are enabled.`,
      );
    }
    variants.forEach((variant, index) => {
      const path = `${collectionPath}[${index}]`;
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
        throw new Error(`Invalid editor configuration: ${path} must be an object.`);
      }
      assertAssetString(variant.scene, `${path}.scene`);
      if (!Number.isFinite(variant.scale) || variant.scale <= 0) {
        throw new Error(`Invalid editor configuration: ${path}.scale must be positive.`);
      }
      assertPrototypeGroups(variant.prototypeGroups, `${path}.prototypeGroups`);
      assertVariantPlacementSteering(variant, path);
      if (variant.weight !== undefined
          && (!Number.isFinite(variant.weight) || variant.weight <= 0)) {
        throw new Error(`Invalid editor configuration: ${path}.weight must be positive.`);
      }
      if (variant.prototypeWeights !== undefined) {
        if (!Array.isArray(variant.prototypeWeights)
            || variant.prototypeWeights.length !== variant.prototypeGroups.length
            || variant.prototypeWeights.some(
              (weight) => !Number.isFinite(weight) || weight <= 0,
            )) {
          throw new Error(
            `Invalid editor configuration: ${path}.prototypeWeights must contain one positive weight per prototype group.`,
          );
        }
      }
      if (variant.heightOffset !== undefined && !Number.isFinite(variant.heightOffset)) {
        throw new Error(`Invalid editor configuration: ${path}.heightOffset must be finite.`);
      }
      if (variant.prototypeHeightOffsets !== undefined) {
        if (!Array.isArray(variant.prototypeHeightOffsets)
            || variant.prototypeHeightOffsets.length !== variant.prototypeGroups.length
            || variant.prototypeHeightOffsets.some((height) => !Number.isFinite(height))) {
          throw new Error(
            `Invalid editor configuration: ${path}.prototypeHeightOffsets must contain one finite height per prototype group.`,
          );
        }
      }
      const placements = variant.prototypePlacements ?? (
        variant.placement === undefined ? [] : [variant.placement]
      );
      if (variant.prototypePlacements !== undefined
          && (!Array.isArray(variant.prototypePlacements)
            || variant.prototypePlacements.length !== variant.prototypeGroups.length)) {
        throw new Error(
          `Invalid editor configuration: ${path}.prototypePlacements must contain one rule per prototype group.`,
        );
      }
      placements.forEach((placement, placementIndex) => {
        const placementPath = variant.prototypePlacements === undefined
          ? `${path}.placement`
          : `${path}.prototypePlacements[${placementIndex}]`;
        if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
          throw new Error(`Invalid editor configuration: ${placementPath} must be an object.`);
        }
        if (placement.strategy !== 'shoreline-colonies') {
          throw new Error(
            `Invalid editor configuration: ${placementPath}.strategy must be shoreline-colonies.`,
          );
        }
        for (const field of ['supercellSize', 'radius']) {
          if (!Number.isFinite(placement[field]) || placement[field] <= 0) {
            throw new Error(
              `Invalid editor configuration: ${placementPath}.${field} must be positive.`,
            );
          }
        }
        if (!Number.isFinite(placement.probability)
            || placement.probability <= 0
            || placement.probability > 1) {
          throw new Error(
            `Invalid editor configuration: ${placementPath}.probability must be within (0, 1].`,
          );
        }
        if (!Number.isSafeInteger(placement.seed)) {
          throw new Error(
            `Invalid editor configuration: ${placementPath}.seed must be a safe integer.`,
          );
        }
        if (!Number.isInteger(placement.shorelineCells) || placement.shorelineCells < 0) {
          throw new Error(
            `Invalid editor configuration: ${placementPath}.shorelineCells must be a non-negative integer.`,
          );
        }
        assertTileIds(placement.openWaterTileIds, `${placementPath}.openWaterTileIds`);
      });
    });
    if (typeof surface[layerName].castShadow !== 'boolean') {
      throw new Error(
        `Invalid editor configuration: stylizedSurface.${layerName}.castShadow must be boolean.`,
      );
    }
    const densityByTile = surface[layerName].densityByTile;
    if (densityByTile !== undefined) {
      const densityPath = `stylizedSurface.${layerName}.densityByTile`;
      if (!densityByTile || typeof densityByTile !== 'object' || Array.isArray(densityByTile)) {
        throw new Error(`Invalid editor configuration: ${densityPath} must be an object.`);
      }
      for (const [rawTileId, density] of Object.entries(densityByTile)) {
        const tileId = Number(rawTileId);
        if (!Number.isInteger(tileId) || tileId < 0 || tileId > 255) {
          throw new Error(
            `Invalid editor configuration: ${densityPath} keys must be unsigned-byte tile ids.`,
          );
        }
        if (!Number.isFinite(density) || density <= 0 || density > 1) {
          throw new Error(
            `Invalid editor configuration: ${densityPath}.${rawTileId} must be within (0, 1].`,
          );
        }
      }
    }
  }
}

export function validateEditorConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid editor configuration: expected a YAML object.');
  }

  for (const path of REQUIRED_POSITIVE_PATHS) assertPositiveNumber(config, path);
  for (const path of REQUIRED_BOOLEAN_PATHS) assertBoolean(config, path);
  assertPowerPreference(config);
  assertToneMappingExposure(config);
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

  const objectLod = config.objects?.lod;
  if (objectLod !== undefined) {
    if (typeof objectLod.enabled !== 'boolean') {
      throw new Error('Invalid editor configuration: objects.lod.enabled must be boolean.');
    }
    for (const name of ['nearPixels', 'coarsePixels', 'transitionMs', 'fadeSteps']) {
      if (!Number.isFinite(objectLod[name]) || objectLod[name] <= 0) {
        throw new Error(`Invalid editor configuration: objects.lod.${name} must be positive.`);
      }
    }
    if (objectLod.nearPixels <= objectLod.coarsePixels) {
      throw new Error('Invalid editor configuration: objects.lod.nearPixels must exceed coarsePixels.');
    }
    if (!Number.isFinite(objectLod.hysteresisRatio)
        || objectLod.hysteresisRatio < 0 || objectLod.hysteresisRatio >= 1) {
      throw new Error(
        'Invalid editor configuration: objects.lod.hysteresisRatio must be within [0, 1).',
      );
    }
    if (!Number.isInteger(objectLod.fadeSteps)) {
      throw new Error('Invalid editor configuration: objects.lod.fadeSteps must be an integer.');
    }
    for (const band of ['near', 'coarse', 'shell']) {
      if (typeof objectLod[band]?.castShadow !== 'boolean') {
        throw new Error(
          `Invalid editor configuration: objects.lod.${band}.castShadow must be boolean.`,
        );
      }
    }
  }

  validateStylizedSurface(config);
  if (config.simulation !== undefined) {
    validateSimulationConfig(config.simulation);
  }
  return config;
}
