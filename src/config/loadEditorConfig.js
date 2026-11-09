import enhancementsSource from '../../config/render-enhancements.yaml?compiled';
import { resolveRenderEnhancements } from './RenderEnhancements.js';
import ambientEffectsConfigSource from '../../config/ambient-effects.yaml?compiled';
import azgaarGuidanceConfigSource from '../../config/azgaar-guidance.yaml?compiled';
import biomeLooksConfigSource from '../../config/biome-looks.yaml?compiled';
import collisionConfigSource from '../../config/collision.yaml?compiled';
import culturesConfigSource from '../../config/cultures.yaml?compiled';
import configSource from '../../editor.config.yaml?compiled';
import explorationConfigSource from '../../config/exploration.yaml?compiled';
import { applyMobileStartupProfile } from '../editor/exploration/MobileProfile.js';
import { resolveExplorationConfig } from '../editor/exploration/ExplorationConfig.js';
import terrainMaterialBakeConfigSource from '../../config/terrain-material-bake.yaml?compiled';
import waterConfigSource from '../../config/water-domain.yaml?compiled';
import waterVisualConfigSource from '../../config/water-visual.yaml?compiled';
import weatherEffectsConfigSource from '../../config/weather-effects.yaml?compiled';
import { resolveWeatherEffects } from '../editor/weather/WeatherEffectsConfig.js';
import { createCollisionConfig } from '../editor/collision/CollisionConfig.js';
import { registerCollisionConfig } from '../editor/collision/CollisionPlayerBridge.js';
import { createTerrainMaterialBakeConfig } from '../editor/materials/TerrainMaterialBakeConfig.js';
import { resolveBiomeLooks } from '../editor/biomes/BiomeLooks.js';
import { applyBiomeLooks } from '../editor/biomes/applyBiomeLooks.js';
import { resolveSurfaceWetnessConfig } from '../editor/weather/surfaceWetnessConfig.js';
import { resolveSnowCoverConfig } from '../editor/weather/storm/SnowCover.js';
import { resolveAmbientEffectsConfig } from '../editor/stylized/ambient/ambientEffectsConfig.js';
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
import { resolveCultureCatalog } from '../sim/config/cultureCatalog.js';

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
  const config = structuredClone(configSource);
  config.simulation ??= {};
  config.simulation.cultureCatalog = resolveCultureCatalog(structuredClone(culturesConfigSource));
  config.stylizedSurface.enhancements = resolveRenderEnhancements(structuredClone(enhancementsSource), runtimeSearch(),
    { mobile: typeof window !== 'undefined' && window.innerWidth < 768 });
  config.exploration = resolveExplorationConfig(structuredClone(explorationConfigSource));
  config.weatherEffects = resolveWeatherEffects(structuredClone(weatherEffectsConfigSource));
  config.stylizedSurface.trees.rootFit = config.exploration.treeRoots;
  config.import.azgaarGuidance = structuredClone(azgaarGuidanceConfigSource);
  // Each biome's look (config/biome-looks.yaml) hands the terrain, grass, trees
  // and air their columns before any of them is resolved.
  const terrainMaterialBakeSource = structuredClone(terrainMaterialBakeConfigSource);
  const biomeSnow = new URLSearchParams(runtimeSearch()).get('biomeSnow') !== '0';
  applyBiomeLooks(config, terrainMaterialBakeSource,
    resolveBiomeLooks(structuredClone(biomeLooksConfigSource)?.biomeLooks, { snow: biomeSnow }));
  config.stylizedSurface.materialBake = createTerrainMaterialBakeConfig(terrainMaterialBakeSource);
  config.stylizedSurface.wetness = resolveSurfaceWetnessConfig(config.stylizedSurface.wetness);
  config.stylizedSurface.snowCover = resolveSnowCoverConfig(config.stylizedSurface.snowCover);
  config.stylizedSurface.ambientEffects = resolveAmbientEffectsConfig(
    structuredClone(ambientEffectsConfigSource)?.ambientEffects,
  );
  applyWaterDomainConfig(config, structuredClone(waterConfigSource));
  applyWaterVisualConfig(config, structuredClone(waterVisualConfigSource));
  config.collision = createCollisionConfig(structuredClone(collisionConfigSource), runtimeSearch());
  applyRuntimeOverrides(config);
  applyMobileStartupProfile(config);
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
