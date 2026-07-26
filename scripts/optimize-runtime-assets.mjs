import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import yaml from 'js-yaml';
import {
  hashBytes,
  inspectGlbJson,
  readGlbJson,
} from './lib/glb-inspection.mjs';
import {
  GLTFPACK_VERSION,
  ensureGltfpack,
} from './lib/gltfpack-tool.mjs';
import {
  configuredRuntimeScenes,
  runtimeAssetSources,
  runtimeAssetTextureTiers,
} from './lib/runtime-asset-sources.mjs';
import {
  officialGltfWarningBaseline,
  validateGlbWithOfficialValidator,
} from './lib/official-gltf-validation.mjs';
import {
  RUNTIME_ASSET_PROFILES,
  RUNTIME_ASSET_PROFILE_VERSION,
  runtimeAssetProfile,
  selectRuntimeAssetProfile,
} from './runtime-asset-profiles.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorConfigPath = path.join(repositoryRoot, 'editor.config.yaml');
const extractionManifestPath = path.join(
  repositoryRoot,
  'assets',
  'extracted',
  'manifest.json',
);
const wildlifeManifestPath = path.join(
  repositoryRoot,
  'assets',
  'extracted',
  'wildlife-manifest.json',
);
const runtimeManifestPath = path.join(
  repositoryRoot,
  'assets',
  'runtime-asset-manifest.json',
);
const stagingRoot = path.join(
  repositoryRoot,
  'tmp',
  `runtime-asset-optimization-${process.pid}`,
);
const cacheRoot = path.join(repositoryRoot, 'tmp', 'runtime-asset-cache');
const PIPELINE_CACHE_VERSION = 2;
const sourceIo = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function slash(value) {
  return value.replaceAll('\\', '/');
}

