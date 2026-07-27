import { generateBaseWorldChunk } from './generateWorldChunk.js';
import { createWorldGenerator } from './WorldGeneratorFactory.js';

let baseTerrain = null;
let worldGenerator = null;
let generatorMetadata = null;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'configure') {
    baseTerrain = event.data.baseTerrain ?? null;
    worldGenerator = generatorMetadata
      ? createWorldGenerator(generatorMetadata, baseTerrain)
      : null;
    return;
  }
  const { id, request } = event.data ?? {};
  try {
    const metadataChanged = !generatorMetadata
      || JSON.stringify(generatorMetadata) !== JSON.stringify(request.generator);
    if (!worldGenerator || metadataChanged) {
      generatorMetadata = request.generator;
      worldGenerator = createWorldGenerator(generatorMetadata, baseTerrain);
    }
    const page = generateBaseWorldChunk({ ...request, worldGenerator });
    const transfer = [
      page.tiles.buffer,
      page.heights.buffer,
      page.waterFieldPixels.buffer,
    ];
    if (page.tilePixels?.buffer) {
      transfer.push(page.tilePixels.buffer);
    }
    if (page.surfaceMaskPixels?.buffer) {
      transfer.push(page.surfaceMaskPixels.buffer);
    }
    if (page.grassScatter?.base?.buffer) {
      transfer.push(page.grassScatter.base.buffer, page.grassScatter.parameters.buffer);
    }
    if (page.flowerScatter?.base?.buffer) {
      transfer.push(page.flowerScatter.base.buffer, page.flowerScatter.parameters.buffer);
    }
    self.postMessage({ id, page }, transfer);
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
