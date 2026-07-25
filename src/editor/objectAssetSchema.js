const DEFAULT_OFFSET = Object.freeze([0, 0, 0]);

function requireFinite(value, fieldName, key) {
  if (!Number.isFinite(value)) {
    throw new Error(`Object ${key} has an invalid ${fieldName}.`);
  }
}

function parseAsset(rawAsset, key) {
  if (!rawAsset || typeof rawAsset !== 'object') {
    throw new Error(`Object ${key} is missing its GLB asset.`);
  }
  if (typeof rawAsset.path !== 'string' || !rawAsset.path.trim().endsWith('.glb')) {
    throw new Error(`Object ${key} asset.path must reference a GLB file.`);
  }
  if (typeof rawAsset.node !== 'string' || rawAsset.node.trim() === '') {
    throw new Error(`Object ${key} asset.node must be a non-empty string.`);
  }

  const scale = rawAsset.scale ?? 1;
  requireFinite(scale, 'asset scale', key);
  if (scale <= 0) {
    throw new Error(`Object ${key} asset scale must be positive.`);
  }

  const rotationY = rawAsset.rotationY ?? 0;
  requireFinite(rotationY, 'asset rotationY', key);

  const offset = rawAsset.offset ?? DEFAULT_OFFSET;
  if (!Array.isArray(offset) || offset.length !== 3) {
    throw new Error(`Object ${key} asset offset must contain three numbers.`);
  }
  offset.forEach((value, index) => requireFinite(value, `asset offset[${index}]`, key));

  return Object.freeze({
    path: rawAsset.path.replace(/^\/+/, ''),
    node: rawAsset.node,
    scale,
    rotationY,
    offset: Object.freeze([...offset]),
  });
}

/**
 * Builds the GLB side of the object catalog.
 *
 * The `asset` block is optional: objects that omit it render from their
 * procedural model alone and are simply left out of the loader's work list.
 */
export function createObjectRenderCatalog(rawDefinitions, placementCatalog) {
  if (!Array.isArray(rawDefinitions)) {
    throw new Error('Object render catalog must be an array.');
  }
  const rawByKey = new Map(rawDefinitions.map((definition) => [definition?.key, definition]));
  const entries = [];

  for (const definition of placementCatalog) {
    const rawDefinition = rawByKey.get(definition.key);
    if (!rawDefinition) {
      throw new Error(`Object ${definition.key} is missing from the render catalog.`);
    }
    if (rawDefinition.asset === undefined || rawDefinition.asset === null) {
      continue;
    }
    entries.push(Object.freeze({
      ...definition,
      asset: parseAsset(rawDefinition.asset, definition.key),
    }));
  }

  return Object.freeze(entries);
}
