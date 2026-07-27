const DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG = Object.freeze({
  enabled: true,
  operation: "remove",
  shape: "sphere",
  radiusM: 2.4,
  heightM: 2.4,
  strength: 0.72,
  falloff: 0.35,
  material: 0,
  maxRangeM: 10,
  commandExpiryMs: 3000,
  convergenceTimeoutMs: 5000,
});

export function parseEarthSpellGameplayConfig(_text, fallback = DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG) {
  return fallback;
}

export const earthSpellGameplayConfig = DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG;