function assertInside(parent, target) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to write runtime asset outside ${resolvedParent}.`);
  }
}

function requiredNamesByScene(editorConfig) {
  const assets = editorConfig.stylizedSurface?.assets ?? {};
  const definitions = [
    {
      scene: assets.scene,
      nodeNames: [],
      materialNames: [assets.trunkMaterial, assets.leafMaterial],
    },
    ...(assets.rockVariants ?? []),
    ...(assets.bushVariants ?? []),
    ...(assets.treeVariants ?? []),
    ...(assets.groundDetailVariants ?? []),
    ...(assets.aquaticVariants ?? []),
    ...(assets.wildlifeVariants ?? []),
  ];
  const result = new Map();
  for (const definition of definitions) {
    if (!definition.scene) continue;
    const entry = result.get(definition.scene) ?? {
      nodeNames: new Set(),
      materialNames: new Set(),
    };
    for (const name of [
      ...(definition.nodeNames ?? []),
      ...(definition.rootNames ?? []),
      ...(definition.prototypeGroups ?? []).flat(),
    ]) {
      if (name) entry.nodeNames.add(name);
    }
    for (const name of [
      ...(definition.materialNames ?? []),
      definition.trunkMaterial,
      definition.leafMaterial,
    ]) {
      if (name) entry.materialNames.add(name);
    }
    result.set(definition.scene, entry);
  }
  return result;
}

function verifyNames(scene, sourceStats, outputStats, configuredNames) {
  const outputNodes = new Set(outputStats.nodeNames);
  const outputMaterials = new Set(outputStats.materialNames);
  for (const name of sourceStats.nodeNames) {
    if (!outputNodes.has(name)) {
      throw new Error(`${scene}: gltfpack removed named source node "${name}".`);
    }
  }
  for (const name of sourceStats.materialNames) {
    if (!outputMaterials.has(name)) {
      throw new Error(`${scene}: gltfpack removed named source material "${name}".`);
    }
  }
  if (JSON.stringify(sourceStats.animationNames) !== JSON.stringify(outputStats.animationNames)
      || sourceStats.skins !== outputStats.skins) {
    throw new Error(`${scene}: animation or skin contracts changed during optimization.`);
  }
  for (const name of configuredNames.nodeNames) {
    if (!outputNodes.has(name)) {
      throw new Error(`${scene}: optimized GLB is missing configured node "${name}".`);
    }
  }
  for (const name of configuredNames.materialNames) {
    if (!outputMaterials.has(name)) {
      throw new Error(`${scene}: optimized GLB is missing configured material "${name}".`);
    }
  }
}

function boundsTolerance(bounds) {
  if (!bounds) return 0;
  const extent = Math.max(
    ...bounds.max.map((value, axis) => Math.abs(value - bounds.min[axis])),
  );
  return Math.max(0.002, extent * 0.00005);
}

function verifySemanticGeometry(scene, sourceStats, outputStats) {
  if (!sourceStats.sceneBounds || !outputStats.sceneBounds) {
    throw new Error(`${scene}: source and optimized GLBs must expose POSITION bounds.`);
  }
  const tolerance = boundsTolerance(sourceStats.sceneBounds);
  const boundDelta = Math.max(
    ...sourceStats.sceneBounds.min.map(
      (value, axis) => Math.abs(value - outputStats.sceneBounds.min[axis]),
    ),
    ...sourceStats.sceneBounds.max.map(
      (value, axis) => Math.abs(value - outputStats.sceneBounds.max[axis]),
    ),
  );
  if (boundDelta > tolerance) {
    throw new Error(
      `${scene}: world bounds changed by ${boundDelta}, exceeding ${tolerance}.`,
    );
  }
  if (sourceStats.drawParts !== outputStats.drawParts) {
    throw new Error(
      `${scene}: rendered draw parts changed from ${sourceStats.drawParts} `
      + `to ${outputStats.drawParts}.`,
    );
  }
  if (JSON.stringify(sourceStats.materialTriangleCounts)
      !== JSON.stringify(outputStats.materialTriangleCounts)) {
    throw new Error(`${scene}: primitive-to-material triangle assignments changed.`);
  }
  if (outputStats.logicalVertexBytes > sourceStats.logicalVertexBytes
      || outputStats.logicalIndexBytes > sourceStats.logicalIndexBytes) {
    throw new Error(`${scene}: logical decoded geometry grew during optimization.`);
  }
}

function verifyOptimizedAsset({
  scene,
  sourceJson,
  outputJson,
  sourceStats,
  outputStats,
  configuredNames,
}) {
  if (sourceStats.renderedTriangles !== outputStats.renderedTriangles) {
    throw new Error(
      `${scene}: rendered triangle count changed from ${sourceStats.renderedTriangles} `
      + `to ${outputStats.renderedTriangles}; simplification is not enabled.`,
    );
  }
  verifySemanticGeometry(scene, sourceStats, outputStats);
  verifyNames(scene, sourceStats, outputStats, configuredNames);
  if (JSON.stringify(sourceJson.asset?.extras ?? null)
      !== JSON.stringify(outputJson.asset?.extras ?? null)) {
    throw new Error(`${scene}: asset.extras provenance changed during optimization.`);
  }
  if (sourceStats.renderedTriangles > 0
      && !outputStats.extensionsRequired.includes('EXT_meshopt_compression')) {
    throw new Error(`${scene}: optimized geometry does not require EXT_meshopt_compression.`);
  }
  if (sourceStats.textures > 0) {
    if (!outputStats.extensionsRequired.includes('KHR_texture_basisu')) {
      throw new Error(`${scene}: optimized textures do not require KHR_texture_basisu.`);
    }
    if ((outputJson.images ?? []).some((image) => image.mimeType !== 'image/ktx2')) {
      throw new Error(`${scene}: optimized GLB contains a non-KTX2 embedded image.`);
    }
  }
}

function runGltfpack(executablePath, sourcePath, outputPath, reportPath, optimizerArgs) {
  const result = spawnSync(executablePath, [
    '-i',
    sourcePath,
    '-o',
    outputPath,
    ...optimizerArgs,
    '-r',
    reportPath,
  ], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `gltfpack failed for ${sourcePath}: `
      + `${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
}

