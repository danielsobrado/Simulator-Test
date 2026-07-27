import { AzgaarMacroWorldGenerator } from './AzgaarMacroWorldGenerator.js';
import { ProceduralWorldGenerator } from './ProceduralWorldGenerator.js';
import { ensureWaterDomainGenerator } from '../water/GeneratorWaterAdapter.js';

export function createWorldGenerator(metadata, baseTerrain = null) {
  const generator = !baseTerrain
    ? new ProceduralWorldGenerator(metadata)
    : baseTerrain.kind === 'azgaar-macro-v1'
      ? new AzgaarMacroWorldGenerator(baseTerrain, metadata)
      : null;
  if (!generator) {
    throw new Error(`Unsupported base terrain source: ${baseTerrain.kind ?? 'unknown'}.`);
  }
  return ensureWaterDomainGenerator(generator, metadata);
}
