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
}

function validateImpostor(impostor) {
  assertBoolean(impostor.enabled, 'stylizedSurface.lod.impostor.enabled');
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
}

export function validateStylizedLodConfig(config) {
  const surface = config.stylizedSurface;
  if (!surface?.enabled) return config;
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
  validateBushes(surface.bushes);
  validateRockAppearance(surface.rocks);
  validateGroundDetailLayer(surface.groundDetails, 'stylizedSurface.groundDetails');
  validateGroundDetailLayer(surface.aquaticPlants, 'stylizedSurface.aquaticPlants');
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
