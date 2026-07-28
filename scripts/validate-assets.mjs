import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createObjectColliderDescriptions } from '../src/editor/ObjectColliderLibrary.js';
import { OBJECT_MODEL_NAMES } from '../src/editor/ObjectModelLibrary.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { TILE_BY_KEY } from '../src/editor/tileCatalog.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
const OBJECT_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'config', 'objects.yaml');
const COLLISION_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'config', 'collision.yaml');
const EDITOR_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'editor.config.yaml');
const COLLIDER_NODE_PATTERN = /^COLLIDER(?:_WALKABLE)?(?:$|[_:.-])/i;

function parseGlbJson(buffer, filePath) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error(`${filePath} is not a GLB 2.0 file.`);
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'JSON') {
      return JSON.parse(buffer.toString('utf8', offset + 8, offset + 8 + length));
    }
    offset += 8 + length;
  }
  throw new Error(`${filePath} contains no GLB JSON chunk.`);
}

function nodeNamesForVariant(variant) {
  return [
    ...(variant.rootNames ?? []),
    ...(variant.prototypeGroups ?? []).flat(),
  ];
}

function selectedNodeIndices(document, variant) {
  const nodes = document.nodes ?? [];
  const selectedNames = variant.rootNames ?? [];
  if (selectedNames.length === 0) return nodes.map((_node, index) => index);

  const indicesByName = new Map(nodes.map((node, index) => [node.name, index]));
  const selected = new Set();
  const visit = (index) => {
    if (!Number.isSafeInteger(index) || selected.has(index)) return;
    selected.add(index);
    for (const child of nodes[index]?.children ?? []) visit(child);
  };
  for (const name of selectedNames) visit(indicesByName.get(name));
  return [...selected];
}

function validateCollisionNodes(document, variant, collisionConfig) {
  const nodes = document.nodes ?? [];
  const selected = selectedNodeIndices(document, variant)
    .map((index) => nodes[index])
    .filter(Boolean);
  const meshNodes = selected.filter((node) => Number.isSafeInteger(node.mesh));
  const collisionNodes = meshNodes.filter(
    (node) => COLLIDER_NODE_PATTERN.test(node.name ?? ''),
  );
  const visualNodes = meshNodes.filter(
    (node) => !COLLIDER_NODE_PATTERN.test(node.name ?? ''),
  );

  for (const node of selected.filter((node) => COLLIDER_NODE_PATTERN.test(node.name ?? ''))) {
    if (!Number.isSafeInteger(node.mesh)) {
      throw new Error(`${variant.scene} collision node ${node.name} contains no mesh.`);
    }
  }
  if (collisionConfig.rocks.requireAuthoredProxy
      && collisionNodes.length < visualNodes.length) {
    throw new Error(
      `${variant.scene} exposes ${visualNodes.length} rendered rock prototypes but only `
      + `${collisionNodes.length} COLLIDER or COLLIDER_WALKABLE mesh nodes.`,
    );
  }
  return collisionNodes.length;
}

