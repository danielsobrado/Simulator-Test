
import { DEFAULT_ENVIRONMENTAL_MASK_SETTINGS } from './environment_mask_config.js';

let settings = DEFAULT_ENVIRONMENTAL_MASK_SETTINGS;

export function readEnvironmentalMaskSettings() {
  return settings;
}

export function setEnvironmentalMaskSettings(next) {
  settings = next ?? DEFAULT_ENVIRONMENTAL_MASK_SETTINGS;
}
