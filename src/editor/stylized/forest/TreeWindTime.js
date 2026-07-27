import { uniform } from 'three/tsl';

const TIME_BY_CONFIG = new WeakMap();

export function registerTreeWindTime(config, time) {
  if (config && time) TIME_BY_CONFIG.set(config, time);
}

export function treeWindTimeFor(config) {
  return TIME_BY_CONFIG.get(config) ?? uniform(0);
}