function cacheKey(sourceSha256, profileName, optimizerArgs) {
  return hashBytes(Buffer.from(JSON.stringify({
    pipelineCacheVersion: PIPELINE_CACHE_VERSION,
    profileVersion: RUNTIME_ASSET_PROFILE_VERSION,
    gltfpackVersion: GLTFPACK_VERSION,
    sourceSha256,
    profileName,
    optimizerArgs,
  })));
}

function cachePaths(key) {
  const directory = path.join(cacheRoot, `v${PIPELINE_CACHE_VERSION}`, key);
  assertInside(cacheRoot, directory);
  return {
    directory,
    output: path.join(directory, 'output.glb'),
    report: path.join(directory, 'gltfpack-report.json'),
    metadata: path.join(directory, 'cache.json'),
  };
}

function restoreFromCache(key, stagedOutputPath, reportPath) {
  const cached = cachePaths(key);
  if (!fs.existsSync(cached.metadata)
      || !fs.existsSync(cached.output)
      || !fs.existsSync(cached.report)) {
    return false;
  }
  try {
    const metadata = JSON.parse(fs.readFileSync(cached.metadata, 'utf8'));
    const outputBytes = fs.readFileSync(cached.output);
    const reportBytes = fs.readFileSync(cached.report);
    if (metadata.outputSha256 !== hashBytes(outputBytes)
        || metadata.reportSha256 !== hashBytes(reportBytes)) {
      return false;
    }
    fs.copyFileSync(cached.output, stagedOutputPath);
    fs.copyFileSync(cached.report, reportPath);
    return true;
  } catch {
    return false;
  }
}

function saveToCache(key, stagedOutputPath, reportPath) {
  const cached = cachePaths(key);
  const temporaryDirectory = `${cached.directory}-${process.pid}.tmp`;
  assertInside(cacheRoot, temporaryDirectory);
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  const outputPath = path.join(temporaryDirectory, 'output.glb');
  const cachedReportPath = path.join(temporaryDirectory, 'gltfpack-report.json');
  fs.copyFileSync(stagedOutputPath, outputPath);
  fs.copyFileSync(reportPath, cachedReportPath);
  const metadata = {
    version: PIPELINE_CACHE_VERSION,
    outputSha256: hashBytes(fs.readFileSync(outputPath)),
    reportSha256: hashBytes(fs.readFileSync(cachedReportPath)),
  };
  fs.writeFileSync(
    path.join(temporaryDirectory, 'cache.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  fs.rmSync(cached.directory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cached.directory), { recursive: true });
  fs.renameSync(temporaryDirectory, cached.directory);
}

function transferCompression(bytes) {
  return {
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
      },
    }).length,
  };
}

function replaceFileAtomically(sourcePath, targetPath) {
  const temporaryPath = `${targetPath}.runtime-assets-${process.pid}.tmp`;
  const displacedPath = `${targetPath}.runtime-assets-${process.pid}.previous`;
  assertInside(repositoryRoot, temporaryPath);
  assertInside(repositoryRoot, displacedPath);
  fs.copyFileSync(sourcePath, temporaryPath);
  const displaced = fs.existsSync(targetPath);
  try {
    if (displaced) fs.renameSync(targetPath, displacedPath);
    fs.renameSync(temporaryPath, targetPath);
    fs.rmSync(displacedPath, { force: true });
  } catch (error) {
    if (displaced && fs.existsSync(displacedPath) && !fs.existsSync(targetPath)) {
      fs.renameSync(displacedPath, targetPath);
    }
    throw error;
  } finally {
    fs.rmSync(temporaryPath, { force: true });
    fs.rmSync(displacedPath, { force: true });
  }
}

