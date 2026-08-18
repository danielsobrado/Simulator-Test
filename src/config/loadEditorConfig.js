import yaml from 'js-yaml';
import azgaarGuidanceConfigSource from '../../config/azgaar-guidance.yaml?raw';
import collisionConfigSource from '../../config/collision.yaml?raw';
import configSource from '../../editor.config.yaml?raw';
import terrainMaterialBakeConfigSource from '../../config/terrain-material-bake.yaml?raw';
import waterConfigSource from '../../config/water-domain.yaml?raw';
import waterVisualConfigSource from '../../config/water-visual.yaml?raw';
import { createCollisionConfig } from '../editor/collision/CollisionConfig.js';
import { registerCollisionConfig } from '../editor/collision/CollisionPlayerBridge.js';
import { createTerrainMaterialBakeConfig } from '../editor/materials/TerrainMaterialBakeConfig.js';
import {
  applyWaterDomainConfig,
  validateWaterDomainConfig,
} from '../editor/water/WaterConfig.js';
import { validateUnderwaterConfig } from '../editor/water/UnderwaterConfig.js';
import {
  applyWaterVisualConfig,
  validateWaterContentConfig,
} from '../editor/water/WaterVisualConfig.js';
import { validateEditorConfig } from './validateEditorConfig.js';
import { validateFarTerrainConfig } from './validateFarTerrainConfig.js';
import { validateImportConfig } from './validateImportConfig.js';
import { validateStylizedLodConfig } from './validateStylizedLodConfig.js';

function runtimeSearch() {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function applyRuntimeOverrides(config) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('bakeImpostors') === '1') {
    config.renderer.forceWebGL = true;
  }
}

export function loadEditorConfig() {
  const config = yaml.load(configSource);
  config.import.azgaarGuidance = yaml.load(azgaarGuidanceConfigSource);
  config.stylizedSurface.materialBake = createTerrainMaterialBakeConfig(
    yaml.load(terrainMaterialBakeConfigSource),
  );
  applyWaterDomainConfig(config, yaml.load(waterConfigSource));
  applyWaterVisualConfig(config, yaml.load(waterVisualConfigSource));
  config.collision = createCollisionConfig(yaml.load(collisionConfigSource), runtimeSearch());
  applyRuntimeOverrides(config);
  validateEditorConfig(config);
  validateFarTerrainConfig(config.world?.farTerrain);
  validateImportConfig(config);
  validateWaterDomainConfig(config);
  validateUnderwaterConfig(config.player.water.underwater);
  validateWaterContentConfig(config);
  validateStylizedLodConfig(config);
  registerCollisionConfig(config.collision);
  return Object.freeze(config);
}
