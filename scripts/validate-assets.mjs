import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { OBJECT_MODEL_NAMES } from '../src/editor/ObjectModelLibrary.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { TILE_BY_KEY } from '../src/editor/tileCatalog.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
const OBJECT_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'config', 'objects.yaml');

async function main() {
  const parsed = yaml.load(await readFile(OBJECT_CONFIG_PATH, 'utf8'));
  if (!Array.isArray(parsed?.objects) || parsed.objects.length === 0) {
    throw new Error('config/objects.yaml must contain object definitions.');
  }

  // Running the definitions through the real schema keeps this gate honest:
  // footprints, foundations, and terrain keys fail here rather than at runtime.
  const catalog = createObjectCatalog(parsed.objects, TILE_BY_KEY);
  const modelNames = new Set(OBJECT_MODEL_NAMES);
  const usedModels = new Set();

  for (const definition of catalog) {
    if (!modelNames.has(definition.model)) {
      throw new Error(
        `Object ${definition.key} references unknown procedural model ${definition.model}.`,
      );
    }
    usedModels.add(definition.model);
    console.log(`validated ${definition.key}: ${definition.model} `
      + `(${definition.footprint.width}×${definition.footprint.depth}, ${definition.category})`);
  }

  const unused = OBJECT_MODEL_NAMES.filter((model) => !usedModels.has(model));
  if (unused.length > 0) {
    throw new Error(`Procedural models are not placeable from the catalog: ${unused.join(', ')}.`);
  }

  const categories = new Set(catalog.map((definition) => definition.category));
  console.log(
    `validated ${catalog.length} object definitions across ${categories.size} categories `
    + `and ${usedModels.size} procedural models`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
