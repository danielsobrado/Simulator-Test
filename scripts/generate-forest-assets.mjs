import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createForestProceduralAssetLibrary } from '../src/editor/stylized/forest/ForestProceduralAssetLibrary.js';

const outputDirectory = resolve('public/assets/trees');
const outputPath = resolve(outputDirectory, 'forest-species-manifest.json');
const library = createForestProceduralAssetLibrary();
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
process.stdout.write(`Generated ${library.assets.length} deterministic forest asset recipes at ${outputPath}\n`);
