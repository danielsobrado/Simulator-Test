import { load } from 'js-yaml';
import spellDefaults from './spells_yaml_defaults.json' with { type: 'json' };

const VALID_OPERATIONS = new Set(['add', 'remove']);
const VALID_SHAPES = new Set(['sphere', 'cube']);

const DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG = Object.freeze({
  enabled: true,
  operation: 'remove',
  shape: 'sphere',
  radiusM: 2.4,
  heightM: 2.4,
  strength: 0.72,
  falloff: 0.35,
  material: 0,
  maxRangeM: 10,
  commandExpiryMs: 3000,
  convergenceTimeoutMs: 5000,
});

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function finiteNumber(record, key, fallback, minimum, maximum) {
  const value = Number(record?.[key]);
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function integer(record, key, fallback, minimum, maximum) {
  return Math.round(finiteNumber(record, key, fallback, minimum, maximum));
}

function sourceRecord(source) {
  if (typeof source !== 'string') return asRecord(source);
  try {
    return asRecord(load(source));
  } catch (error) {
    console.warn('[spells] Invalid spell YAML; using Earth defaults.', error);
    return null;
  }
}

export function parseEarthSpellGameplayConfig(
  source = spellDefaults,
  fallback = DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
) {
  const root = sourceRecord(source);
  const gameplay = asRecord(asRecord(asRecord(root?.spells)?.earth)?.gameplay);
  if (!gameplay) return fallback;

  const operation = VALID_OPERATIONS.has(gameplay.operation)
    ? gameplay.operation
    : fallback.operation;
  const shape = VALID_SHAPES.has(gameplay.shape)
    ? gameplay.shape
    : fallback.shape;

  return Object.freeze({
    enabled: gameplay.terrain_edit_enabled !== false,
    operation,
    shape,
    radiusM: finiteNumber(gameplay, 'radius_m', fallback.radiusM, 0.25, 32),
    heightM: finiteNumber(gameplay, 'height_m', fallback.heightM, 0.1, 32),
    strength: finiteNumber(gameplay, 'strength', fallback.strength, 0.01, 16),
    falloff: finiteNumber(gameplay, 'falloff', fallback.falloff, 0, 1),
    material: integer(gameplay, 'material', fallback.material, 0, 255),
    maxRangeM: finiteNumber(gameplay, 'max_range_m', fallback.maxRangeM, 1, 100),
    commandExpiryMs: integer(
      gameplay,
      'command_expiry_ms',
      fallback.commandExpiryMs,
      100,
      30000,
    ),
    convergenceTimeoutMs: integer(
      gameplay,
      'convergence_timeout_ms',
      fallback.convergenceTimeoutMs,
      250,
      30000,
    ),
  });
}

export const earthSpellGameplayConfig = parseEarthSpellGameplayConfig();
