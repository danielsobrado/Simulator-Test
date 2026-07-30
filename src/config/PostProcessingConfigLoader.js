import yaml from 'js-yaml';
import rawPostProcessingConfig from '../../config/post-processing.yaml?raw';
import { applyPostProcessingConfig } from '../editor/postprocessing/PostProcessingConfig.js';
import { installPostProcessingRuntime } from '../editor/postprocessing/installPostProcessing.js';

let parsedDefaults;

export function loadPostProcessingConfig(config) {
  parsedDefaults ??= yaml.load(rawPostProcessingConfig);
  applyPostProcessingConfig(config, parsedDefaults);
  installPostProcessingRuntime();
}
