import { AzgaarMacroWorldGenerator } from './AzgaarMacroWorldGenerator.js';
import { ProceduralWorldGenerator } from './ProceduralWorldGenerator.js';
import { ensureWaterDomainGenerator } from '../water/GeneratorWaterAdapter.js';
import { isAzgaarMacroWorldSource } from '../import/AzgaarMacroWorldSource.js';

export function createWorldGenerator(metadata, baseTerrain = null) {
  if (!baseTerrain) {
    return ensureWaterDomainGenerator(new ProceduralWorldGenerator(metadata), metadata);
  }
  if (isAzgaarMacroWorldSource(baseTerrain)) {
    return ensureWaterDomainGenerator(
      new AzgaarMacroWorldGenerator(baseTerrain, metadata),
      metadata,
    );
  }
  throw new Error(`Unsupported base terrain source: ${baseTerrain.kind ?? 'unknown'}.`);
}
