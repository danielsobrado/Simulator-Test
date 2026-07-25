import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createForestProceduralAssetLibrary } from '../src/editor/stylized/forest/ForestProceduralAssetLibrary.js';

const manifestPath = resolve('public/assets/trees/forest-species-manifest.json');
const actual = JSON.parse(await readFile(manifestPath, 'utf8'));
const expected = createForestProceduralAssetLibrary();
if (!isDeepStrictEqual(actual, expected)) {
  throw new Error(
    'Forest asset recipes are stale. Run "npm run generate:forest-assets" and commit the result.',
  );
}
process.stdout.write(
  `validated ${actual.assets.length} deterministic forest asset recipes (${actual.signature})\n`,
);
