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
    ['clusterPixels', tree.clusterPixels],
    ['transitionMs', tree.transitionMs],
  ]) {
    assertPositive(value, `stylizedSurface.lod.tree.${name}`);
  }
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
    if (habitat.candidateBudgetPerChunk > 96) {
      throw new Error('Invalid editor configuration: forest candidate budget must not exceed 96.');
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
  if (!surface.lod) return config;
  assertBoolean(surface.lod.enabled, 'stylizedSurface.lod.enabled');
  validateTreeBand(surface.lod.tree);
  validateRockBand(surface.lod.rock);
  validateImpostor(surface.lod.impostor);
  assertBoolean(surface.lod.gpuCulling.enabled, 'stylizedSurface.lod.gpuCulling.enabled');
  return config;
}
