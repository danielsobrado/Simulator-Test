import { REGIONAL_CHARACTER_CHANNELS } from '../editor/stylized/RegionalCharacterField.js';
import { resolveRockWeathering } from '../editor/stylized/rockWeathering.js';
import { resolveContactShade } from '../editor/stylized/contactShade.js';
import { resolveBlownStreaks } from '../editor/stylized/ambient/BlownStreaks.js';
import { resolveFrost } from '../editor/stylized/ambient/FrostShading.js';
import { resolveValleyFogConfig } from '../editor/stylized/mist/valleyFogConfig.js';
import { resolveMeadowGrassConfig } from '../editor/stylized/meadow/meadowGrassConfig.js';
import { resolveCinematicFinish } from '../editor/stylized/cinematicFinish.js';
import { resolveSnowSurfaceConfig } from '../editor/stylized/SnowSurfaceConfig.js';

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid editor configuration: ${path} must be boolean.`);
  }
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid editor configuration: ${path} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid editor configuration: ${path} must be a positive integer.`);
  }
}

function assertPositive(value, path) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid editor configuration: ${path} must be positive.`);
  }
}

function assertNonNegative(value, path) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid editor configuration: ${path} must not be negative.`);
  }
}

function assertFinite(value, path) {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid editor configuration: ${path} must be finite.`);
  }
}

function assertUnitInterval(value, path, allowZero = true) {
  const minimum = allowZero ? 0 : Number.EPSILON;
  if (!Number.isFinite(value) || value < minimum || value > 1) {
    throw new Error(`Invalid editor configuration: ${path} must be within ${allowZero ? '[0, 1]' : '(0, 1]'}.`);
  }
}

function validateTreeBand(tree) {
  for (const [name, value] of [
    ['meshRadius', tree.meshRadius],
    ['proxyRadius', tree.proxyRadius],
    ['impostorRadius', tree.impostorRadius],
    ['clusterRadius', tree.clusterRadius],
  ]) {
    assertNonNegativeInteger(value, `stylizedSurface.lod.tree.${name}`);
  }
  if (!(tree.meshRadius <= tree.proxyRadius
      && tree.proxyRadius <= tree.impostorRadius
      && tree.impostorRadius <= tree.clusterRadius)) {
    throw new Error('Invalid editor configuration: tree LOD radii must ascend mesh <= proxy <= impostor <= cluster.');
  }
  for (const [name, value] of [
    ['nearPixels', tree.nearPixels],
    ['proxyPixels', tree.proxyPixels],
    ['impostorPixels', tree.impostorPixels],
    ['transitionMs', tree.transitionMs],
  ]) {
    assertPositive(value, `stylizedSurface.lod.tree.${name}`);
  }
  // Zero disables the aggregate canopy band rather than matching every tree, so
  // this threshold alone is allowed down to zero.
  assertNonNegative(tree.clusterPixels, 'stylizedSurface.lod.tree.clusterPixels');
  if (!(tree.nearPixels > tree.proxyPixels
      && tree.proxyPixels > tree.impostorPixels
      && tree.impostorPixels > tree.clusterPixels)) {
    throw new Error('Invalid editor configuration: tree projected thresholds must descend near > proxy > impostor > cluster.');
  }
  assertUnitInterval(tree.hysteresisRatio, 'stylizedSurface.lod.tree.hysteresisRatio');
}

function validateRockBand(rock) {
  assertNonNegativeInteger(rock.meshRadius, 'stylizedSurface.lod.rock.meshRadius');
  assertNonNegativeInteger(rock.proxyRadius, 'stylizedSurface.lod.rock.proxyRadius');
  if (rock.proxyRadius < rock.meshRadius) {
    throw new Error('Invalid editor configuration: rock proxyRadius must cover meshRadius.');
  }
  for (const [name, value] of [
    ['nearPixels', rock.nearPixels],
    ['proxyPixels', rock.proxyPixels],
    ['impostorPixels', rock.impostorPixels],
    ['clusterPixels', rock.clusterPixels],
    ['transitionMs', rock.transitionMs],
  ]) {
    assertPositive(value, `stylizedSurface.lod.rock.${name}`);
  }
  if (!(rock.nearPixels > rock.proxyPixels
      && rock.proxyPixels > rock.impostorPixels
      && rock.impostorPixels > rock.clusterPixels)) {
    throw new Error('Invalid editor configuration: rock projected thresholds must descend near > proxy > impostor > cluster.');
  }
  assertUnitInterval(rock.hysteresisRatio, 'stylizedSurface.lod.rock.hysteresisRatio');
}

function validateAerial(aerial) {
  if (!aerial) return;
  assertUnitInterval(aerial.strength, 'stylizedSurface.sky.aerial.strength');
  assertUnitInterval(aerial.heightFalloff, 'stylizedSurface.sky.aerial.heightFalloff');
  assertPositive(aerial.endDistance, 'stylizedSurface.sky.aerial.endDistance');
  assertPositive(aerial.farDensityScale, 'stylizedSurface.sky.aerial.farDensityScale');
  assertFinite(aerial.startDistance, 'stylizedSurface.sky.aerial.startDistance');
  assertFinite(aerial.heightFloor, 'stylizedSurface.sky.aerial.heightFloor');
  assertFinite(aerial.heightCeiling, 'stylizedSurface.sky.aerial.heightCeiling');
  if (aerial.endDistance <= aerial.startDistance) {
    throw new Error('Invalid editor configuration: aerial endDistance must exceed startDistance.');
  }
  if (aerial.heightCeiling <= aerial.heightFloor) {
    throw new Error('Invalid editor configuration: aerial heightCeiling must exceed heightFloor.');
  }
  if (typeof aerial.horizonColor !== 'string' || aerial.horizonColor.length === 0) {
    throw new Error('Invalid editor configuration: aerial horizonColor is required.');
  }
}

/**
 * The animated clock that drives the sky's time presets. It only ever chooses a
 * preset name, so the thing worth checking is that its inputs are real numbers:
 * a bad hour or a zero-length day would step the clock nowhere or jump the look
 * every frame. Absent, it is simply not run.
 */
function validateSkyCycle(sky) {
  const cycle = sky?.cycle;
  if (!cycle) return;
  assertBoolean(cycle.enabled, 'stylizedSurface.sky.cycle.enabled');
  assertBoolean(cycle.paused, 'stylizedSurface.sky.cycle.paused');
  if (cycle.hour !== undefined) {
    assertFinite(cycle.hour, 'stylizedSurface.sky.cycle.hour');
    if (cycle.hour < 0 || cycle.hour >= 24) {
      throw new Error('Invalid editor configuration: stylizedSurface.sky.cycle.hour must be within [0, 24).');
    }
  }
  if (cycle.dayLengthSeconds !== undefined) {
    assertPositive(cycle.dayLengthSeconds, 'stylizedSurface.sky.cycle.dayLengthSeconds');
  }
  if (cycle.latitudeDegrees !== undefined) {
    assertFinite(cycle.latitudeDegrees, 'stylizedSurface.sky.cycle.latitudeDegrees');
  }
}

/**
 * The star field and the moon inside the dome material. Their numbers go
 * straight into a shader, so a typo that reaches here is a night sky that is
 * blank, striped or wrong-coloured with nothing to point at.
 */
function validateSkyStars(sky) {
  const stars = sky?.stars;
  if (!stars) return;
  assertBoolean(stars.enabled, 'stylizedSurface.sky.stars.enabled');
  if (stars.enabled === false) return;
  if (stars.density !== undefined) {
    assertNonNegativeInteger(stars.density, 'stylizedSurface.sky.stars.density');
  }
  if (stars.presence !== undefined) {
    assertUnitInterval(stars.presence, 'stylizedSurface.sky.stars.presence');
  }
  if (stars.magnitudePower !== undefined) {
    assertPositive(stars.magnitudePower, 'stylizedSurface.sky.stars.magnitudePower');
  }
  if (stars.rotationDegreesPerSecond !== undefined) {
    assertFinite(stars.rotationDegreesPerSecond, 'stylizedSurface.sky.stars.rotationDegreesPerSecond');
  }
  if (stars.brightness !== undefined) {
    assertNonNegative(stars.brightness, 'stylizedSurface.sky.stars.brightness');
  }
  const moon = stars.moon;
  if (!moon) return;
  assertBoolean(moon.enabled, 'stylizedSurface.sky.stars.moon.enabled');
  if (moon.enabled === false) return;
  if (moon.elevation !== undefined) {
    assertFinite(moon.elevation, 'stylizedSurface.sky.stars.moon.elevation');
    if (moon.elevation < -90 || moon.elevation > 90) {
      throw new Error('Invalid editor configuration: stylizedSurface.sky.stars.moon.elevation must be within [-90, 90].');
    }
  }
  if (moon.azimuth !== undefined) {
    assertFinite(moon.azimuth, 'stylizedSurface.sky.stars.moon.azimuth');
  }
  if (moon.size !== undefined) assertPositive(moon.size, 'stylizedSurface.sky.stars.moon.size');
  if (moon.softness !== undefined) assertNonNegative(moon.softness, 'stylizedSurface.sky.stars.moon.softness');
  if (moon.emission !== undefined) assertNonNegative(moon.emission, 'stylizedSurface.sky.stars.moon.emission');
  if (moon.illumination !== undefined) {
    assertUnitInterval(moon.illumination, 'stylizedSurface.sky.stars.moon.illumination');
  }
  if (moon.color !== undefined && (typeof moon.color !== 'string' || moon.color.length === 0)) {
    throw new Error('Invalid editor configuration: stylizedSurface.sky.stars.moon.color must be a colour string.');
  }
}

/**
 * The gorge mist. Its shape is resolved here — a bad step count, an inverted clear
 * span or a `maxDistance` past the height patch all have to be an error naming
 * their path rather than mist that reads off the edge of its own patch — and its
 * quality share, which the module does not resolve, is checked too.
 */
function validateValleyFog(sky) {
  const valleyFog = sky?.valleyFog;
  if (valleyFog === undefined) return;
  if (valleyFog.quality !== undefined) {
    assertUnitInterval(valleyFog.quality, 'stylizedSurface.sky.valleyFog.quality');
  }
  resolveValleyFogConfig(valleyFog);
}

/** Shared shape for every clustered scatter layer (bushes, boulders). */
function validateClusterField(cluster, path) {
  for (const [name, value] of [
    ['clusterSupercellSize', cluster.clusterSupercellSize],
    ['clusterSampleSpacing', cluster.clusterSampleSpacing],
    ['maximumSlope', cluster.maximumSlope],
  ]) {
    if (value !== undefined) assertPositive(value, `${path}.${name}`);
  }
  for (const [name, value] of [
    ['clusterDensity', cluster.clusterDensity],
    ['clusterEdgeWidth', cluster.clusterEdgeWidth],
    ['clusterBoundaryWarp', cluster.clusterBoundaryWarp],
    ['flatBias', cluster.flatBias],
  ]) {
    if (value !== undefined) assertUnitInterval(value, `${path}.${name}`);
  }
  if (cluster.preferredSlope !== undefined) {
    assertFinite(cluster.preferredSlope, `${path}.preferredSlope`);
    if (cluster.preferredSlope < 0) {
      throw new Error(`Invalid editor configuration: ${path}.preferredSlope must not be negative.`);
    }
  }
  if (cluster.clusterRadiusMin !== undefined && cluster.clusterRadiusMax !== undefined
      && cluster.clusterRadiusMax < cluster.clusterRadiusMin) {
    throw new Error(`Invalid editor configuration: ${path}.clusterRadiusMax must cover its minimum.`);
  }
  if (cluster.preferredSlope !== undefined && cluster.maximumSlope !== undefined
      && cluster.maximumSlope <= cluster.preferredSlope) {
    throw new Error(`Invalid editor configuration: ${path}.maximumSlope must exceed preferredSlope.`);
  }
}

function validateBushes(bushes) {
  if (!bushes) return;
  assertBoolean(bushes.enabled, 'stylizedSurface.bushes.enabled');
  if (!bushes.enabled) return;
  assertNonNegativeInteger(bushes.residentRadius, 'stylizedSurface.bushes.residentRadius');
  assertPositiveInteger(bushes.perChunk, 'stylizedSurface.bushes.perChunk');
  if (bushes.perChunk > 512) {
    throw new Error('Invalid editor configuration: bush perChunk must not exceed 512.');
  }
  assertPositive(bushes.minScale, 'stylizedSurface.bushes.minScale');
  assertPositive(bushes.maxScale, 'stylizedSurface.bushes.maxScale');
  if (bushes.maxScale < bushes.minScale) {
    throw new Error('Invalid editor configuration: bush maxScale must cover minScale.');
  }
  assertPositive(bushes.radius, 'stylizedSurface.bushes.radius');
  if (bushes.edgeAffinity !== undefined) {
    assertFinite(bushes.edgeAffinity, 'stylizedSurface.bushes.edgeAffinity');
  }
  if (bushes.understoryDensity !== undefined) {
    assertUnitInterval(bushes.understoryDensity, 'stylizedSurface.bushes.understoryDensity');
  }
  if (!Array.isArray(bushes.tileIds) || bushes.tileIds.length === 0) {
    throw new Error('Invalid editor configuration: stylizedSurface.bushes.tileIds must be a non-empty array.');
  }
  for (const name of ['colorLarge', 'colorSmall', 'colorFern']) {
    if (typeof bushes[name] !== 'string' || bushes[name].length === 0) {
      throw new Error(`Invalid editor configuration: stylizedSurface.bushes.${name} is required.`);
    }
  }
  validateClusterField(bushes, 'stylizedSurface.bushes');
}

function validateRockAppearance(rocks) {
  if (!rocks?.enabled) return;
  if (rocks.colorVariation !== undefined) {
    assertUnitInterval(rocks.colorVariation, 'stylizedSurface.rocks.colorVariation');
  }
  if (rocks.burial !== undefined) {
    assertUnitInterval(rocks.burial, 'stylizedSurface.rocks.burial');
  }
  if (rocks.color !== undefined && (typeof rocks.color !== 'string' || rocks.color.length === 0)) {
    throw new Error('Invalid editor configuration: stylizedSurface.rocks.color must be a colour string.');
  }
  if (rocks.proxyColor !== undefined
    && (typeof rocks.proxyColor !== 'string' || rocks.proxyColor.length === 0)) {
    throw new Error('Invalid editor configuration: stylizedSurface.rocks.proxyColor must be a colour string.');
  }
  // Resolved here so a bad strength is a config error naming its path, rather than
  // a stone that turns green in the world with nothing to point at.
  resolveRockWeathering(rocks.weathering);
  validateClusterField(rocks, 'stylizedSurface.rocks');
}

function validateGroundDetailLayer(layer, path) {
  if (!layer) return;
  assertBoolean(layer.enabled, `${path}.enabled`);
  if (!layer.enabled) return;
  assertNonNegativeInteger(layer.residentRadius, `${path}.residentRadius`);
  assertPositiveInteger(layer.perChunk, `${path}.perChunk`);
  if (layer.perChunk > 256) {
    throw new Error(`Invalid editor configuration: ${path}.perChunk must not exceed 256.`);
  }
  assertPositive(layer.minScale, `${path}.minScale`);
  assertPositive(layer.maxScale, `${path}.maxScale`);
  if (layer.maxScale < layer.minScale) {
    throw new Error(`Invalid editor configuration: ${path}.maxScale must cover its minimum.`);
  }
  assertPositive(layer.radius, `${path}.radius`);
  assertFinite(layer.heightOffset, `${path}.heightOffset`);
  assertUnitInterval(layer.colorVariation, `${path}.colorVariation`);
  assertBoolean(layer.castShadow, `${path}.castShadow`);
  if (!Array.isArray(layer.tileIds) || layer.tileIds.length === 0) {
    throw new Error(`Invalid editor configuration: ${path}.tileIds must be a non-empty array.`);
  }
  if (layer.regionalChannel !== undefined && !REGIONAL_CHARACTER_CHANNELS.includes(layer.regionalChannel)) {
    throw new Error(`Invalid editor configuration: ${path}.regionalChannel must be one of ${REGIONAL_CHARACTER_CHANNELS.join(', ')}.`);
  }
}

function validateImpostor(impostor) {
  assertBoolean(impostor.enabled, 'stylizedSurface.lod.impostor.enabled');
  if (impostor.compressed !== undefined) assertBoolean(impostor.compressed, 'stylizedSurface.lod.impostor.compressed');
  assertBoolean(impostor.runtimeBake, 'stylizedSurface.lod.impostor.runtimeBake');
  assertPositiveInteger(impostor.columns, 'stylizedSurface.lod.impostor.columns');
  assertPositiveInteger(impostor.rows, 'stylizedSurface.lod.impostor.rows');
  assertPositiveInteger(impostor.tileSize, 'stylizedSurface.lod.impostor.tileSize');
  if (impostor.tileSize < 32 || impostor.tileSize > 512) {
    throw new Error('Invalid editor configuration: impostor tileSize must be from 32 to 512.');
  }
  assertNonNegativeInteger(impostor.gutter, 'stylizedSurface.lod.impostor.gutter');
  if (impostor.gutter * 2 >= impostor.tileSize) {
    throw new Error('Invalid editor configuration: impostor gutter must leave a positive capture area.');
  }
  assertFinite(impostor.lowElevationDegrees, 'stylizedSurface.lod.impostor.lowElevationDegrees');
  assertFinite(impostor.highElevationDegrees, 'stylizedSurface.lod.impostor.highElevationDegrees');
  if (impostor.highElevationDegrees <= impostor.lowElevationDegrees) {
    throw new Error('Invalid editor configuration: impostor high elevation must exceed low elevation.');
  }
  if (typeof impostor.manifest !== 'string' || impostor.manifest.trim().length === 0) {
    throw new Error('Invalid editor configuration: impostor manifest path is required.');
  }
}

function validateGroundCover(groundCover) {
  if (!groundCover) return;
  assertBoolean(groundCover.enabled, 'stylizedSurface.groundCover.enabled');
  if (!groundCover.enabled) return;
  for (const [name, value] of [
    ['startDistance', groundCover.startDistance],
    ['endDistance', groundCover.endDistance],
    ['frequency', groundCover.frequency],
    ['noiseScale', groundCover.noiseScale],
    ['noiseWarp', groundCover.noiseWarp],
    ['strength', groundCover.strength],
    ['tipStrength', groundCover.tipStrength],
  ]) {
    assertPositive(value, `stylizedSurface.groundCover.${name}`);
  }
  if (groundCover.endDistance <= groundCover.startDistance) {
    throw new Error('Invalid editor configuration: groundCover endDistance must exceed startDistance.');
  }
  assertUnitInterval(groundCover.strandThreshold, 'stylizedSurface.groundCover.strandThreshold');
  if (!Array.isArray(groundCover.direction)
      || groundCover.direction.length !== 2
      || groundCover.direction.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid editor configuration: groundCover.direction must be a finite vec2.');
  }
  if (typeof groundCover.tipColor !== 'string' || groundCover.tipColor.length === 0) {
    throw new Error('Invalid editor configuration: groundCover.tipColor is required.');
  }
  const volume = groundCover.volume;
  if (!volume) return;
  assertBoolean(volume.enabled, 'stylizedSurface.groundCover.volume.enabled');
  if (!volume.enabled) return;
  for (const name of ['startDistance', 'fullDistance', 'height', 'minGraze', 'plantMeters', 'stemMeters', 'stemFadeStart', 'stemFadeEnd']) {
    assertPositive(volume[name], `stylizedSurface.groundCover.volume.${name}`);
  }
  assertUnitInterval(volume.tipShare, 'stylizedSurface.groundCover.volume.tipShare');
  if (volume.fullDistance <= volume.startDistance || volume.stemFadeEnd <= volume.stemFadeStart) {
    throw new Error('Invalid editor configuration: groundCover.volume distance ranges must increase.');
  }
  if (!Number.isInteger(volume.steps) || volume.steps < 1 || volume.steps > 16) {
    throw new Error('Invalid editor configuration: groundCover.volume.steps must be an integer in [1,16].');
  }
}

/**
 * The grass density falloff's tail and the thinning that carries the field down to
 * it. `presenceWindow` is the one number here that is a fraction rather than a
 * distance: it is the slice of the coverage range a single blade spends fading.
 */
function validateGrassCoverage(lod) {
  if (!lod) return;
  assertBoolean(lod.enabled, 'stylizedSurface.grass.lod.enabled');
  if (!lod.enabled) return;
  const coverage = lod.coverage;
  if (!coverage) return;
  assertBoolean(coverage.enabled, 'stylizedSurface.grass.lod.coverage.enabled');
  if (!coverage.enabled) return;
  if (coverage.outerFadeMeters !== undefined) {
    assertNonNegative(
      coverage.outerFadeMeters,
      'stylizedSurface.grass.lod.coverage.outerFadeMeters',
    );
  }
  // A window at zero would snap every blade at once, which is the ring this exists
  // to remove; at it or above, blades spend the whole range fading and none of them
  // is ever whole.
  if (coverage.presenceWindow !== undefined) {
    assertUnitInterval(coverage.presenceWindow, 'stylizedSurface.grass.lod.coverage.presenceWindow', false);
    if (coverage.presenceWindow >= 0.5) {
      throw new Error(
        'Invalid editor configuration: stylizedSurface.grass.lod.coverage.presenceWindow must be under 0.5.',
      );
    }
  }
  if (coverage.compensation !== undefined) {
    assertUnitInterval(coverage.compensation, 'stylizedSurface.grass.lod.coverage.compensation');
  }
  if (coverage.maximumWiden !== undefined) {
    if (!Number.isFinite(coverage.maximumWiden) || coverage.maximumWiden < 1) {
      throw new Error(
        'Invalid editor configuration: stylizedSurface.grass.lod.coverage.maximumWiden must be at least 1.',
      );
    }
  }
}

/**
 * The procedural water plants. Their rule is the water rule the view hands to
 * `evaluateAquaticPlacement`, so what has to hold is that each species' depth band
 * is a real band in a real order — an inverted one would place a species nowhere,
 * or everywhere, and neither shows up until someone looks at a lake.
 */
function validateAquaticFlora(layer) {
  const variants = Object.entries(layer?.proceduralVariants ?? {});
  if (variants.length === 0) return;
  if (!layer.enabled) {
    throw new Error('Invalid editor configuration: stylizedSurface.aquaticPlants needs enabled to carry water plants.');
  }
  for (const [id, variant] of variants) {
    if (variant?.enabled === false) continue;
    const path = `stylizedSurface.aquaticPlants.proceduralVariants.${id}`;
    for (const name of ['minimumDepth', 'maximumDepth']) {
      if (variant[name] === undefined) continue;
      if (!Number.isFinite(variant[name]) || variant[name] < 0) {
        throw new Error(`Invalid editor configuration: ${path}.${name} must not be negative.`);
      }
    }
    if (variant.minimumDepth !== undefined && variant.maximumDepth !== undefined
        && variant.maximumDepth <= variant.minimumDepth) {
      throw new Error(`Invalid editor configuration: ${path}.maximumDepth must exceed minimumDepth.`);
    }
    if (variant.minimumShoreDistance !== undefined && variant.maximumShoreDistance !== undefined
        && variant.maximumShoreDistance <= variant.minimumShoreDistance) {
      throw new Error(`Invalid editor configuration: ${path}.maximumShoreDistance must exceed minimumShoreDistance.`);
    }
    if (variant.placement !== undefined
        && variant.placement !== 'rooted'
        && variant.placement !== 'surface') {
      throw new Error(`Invalid editor configuration: ${path}.placement must be "rooted" or "surface".`);
    }
    if (variant.allowedKinds !== undefined
        && (!Array.isArray(variant.allowedKinds) || variant.allowedKinds.length === 0)) {
      throw new Error(`Invalid editor configuration: ${path}.allowedKinds must be a non-empty array.`);
    }
    if (variant.heightScale !== undefined) {
      assertPositive(variant.heightScale, `${path}.heightScale`);
    }
  }
}

/**
 * The procedural shore layer. Its geometry is built in code from `kind`, so the
 * thing worth validating is not a scale band but that every variant names a band it
 * actually occupies: a variant with no band would either place nothing or claim the
 * whole world, and neither shows up as an error until someone looks at a beach.
 */
function validateShoreLife(layer) {
  if (!layer) return;
  assertBoolean(layer.enabled, 'stylizedSurface.shoreLife.enabled');
  if (!layer.enabled) return;
  assertNonNegativeInteger(layer.residentRadius, 'stylizedSurface.shoreLife.residentRadius');
  assertPositiveInteger(layer.perChunk, 'stylizedSurface.shoreLife.perChunk');
  if (layer.perChunk > 256) {
    throw new Error('Invalid editor configuration: stylizedSurface.shoreLife.perChunk must not exceed 256.');
  }
  assertPositive(layer.minScale, 'stylizedSurface.shoreLife.minScale');
  assertPositive(layer.maxScale, 'stylizedSurface.shoreLife.maxScale');
  if (layer.maxScale < layer.minScale) {
    throw new Error('Invalid editor configuration: shoreLife maxScale must cover its minimum.');
  }
  if (!Array.isArray(layer.tileIds) || layer.tileIds.length === 0) {
    throw new Error('Invalid editor configuration: stylizedSurface.shoreLife.tileIds must be a non-empty array.');
  }
  for (const [tileId, density] of Object.entries(layer.densityByTile ?? {})) {
    if (!Number.isInteger(Number(tileId))) {
      throw new Error(`Invalid editor configuration: shoreLife densityByTile key "${tileId}" is not a tile id.`);
    }
    assertUnitInterval(density, `stylizedSurface.shoreLife.densityByTile.${tileId}`, false);
  }
  const layerBand = layer.strand;
  if (layerBand) {
    assertStrandBand(layerBand, 'stylizedSurface.shoreLife.strand');
  }
  const variants = Object.entries(layer.variants ?? {});
  if (variants.length === 0) {
    throw new Error('Invalid editor configuration: stylizedSurface.shoreLife needs at least one variant.');
  }
  for (const [id, variant] of variants) {
    const path = `stylizedSurface.shoreLife.variants.${id}`;
    if (variant?.enabled === false) continue;
    // A variant carries its own species band, which came from the shape's default
    // unless the config named one. The layer's band is the shore itself: a species
    // outside it would place nothing and never say so, so that is an error rather
    // than something to clamp.
    const band = {
      placement: variant?.placement ?? layerBand?.placement ?? 'ground',
      minimumAbove: variant?.minimumAbove ?? layerBand?.minimumAbove,
      maximumAbove: variant?.maximumAbove ?? layerBand?.maximumAbove,
    };
    if (variant?.minimumAbove !== undefined
      || variant?.maximumAbove !== undefined
      || !layerBand) {
      assertStrandBand(band, `${path}.strand`);
    }
    if (layerBand && variant?.minimumAbove !== undefined && variant.minimumAbove < layerBand.minimumAbove) {
      throw new Error(`Invalid editor configuration: ${path}.minimumAbove starts below the shore band.`);
    }
    if (layerBand && variant?.maximumAbove !== undefined && variant.maximumAbove > layerBand.maximumAbove) {
      throw new Error(`Invalid editor configuration: ${path}.maximumAbove reaches past the shore band.`);
    }
  }
}

function assertStrandBand(band, path) {
  const placement = band.placement ?? 'ground';
  if (placement === 'ground' || placement === 'bed') {
    assertFinite(band.minimumAbove ?? 0, `${path}.minimumAbove`);
    assertFinite(band.maximumAbove ?? 0, `${path}.maximumAbove`);
    if ((band.minimumAbove ?? 0) < 0) {
      throw new Error(`Invalid editor configuration: ${path}.minimumAbove must not be negative.`);
    }
    if ((band.maximumAbove ?? 0) <= (band.minimumAbove ?? 0)) {
      throw new Error(`Invalid editor configuration: ${path} must have a band: maximumAbove must exceed minimumAbove.`);
    }
    return;
  }
  throw new Error(`Invalid editor configuration: ${path}.placement must be "ground" or "bed".`);
}

export function validateStylizedLodConfig(config) {
  const surface = config.stylizedSurface;
  if (!surface?.enabled) return config;
  resolveSnowSurfaceConfig(surface.snowSurface);
  const preparedPlacementCache = surface.preparedPlacementCache;
  if (preparedPlacementCache?.maxEntries !== undefined) {
    assertPositiveInteger(
      preparedPlacementCache.maxEntries,
      'stylizedSurface.preparedPlacementCache.maxEntries',
    );
  }
  if (preparedPlacementCache?.maxMiB !== undefined) {
    assertPositive(
      preparedPlacementCache.maxMiB,
      'stylizedSurface.preparedPlacementCache.maxMiB',
    );
  }
  const habitat = surface.trees?.habitat;
  if (habitat) {
    assertBoolean(habitat.enabled, 'stylizedSurface.trees.habitat.enabled');
    assertPositiveInteger(
      habitat.candidateBudgetPerChunk,
      'stylizedSurface.trees.habitat.candidateBudgetPerChunk',
    );
    assertPositiveInteger(
      habitat.maxAcceptedPerChunk,
      'stylizedSurface.trees.habitat.maxAcceptedPerChunk',
    );
    if (habitat.candidateBudgetPerChunk > 384) {
      throw new Error('Invalid editor configuration: forest candidate budget must not exceed 384.');
    }
    if (habitat.patchSampleSpacing !== undefined) {
      assertPositive(habitat.patchSampleSpacing, 'stylizedSurface.trees.habitat.patchSampleSpacing');
    }
    for (const name of ['coverageContrast', 'coreDensityBoost']) {
      if (habitat[name] === undefined) continue;
      assertPositive(habitat[name], `stylizedSurface.trees.habitat.${name}`);
      if (habitat[name] > 8) {
        throw new Error(
          `Invalid editor configuration: stylizedSurface.trees.habitat.${name} must not exceed 8.`,
        );
      }
    }
    if (habitat.waterRangeMeters !== undefined) {
      assertFinite(habitat.waterRangeMeters, 'stylizedSurface.trees.habitat.waterRangeMeters');
      if (habitat.waterRangeMeters < 0) {
        throw new Error('Invalid editor configuration: stylizedSurface.trees.habitat.waterRangeMeters must not be negative.');
      }
      // The chamfer halo scales with this, so a runaway value would make every
      // manifest build quadratically more expensive.
      if (habitat.waterRangeMeters > 400) {
        throw new Error('Invalid editor configuration: stylizedSurface.trees.habitat.waterRangeMeters must not exceed 400.');
      }
    }
    if (habitat.maxAcceptedPerChunk > habitat.candidateBudgetPerChunk) {
      throw new Error('Invalid editor configuration: forest accepted budget must not exceed its candidate budget.');
    }
    assertPositive(habitat.patchSupercellSize, 'stylizedSurface.trees.habitat.patchSupercellSize');
    assertPositive(habitat.slopeSampleDistance, 'stylizedSurface.trees.habitat.slopeSampleDistance');
  }

  if (surface.grass.outerRingDensity !== undefined) {
    assertUnitInterval(surface.grass.outerRingDensity, 'stylizedSurface.grass.outerRingDensity', false);
  }
  if (surface.grass.nearRadius !== undefined) {
    assertNonNegativeInteger(surface.grass.nearRadius, 'stylizedSurface.grass.nearRadius');
    // A near band wider than residency would leave the far geometry unreachable,
    // and the slot drops it in that case — so the two keys would silently disagree
    // with what is drawn.
    if (surface.grass.nearRadius > surface.grass.residentRadius) {
      throw new Error(
        'Invalid editor configuration: stylizedSurface.grass.nearRadius must not exceed residentRadius.',
      );
    }
  }
  validateGrassCoverage(surface.grass.lod);
  if (surface.grass.system !== undefined && !['meadow', 'clumps'].includes(surface.grass.system)) {
    throw new Error('Invalid editor configuration: stylizedSurface.grass.system must be meadow or clumps.');
  }
  // Resolving throws on a bad band set or shape name, so a typo fails at load.
  resolveMeadowGrassConfig(surface.grass.meadow);
  resolveCinematicFinish(surface.cinematicFinish);
  if (surface.flowers.outerRingDensity !== undefined) {
    assertUnitInterval(surface.flowers.outerRingDensity, 'stylizedSurface.flowers.outerRingDensity', false);
  }
  assertPositiveInteger(surface.grass.bladesPerClump, 'stylizedSurface.grass.bladesPerClump');
  assertPositiveInteger(surface.grass.influenceTextureSize, 'stylizedSurface.grass.influenceTextureSize');
  if (surface.grass.influenceTextureSize > 128) {
    throw new Error('Invalid editor configuration: grass influenceTextureSize must not exceed 128.');
  }
  if (surface.streaming?.grassCellsPerBuildSlice !== undefined) {
    assertPositiveInteger(
      surface.streaming.grassCellsPerBuildSlice,
      'stylizedSurface.streaming.grassCellsPerBuildSlice',
    );
  }
  if (surface.streaming?.grassScatterGroupsPerSlice !== undefined) {
    assertPositiveInteger(
      surface.streaming.grassScatterGroupsPerSlice,
      'stylizedSurface.streaming.grassScatterGroupsPerSlice',
    );
  }
  if (surface.streaming?.inactiveReleaseFrames !== undefined) {
    assertNonNegativeInteger(
      surface.streaming.inactiveReleaseFrames,
      'stylizedSurface.streaming.inactiveReleaseFrames',
    );
  }

  if (surface.streaming?.treeManifestBuildsPerFrame !== undefined) {
    assertPositiveInteger(
      surface.streaming.treeManifestBuildsPerFrame,
      'stylizedSurface.streaming.treeManifestBuildsPerFrame',
    );
  }
  if (surface.streaming?.manifestBuildBudgetMs !== undefined) {
    assertPositive(
      surface.streaming.manifestBuildBudgetMs,
      'stylizedSurface.streaming.manifestBuildBudgetMs',
    );
  }

  validateGroundCover(surface.groundCover);
  validateAerial(surface.sky?.aerial);
  validateSkyCycle(surface.sky);
  validateSkyStars(surface.sky);
  validateValleyFog(surface.sky);
  validateBushes(surface.bushes);
  validateRockAppearance(surface.rocks);
  validateGroundDetailLayer(surface.groundDetails, 'stylizedSurface.groundDetails');
  validateGroundDetailLayer(surface.aquaticPlants, 'stylizedSurface.aquaticPlants');
  validateGroundDetailLayer(surface.tropicalKit, 'stylizedSurface.tropicalKit');
  validateAquaticFlora(surface.aquaticPlants);
  validateShoreLife(surface.shoreLife);
  // Resolved so an out-of-range contact strength is a config error naming its path
  // rather than ground that goes black under every tree.
  resolveContactShade(surface);
  // The surface terms inside the terrain material resolve here too, so a bad shape
  // key in ambient-effects.yaml (`snowStreaks.hardness`, `frost.facing`, …) is an
  // error naming its path rather than a term that silently does nothing.
  resolveBlownStreaks(surface.ambientEffects);
  resolveFrost(surface.ambientEffects);
  if (!surface.lod) return config;
  assertBoolean(surface.lod.enabled, 'stylizedSurface.lod.enabled');
  validateTreeBand(surface.lod.tree);
  validateRockBand(surface.lod.rock);
  // Bushes reuse the rock band shape: mesh + proxy, no impostor or cluster band.
  if (surface.lod.bush) validateRockBand(surface.lod.bush);
  validateImpostor(surface.lod.impostor);
  assertBoolean(surface.lod.gpuCulling.enabled, 'stylizedSurface.lod.gpuCulling.enabled');
  return config;
}
