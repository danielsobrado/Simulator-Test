export const TREE_IMPOSTOR_MANIFEST_VERSION = 3;
export const TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION = 2;
export const TREE_IMPOSTOR_NORMAL_ENCODING = 'view-normal-rgb-foliage-mask-a';
export const TREE_IMPOSTOR_LEGACY_NORMAL_ENCODING = 'view-normal-rgb-coverage-a';

const SOURCE_SIGNATURE_VERSION = 4;
const RUNTIME_TREE_FIELDS = new Set([
  'enabled',
  'residentRadius',
  'perChunk',
  'minScale',
  'maxScale',
  'tileIds',
  'clearRadius',
  'groveMix',
  'habitat',
]);
const REQUIRED_NUMERIC_FIELDS = Object.freeze([
  'columns',
  'rows',
  'tileSize',
  'lowElevationDegrees',
  'highElevationDegrees',
  'width',
  'height',
  'depth',
  'centerY',
  'radius',
]);

function hashText(hash, text) {
  let value = hash >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function numberToken(value) {
  return Number.isFinite(value) ? Number(value).toPrecision(9) : 'na';
}

function attributeCount(geometry, name) {
  return geometry?.getAttribute?.(name)?.count
    ?? geometry?.attributes?.[name]?.count
    ?? 0;
}

function indexCount(geometry) {
  return geometry?.getIndex?.()?.count ?? geometry?.index?.count ?? 0;
}

function arrayHash(attribute) {
  const array = attribute?.array;
  if (!array || !Number.isInteger(array.length)) return '00000000';
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  let hash = 0x811c9dc5;
  for (let index = 0; index < array.length; index += 1) {
    view.setFloat32(0, Number(array[index]), true);
    hash ^= view.getUint32(0, true);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function boundsToken(geometry) {
  geometry?.computeBoundingBox?.();
  const box = geometry?.boundingBox;
  if (!box) return 'no-bounds';
  return [
    box.min?.x,
    box.min?.y,
    box.min?.z,
    box.max?.x,
    box.max?.y,
    box.max?.z,
  ].map(numberToken).join(',');
}

function prototypeToken(parts) {
  return parts.map((part, partIndex) => {
    const geometry = part.geometry;
    const image = part.sourceMap?.image;
    return [
      partIndex,
      part.kind ?? 'unknown',
      attributeCount(geometry, 'position'),
      attributeCount(geometry, 'normal'),
      attributeCount(geometry, 'uv'),
      indexCount(geometry),
      arrayHash(geometry?.getAttribute?.('position') ?? geometry?.attributes?.position),
      arrayHash(geometry?.getAttribute?.('normal') ?? geometry?.attributes?.normal),
      arrayHash(geometry?.getAttribute?.('uv') ?? geometry?.attributes?.uv),
      arrayHash(geometry?.getIndex?.() ?? geometry?.index),
      boundsToken(geometry),
      image?.width ?? 0,
      image?.height ?? 0,
    ].join(':');
  }).join('|');
}

function treeBakeConfiguration(trees) {
  if (!trees || typeof trees !== 'object') return null;
  return Object.fromEntries(
    Object.entries(trees).filter(([key]) => !RUNTIME_TREE_FIELDS.has(key)),
  );
}

export function createTreeImpostorSourceSignature(prototypes, config) {
  if (!Array.isArray(prototypes) || prototypes.length === 0) {
    throw new Error('Tree impostor source signature requires at least one prototype.');
  }
  const {
    enabled: _enabled,
    manifest: _manifest,
    runtimeBake: _runtimeBake,
    ...impostorBakeConfig
  } = config?.lod?.impostor ?? {};
  const configuration = JSON.stringify({
    trees: treeBakeConfiguration(config?.trees),
    wind: config?.wind ?? null,
    treeVariants: config?.assets?.treeVariants ?? null,
    impostor: impostorBakeConfig,
    normalEncoding: TREE_IMPOSTOR_NORMAL_ENCODING,
  });
  let hash = hashText(0x811c9dc5, configuration);
  prototypes.forEach((parts, prototypeIndex) => {
    hash = hashText(hash, `${prototypeIndex}:${prototypeToken(parts)};`);
  });
  return `tree-impostor-v${SOURCE_SIGNATURE_VERSION}-${hash.toString(16).padStart(8, '0')}`;
}

function assertPositiveInteger(value, field, prototypeIndex) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Tree impostor prototype ${prototypeIndex} has invalid ${field}.`);
  }
}

function assertFinite(value, field, prototypeIndex, { positive = false } = {}) {
  if (!Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`Tree impostor prototype ${prototypeIndex} has invalid ${field}.`);
  }
}

function assertAssetPath(value, field, prototypeIndex) {
  if (typeof value !== 'string' || !value.startsWith('/assets/impostors/trees/')) {
    throw new Error(`Tree impostor prototype ${prototypeIndex} has invalid ${field} path.`);
  }
}

function validatePrototype(prototype, expectedIndex, normalEncoding) {
  if (!prototype || typeof prototype !== 'object') {
    throw new Error(`Tree impostor prototype ${expectedIndex} is invalid.`);
  }
  if (prototype.prototypeIndex !== expectedIndex) {
    throw new Error(
      `Tree impostor prototype index ${prototype.prototypeIndex} does not match expected index ${expectedIndex}.`,
    );
  }
  assertPositiveInteger(prototype.columns, 'columns', expectedIndex);
  assertPositiveInteger(prototype.rows, 'rows', expectedIndex);
  assertPositiveInteger(prototype.tileSize, 'tileSize', expectedIndex);
  for (const field of REQUIRED_NUMERIC_FIELDS) {
    assertFinite(
      prototype[field],
      field,
      expectedIndex,
      { positive: ['width', 'height', 'depth', 'radius'].includes(field) },
    );
  }
  if (prototype.highElevationDegrees <= prototype.lowElevationDegrees) {
    throw new Error(`Tree impostor prototype ${expectedIndex} has invalid elevation range.`);
  }
  const gutter = prototype.gutter ?? 0;
  if (!Number.isInteger(gutter) || gutter < 0 || gutter * 2 >= prototype.tileSize) {
    throw new Error(`Tree impostor prototype ${expectedIndex} has invalid gutter.`);
  }
  if (prototype.normalEncoding && prototype.normalEncoding !== normalEncoding) {
    throw new Error(
      `Tree impostor prototype ${expectedIndex} has unsupported normal encoding ${prototype.normalEncoding}.`,
    );
  }
  assertAssetPath(prototype.albedo, 'albedo', expectedIndex);
  assertAssetPath(prototype.normal, 'normal', expectedIndex);
  return Object.freeze({ ...prototype, gutter, normalEncoding });
}

export function validateTreeImpostorManifest(manifest, {
  allowLegacy = true,
  expectedPrototypeCount = null,
  expectedSourceSignature = null,
} = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Tree impostor manifest is invalid.');
  }
  const legacy = manifest.version === TREE_IMPOSTOR_LEGACY_MANIFEST_VERSION;
  if (legacy && !allowLegacy) {
    throw new Error(
      `Tree impostor manifest v${manifest.version} is a legacy migration format that requires runtime bake.`,
    );
  }
  if (!legacy && manifest.version !== TREE_IMPOSTOR_MANIFEST_VERSION) {
    throw new Error(
      `Tree impostor manifest version ${manifest.version} is unsupported; expected ${TREE_IMPOSTOR_MANIFEST_VERSION}.`,
    );
  }
  if (typeof manifest.sourceSignature !== 'string' || manifest.sourceSignature.length < 8) {
    throw new Error('Tree impostor manifest sourceSignature is invalid.');
  }
  if (!legacy && expectedSourceSignature && manifest.sourceSignature !== expectedSourceSignature) {
    throw new Error('Tree impostor manifest does not match the current tree source assets.');
  }
  if (!Array.isArray(manifest.prototypes) || manifest.prototypes.length === 0) {
    throw new Error('Tree impostor manifest contains no prototypes.');
  }
  if (
    Number.isInteger(expectedPrototypeCount)
    && manifest.prototypes.length !== expectedPrototypeCount
  ) {
    throw new Error(
      `Tree impostor manifest has ${manifest.prototypes.length} prototypes; expected ${expectedPrototypeCount}.`,
    );
  }
  const normalEncoding = legacy
    ? TREE_IMPOSTOR_LEGACY_NORMAL_ENCODING
    : TREE_IMPOSTOR_NORMAL_ENCODING;
  const ordered = [...manifest.prototypes].sort((left, right) => (
    left.prototypeIndex - right.prototypeIndex
  ));
  const prototypes = ordered.map((prototype, index) => (
    validatePrototype(prototype, index, normalEncoding)
  ));
  return Object.freeze({
    version: manifest.version,
    generatedAt: manifest.generatedAt ?? null,
    sourceSignature: manifest.sourceSignature,
    normalEncoding,
    requiresRuntimeBake: legacy,
    prototypes: Object.freeze(prototypes),
  });
}
