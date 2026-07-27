import yaml from 'js-yaml';
import configSource from '../../editor.config.yaml?raw';
import waterConfigSource from '../../config/water-domain.yaml?raw';
import { validateEditorConfig } from './validateEditorConfig.js';
import { validateStylizedLodConfig } from './validateStylizedLodConfig.js';
import {
  applyWaterDomainConfig,
  validateWaterDomainConfig,
} from '../editor/water/WaterConfig.js';

function applyRuntimeOverrides(config) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('bakeImpostors') === '1') {
    config.renderer.forceWebGL = true;
  }
}

export function loadEditorConfig() {
  const config = yaml.load(configSource);
  applyWaterDomainConfig(config, yaml.load(waterConfigSource));
  applyRuntimeOverrides(config);
  validateEditorConfig(config);
  validateWaterDomainConfig(config);
  validateStylizedLodConfig(config);
  return Object.freeze(config);
}
