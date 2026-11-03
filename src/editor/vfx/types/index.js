import { createParticleTypeRegistry } from '../particles/ParticleTypeRegistry.js';
import { ACID_TYPES } from './acidTypes.js';
import { ARCANE_TYPES } from './arcaneTypes.js';
import { CLOUD_TYPES } from './cloudTypes.js';
import { EXPLOSION_TYPES } from './explosionTypes.js';
import { FIRE_TYPES } from './fireTypes.js';
import { FROST_TYPES } from './frostTypes.js';
import { LIFE_TYPES } from './lifeTypes.js';
import { LUNAR_TYPES } from './lunarTypes.js';
import { STORM_TYPES } from './stormTypes.js';
import { WATER_TYPES } from './waterTypes.js';

/** The registry of every ParticleType the spell recipes use, by family. */
export function createSpellParticleTypes() {
  const registry = createParticleTypeRegistry();
  for (const family of [
    EXPLOSION_TYPES, FIRE_TYPES, FROST_TYPES, ACID_TYPES, STORM_TYPES,
    ARCANE_TYPES, LIFE_TYPES, LUNAR_TYPES, CLOUD_TYPES, WATER_TYPES,
  ]) registry.registerAll(family);
  registry.validateReferences();
  return registry;
}