async function validateStylizedAssets(editorConfig, collisionConfig) {
  const assets = editorConfig.stylizedSurface?.assets ?? {};
  const rockVariants = assets.rockVariants ?? [];
  const rockScenes = new Set(rockVariants.map((variant) => variant.scene));
  const variants = [
    ...rockVariants,
    ...(assets.bushVariants ?? []),
    ...(assets.treeVariants ?? []),
    ...(assets.groundDetailVariants ?? []),
    ...(assets.aquaticVariants ?? []),
    ...(assets.wildlifeVariants ?? []),
  ];
  const documents = new Map();
  let collisionProxyNodes = 0;
  for (const variant of variants) {
    let document = documents.get(variant.scene);
    if (!document) {
      const relativePath = variant.scene.replace(/^\/+/, '');
      const filePath = path.join(REPOSITORY_ROOT, 'public', relativePath);
      document = parseGlbJson(await readFile(filePath), filePath);
      documents.set(variant.scene, document);
    }
    const availableNodes = new Set((document.nodes ?? []).map((node) => node.name));
    const missingNodes = nodeNamesForVariant(variant).filter(
      (name) => !availableNodes.has(name),
    );
    if (missingNodes.length > 0) {
      throw new Error(
        `${variant.scene} is missing configured prototype nodes: ${missingNodes.join(', ')}.`,
      );
    }
    if (rockScenes.has(variant.scene)) {
      collisionProxyNodes += validateCollisionNodes(document, variant, collisionConfig);
    }
    const availableMaterials = new Set(
      (document.materials ?? []).map((material) => material.name),
    );
    for (const field of ['trunkMaterial', 'leafMaterial']) {
      if (variant[field] && !availableMaterials.has(variant[field])) {
        throw new Error(
          `${variant.scene} is missing configured material ${variant[field]}.`,
        );
      }
    }
    if (variant.clip) {
      const availableAnimations = new Set(
        (document.animations ?? []).map((animation) => animation.name),
      );
      if (!availableAnimations.has(variant.clip)) {
        throw new Error(
          `${variant.scene} is missing configured animation ${variant.clip}.`,
        );
      }
      if ((document.skins?.length ?? 0) < 1) {
        throw new Error(`${variant.scene} contains no animated skin.`);
      }
    }
  }
  const groupedCount = variants.reduce(
    (total, variant) => total + (variant.prototypeGroups?.length ?? 0),
    0,
  );
  const selectedRootCount = variants.reduce(
    (total, variant) => total + (variant.rootNames?.length ?? 0),
    0,
  );
  console.log(
    `validated ${documents.size} authored GLBs, ${groupedCount} grouped prototypes, `
    + `${selectedRootCount} selected mesh roots and ${collisionProxyNodes} rock collision nodes`,
  );
}

async function main() {
  const parsed = yaml.load(await readFile(OBJECT_CONFIG_PATH, 'utf8'));
  if (!Array.isArray(parsed?.objects) || parsed.objects.length === 0) {
    throw new Error('config/objects.yaml must contain object definitions.');
  }

  const editorConfig = yaml.load(await readFile(EDITOR_CONFIG_PATH, 'utf8'));
  const collisionConfig = yaml.load(await readFile(COLLISION_CONFIG_PATH, 'utf8'));
  const catalog = createObjectCatalog(parsed.objects, TILE_BY_KEY);
  const modelNames = new Set(OBJECT_MODEL_NAMES);
  const usedModels = new Set();
  let collidableDefinitions = 0;
  let colliderParts = 0;

  for (const definition of catalog) {
    if (!modelNames.has(definition.model)) {
      throw new Error(
        `Object ${definition.key} references unknown procedural model ${definition.model}.`,
      );
    }
    usedModels.add(definition.model);
    const descriptions = createObjectColliderDescriptions(definition, editorConfig.map.tileSize);
    if (descriptions.length > 0) collidableDefinitions += 1;
    colliderParts += descriptions.length;
    console.log(`validated ${definition.key}: ${definition.model} `
      + `(${definition.footprint.width}×${definition.footprint.depth}, ${definition.category}, `
      + `${definition.collision.policy}, ${descriptions.length} collider parts)`);
  }

  const unused = OBJECT_MODEL_NAMES.filter((model) => !usedModels.has(model));
  if (unused.length > 0) {
    throw new Error(`Procedural models are not placeable from the catalog: ${unused.join(', ')}.`);
  }

  const categories = new Set(catalog.map((definition) => definition.category));
  console.log(
    `validated ${catalog.length} object definitions across ${categories.size} categories, `
    + `${usedModels.size} procedural models, ${collidableDefinitions} collidable definitions, `
    + `and ${colliderParts} object collider parts`,
  );

  await validateStylizedAssets(editorConfig, collisionConfig);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