async function prepareSource(sourcePath, normalizedPath) {
  const document = await sourceIo.read(sourcePath);
  await document.transform(prune({
    propertyTypes: [PropertyType.TEXTURE],
    keepExtras: true,
    keepSolidTextures: true,
  }), textureCompress({
    encoder: sharp,
    targetFormat: 'png',
  }));
  fs.writeFileSync(normalizedPath, await sourceIo.writeBinary(document));
}

async function main() {
  const editorConfig = yaml.load(fs.readFileSync(editorConfigPath, 'utf8'));
  const extractionManifest = JSON.parse(fs.readFileSync(extractionManifestPath, 'utf8'));
  const wildlifeManifest = JSON.parse(fs.readFileSync(wildlifeManifestPath, 'utf8'));
  const assets = runtimeAssetSources(
    repositoryRoot,
    editorConfig,
    extractionManifest,
    wildlifeManifest,
  );
  const textureTiers = runtimeAssetTextureTiers(editorConfig);
  const expectedScenes = configuredRuntimeScenes(editorConfig);
  if (assets.length !== expectedScenes.length) {
    throw new Error('Runtime asset source mapping is incomplete.');
  }
  const configuredNames = requiredNamesByScene(editorConfig);
  const executablePath = await ensureGltfpack(repositoryRoot);
  assertInside(repositoryRoot, stagingRoot);
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  const records = [];
  try {
    for (const [index, asset] of assets.entries()) {
      const sourcePath = path.resolve(repositoryRoot, asset.source);
      const stagedOutputPath = path.join(stagingRoot, asset.output);
      const normalizedSourcePath = path.join(stagingRoot, 'inputs', `${index}.glb`);
      const reportPath = path.join(stagingRoot, 'reports', `${index}.json`);
      fs.mkdirSync(path.dirname(stagedOutputPath), { recursive: true });
      fs.mkdirSync(path.dirname(normalizedSourcePath), { recursive: true });
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });

      const sourceBytes = fs.readFileSync(sourcePath);
      const sourceJson = readGlbJson(sourceBytes, asset.source);
      const sourceStats = inspectGlbJson(sourceJson);
      const profileName = selectRuntimeAssetProfile(
        sourceJson,
        textureTiers.get(asset.scene) ?? 'hero',
      );
      const profile = runtimeAssetProfile(profileName);
      const sourceSha256 = hashBytes(sourceBytes);
      const assetCacheKey = cacheKey(sourceSha256, profileName, profile.args);
      const cacheHit = restoreFromCache(assetCacheKey, stagedOutputPath, reportPath);
      if (!cacheHit) {
        await prepareSource(sourcePath, normalizedSourcePath);
        runGltfpack(
          executablePath,
          normalizedSourcePath,
          stagedOutputPath,
          reportPath,
          profile.args,
        );
      }
      const outputBytes = fs.readFileSync(stagedOutputPath);
      const outputJson = readGlbJson(outputBytes, asset.output);
      const outputStats = inspectGlbJson(outputJson);
      verifyOptimizedAsset({
        scene: asset.scene,
        sourceJson,
        outputJson,
        sourceStats,
        outputStats,
        configuredNames: configuredNames.get(asset.scene),
      });
      const inheritedWarnings = await officialGltfWarningBaseline(
        sourceBytes,
        asset.source,
      );
      const officialValidation = await validateGlbWithOfficialValidator(
        outputBytes,
        asset.output,
        { inheritedWarnings },
      );
      if (!cacheHit) saveToCache(assetCacheKey, stagedOutputPath, reportPath);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const reduction = 1 - outputBytes.length / sourceBytes.length;
      const compressed = transferCompression(outputBytes);
      console.log(
        `${cacheHit ? 'cache ' : ''}${asset.scene}: `
        + `${(sourceBytes.length / 1024).toFixed(1)} -> `
        + `${(outputBytes.length / 1024).toFixed(1)} KiB `
        + `(${(reduction * 100).toFixed(1)}% smaller, ${profileName})`,
      );
      records.push({
        scene: asset.scene,
        source: slash(asset.source),
        output: slash(asset.output),
        profile: profileName,
        optimizerArgs: profile.args,
        cacheKey: assetCacheKey,
        sourceSha256,
        outputSha256: hashBytes(outputBytes),
        sourceBytes: sourceBytes.length,
        outputBytes: outputBytes.length,
        ...compressed,
        sourceStats,
        outputStats,
        officialValidation,
        report,
      });
    }

    const totals = records.reduce(
      (result, record) => ({
        sourceBytes: result.sourceBytes + record.sourceBytes,
        outputBytes: result.outputBytes + record.outputBytes,
        gzipBytes: result.gzipBytes + record.gzipBytes,
        brotliBytes: result.brotliBytes + record.brotliBytes,
        logicalSourceVertexBytes:
          result.logicalSourceVertexBytes + record.sourceStats.logicalVertexBytes,
        logicalOutputVertexBytes:
          result.logicalOutputVertexBytes + record.outputStats.logicalVertexBytes,
        logicalSourceIndexBytes:
          result.logicalSourceIndexBytes + record.sourceStats.logicalIndexBytes,
        logicalOutputIndexBytes:
          result.logicalOutputIndexBytes + record.outputStats.logicalIndexBytes,
      }),
      {
        sourceBytes: 0,
        outputBytes: 0,
        gzipBytes: 0,
        brotliBytes: 0,
        logicalSourceVertexBytes: 0,
        logicalOutputVertexBytes: 0,
        logicalSourceIndexBytes: 0,
        logicalOutputIndexBytes: 0,
      },
    );
    const manifest = {
      version: 2,
      generator: 'scripts/optimize-runtime-assets.mjs',
      optimizer: {
        name: 'gltfpack',
        version: GLTFPACK_VERSION,
        profileVersion: RUNTIME_ASSET_PROFILE_VERSION,
        profiles: Object.fromEntries(
          Object.entries(RUNTIME_ASSET_PROFILES).map(([name, profileDefinition]) => [
            name,
            {
              description: profileDefinition.description,
              args: profileDefinition.args,
            },
          ]),
        ),
      },
      assets: records,
      totals: {
        ...totals,
        savedBytes: totals.sourceBytes - totals.outputBytes,
        reductionRatio: Number(
          (1 - totals.outputBytes / totals.sourceBytes).toFixed(6),
        ),
      },
    };
    const stagedManifestPath = path.join(stagingRoot, 'runtime-asset-manifest.json');
    fs.writeFileSync(stagedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const published = [];
    try {
      for (const [index, record] of records.entries()) {
        const stagedPath = path.join(stagingRoot, record.output);
        const outputPath = path.resolve(repositoryRoot, record.output);
        const backupPath = path.join(stagingRoot, 'backups', `${index}.glb`);
        assertInside(repositoryRoot, outputPath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        const existed = fs.existsSync(outputPath);
        if (existed) fs.copyFileSync(outputPath, backupPath);
        replaceFileAtomically(stagedPath, outputPath);
        published.push({ outputPath, backupPath, existed });
      }
      replaceFileAtomically(stagedManifestPath, runtimeManifestPath);
    } catch (error) {
      for (const publishedAsset of published.reverse()) {
        if (publishedAsset.existed) {
          replaceFileAtomically(publishedAsset.backupPath, publishedAsset.outputPath);
        } else {
          fs.rmSync(publishedAsset.outputPath, { force: true });
        }
      }
      throw error;
    }
    console.log(
      `optimized ${records.length} runtime GLBs: `
      + `${(totals.sourceBytes / 1024 / 1024).toFixed(2)} -> `
      + `${(totals.outputBytes / 1024 / 1024).toFixed(2)} MiB`,
    );
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

await main();
