import fs from 'node:fs';
import path from 'node:path';

function slash(value) {
  return value.replaceAll('\\', '/');
}

export function configuredRuntimeScenes(editorConfig) {
  const assets = editorConfig.stylizedSurface?.assets ?? {};
  const variants = [
    ...(assets.rockVariants ?? []),
    ...(assets.bushVariants ?? []),
    ...(assets.treeVariants ?? []),
    ...(assets.groundDetailVariants ?? []),
    ...(assets.aquaticVariants ?? []),
    ...(assets.wildlifeVariants ?? []),
  ];
  return [...new Set([
    assets.scene,
    ...variants.map((variant) => variant.scene),
  ].filter(Boolean))];
}

/**
 * Texture tier per configured scene.
 *
 * Scatter props are drawn small and in bulk — a ground tuft or a boulder never
 * fills more of the screen than its own silhouette — so they carry half-size
 * colour and normal maps. Trees and the shared pine scene keep the full size:
 * they are the hero silhouettes the camera actually stands next to.
 *
 * A scene listed under both a tree and a scatter layer keeps the hero tier;
 * being shared is a reason to encode it once at the higher quality.
 */
export function runtimeAssetTextureTiers(editorConfig) {
  const assets = editorConfig.stylizedSurface?.assets ?? {};
  const tiers = new Map();
  const assign = (definitions, tier) => {
    for (const definition of definitions ?? []) {
      if (!definition?.scene) continue;
      if (tiers.get(definition.scene) === 'hero') continue;
      tiers.set(definition.scene, tier);
    }
  };
  assign(assets.rockVariants, 'scatter');
  assign(assets.bushVariants, 'scatter');
  assign(assets.groundDetailVariants, 'scatter');
  assign(assets.aquaticVariants, 'scatter');
  assign(assets.wildlifeVariants, 'scatter');
  assign(assets.treeVariants, 'hero');
  if (assets.scene) tiers.set(assets.scene, 'hero');
  return tiers;
}

export function runtimeAssetSources(
  repositoryRoot,
  editorConfig,
  extractionManifest,
  wildlifeManifest,
) {
  const extractedSources = new Map();
  for (const output of extractionManifest.sources.flatMap((source) => source.outputs)) {
    if (output.published) extractedSources.set(`/${slash(output.published).replace(/^public\//, '')}`, output.output);
  }
  for (const asset of wildlifeManifest.assets ?? []) {
    extractedSources.set(
      `/${slash(asset.published).replace(/^public\//, '')}`,
      asset.prepared,
    );
  }

  return configuredRuntimeScenes(editorConfig).map((scene) => {
    const output = `public/${scene.replace(/^\/+/, '')}`;
    const extractedSource = extractedSources.get(scene);
    const source = extractedSource ?? slash(path.join(
      'assets',
      'runtime-sources',
      scene.replace(/^\/?assets\//, ''),
    ));
    const sourcePath = path.resolve(repositoryRoot, source);
    if (!sourcePath.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)
        || !fs.existsSync(sourcePath)) {
      throw new Error(`No canonical unoptimized source exists for runtime asset ${scene}.`);
    }
    return { scene, source, output };
  });
}
