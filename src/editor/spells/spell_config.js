import { load } from 'js-yaml';
import spellsYamlText from '../../../config/spells.yaml?raw';
import spellDefaults from './spells_yaml_defaults.json' with { type: 'json' };

const BEAM_VFX_SCHEMA = Object.freeze({
  flameScale: ['flame_scale', 'number', 0.25, 3],
  worldWidth: ['world_width', 'number', 0.2, 20],
  worldHeight: ['world_height', 'number', 0.2, 30],
  handForwardM: ['hand_forward_m', 'number', -5, 10],
  handRightM: ['hand_right_m', 'number', -5, 5],
  handUpM: ['hand_up_m', 'number', -5, 5],
  glowColor: ['glow_color', 'color'],
  glowIntensity: ['glow_intensity', 'number', 0, 12],
  glowDistance: ['glow_distance', 'number', 0, 30],
  glowDecay: ['glow_decay', 'number', 0, 4],
  glowLocalYRatio: ['glow_local_y_ratio', 'number', -1, 2],
});

const EARTH_VFX_SCHEMA = Object.freeze({
  handForwardM: ['hand_forward_m', 'number', -5, 10],
  handRightM: ['hand_right_m', 'number', -5, 5],
  handUpM: ['hand_up_m', 'number', -5, 5],
  impactRadius: ['impact_radius', 'number', 0.5, 20],
  crackRadius: ['crack_radius', 'number', 0.5, 30],
  dustRadius: ['dust_radius', 'number', 0.5, 30],
  shardCount: ['shard_count', 'integer', 0, 128],
  shardMinHeight: ['shard_min_height', 'number', 0, 10],
  shardMaxHeight: ['shard_max_height', 'number', 0, 20],
  shardLifetimeMs: ['shard_lifetime_ms', 'number', 100, 8000],
  glowColor: ['glow_color', 'color'],
  glowIntensity: ['glow_intensity', 'number', 0, 12],
  glowDistance: ['glow_distance', 'number', 0, 30],
  glowDecay: ['glow_decay', 'number', 0, 4],
});

const LIGHTNING_VFX_SCHEMA = Object.freeze({
  handForwardM: ['hand_forward_m', 'number', -5, 10],
  handRightM: ['hand_right_m', 'number', -5, 5],
  handUpM: ['hand_up_m', 'number', -5, 5],
  maxRange: ['max_range', 'number', 2, 80],
  segmentCount: ['segment_count', 'integer', 8, 128],
  branchCount: ['branch_count', 'integer', 0, 32],
  branchLengthMin: ['branch_length_min', 'number', 0.1, 10],
  branchLengthMax: ['branch_length_max', 'number', 0.1, 16],
  jitter: ['jitter', 'number', 0, 4],
  coreWidth: ['core_width', 'number', 0.005, 0.5],
  glowWidth: ['glow_width', 'number', 0.01, 2],
  refreshHz: ['refresh_hz', 'number', 1, 60],
  impactRadius: ['impact_radius', 'number', 0.05, 5],
  sparkCount: ['spark_count', 'integer', 0, 128],
  coreColor: ['core_color', 'color'],
  glowColor: ['glow_color', 'color'],
  sourceLightIntensity: ['source_light_intensity', 'number', 0, 20],
  impactLightIntensity: ['impact_light_intensity', 'number', 0, 30],
  glowDistance: ['glow_distance', 'number', 0, 40],
  glowDecay: ['glow_decay', 'number', 0, 4],
});

const FIREBALL_VFX_SCHEMA = Object.freeze({
  handForwardM: ['hand_forward_m', 'number', -5, 10],
  handRightM: ['hand_right_m', 'number', -5, 5],
  handUpM: ['hand_up_m', 'number', -5, 5],
  launchSpeed: ['launch_speed', 'number', 1, 80],
  liftSpeed: ['lift_speed', 'number', -20, 40],
  gravity: ['gravity', 'number', 0, 60],
  projectileRadius: ['projectile_radius', 'number', 0.08, 3],
  impactRadius: ['impact_radius', 'number', 0.25, 20],
  impactDurationMs: ['impact_duration_ms', 'number', 100, 4000],
  trailCount: ['trail_count', 'integer', 0, 64],
  sparkCount: ['spark_count', 'integer', 0, 128],
  coreColor: ['core_color', 'color'],
  glowColor: ['glow_color', 'color'],
  glowIntensity: ['glow_intensity', 'number', 0, 24],
  glowDistance: ['glow_distance', 'number', 0, 40],
  glowDecay: ['glow_decay', 'number', 0, 4],
});

const SPELL_SCHEMAS = Object.freeze({
  fire: BEAM_VFX_SCHEMA,
  water: BEAM_VFX_SCHEMA,
  air: BEAM_VFX_SCHEMA,
  earth: EARTH_VFX_SCHEMA,
  lightning: LIGHTNING_VFX_SCHEMA,
  fireball: FIREBALL_VFX_SCHEMA,
});

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function sourceDocument(source) {
  if (typeof source !== 'string') return asRecord(source);
  return asRecord(load(source));
}

function fallbackValue(record, fallbackRecord, key) {
  return record?.[key] ?? fallbackRecord?.[key];
}

function readString(record, fallbackRecord, key, lastResort) {
  const value = fallbackValue(record, fallbackRecord, key);
  return typeof value === 'string' && value.trim() ? value.trim() : lastResort;
}

function readNumber(record, fallbackRecord, key, minimum, maximum) {
  const value = Number(fallbackValue(record, fallbackRecord, key));
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function readColor(record, fallbackRecord, key) {
  const value = fallbackValue(record, fallbackRecord, key);
  if (!Array.isArray(value) || value.length !== 3) return [1, 1, 1];
  const color = value.map(Number);
  if (!color.every(Number.isFinite)) return [1, 1, 1];
  return color.map((channel) => Math.max(0, Math.min(1, channel)));
}

function parseVfx(record, fallbackRecord, schema) {
  return Object.fromEntries(Object.entries(schema).map(([property, descriptor]) => {
    const [key, kind, minimum, maximum] = descriptor;
    if (kind === 'color') return [property, readColor(record, fallbackRecord, key)];
    const number = readNumber(record, fallbackRecord, key, minimum, maximum);
    return [property, kind === 'integer' ? Math.floor(number) : number];
  }));
}

function parseSpellEntry(id, record, fallbackRecord) {
  const audio = asRecord(record?.audio);
  const fallbackAudio = asRecord(fallbackRecord?.audio);
  return Object.freeze({
    id,
    label: readString(record, fallbackRecord, 'label', id),
    castDurationMs: readNumber(record, fallbackRecord, 'cast_duration_ms', 250, 8000),
    audio: Object.freeze({
      volume: readNumber(audio, fallbackAudio, 'volume', 0, 1),
    }),
    vfx: Object.freeze(parseVfx(
      asRecord(record?.vfx),
      asRecord(fallbackRecord?.vfx),
      SPELL_SCHEMAS[id],
    )),
  });
}

function parseSpellDocument(document) {
  const root = asRecord(document?.spells);
  const fallbackRoot = asRecord(spellDefaults?.spells);
  const menu = asRecord(root?.menu);
  const fallbackMenu = asRecord(fallbackRoot?.menu);
  return Object.freeze({
    menu: Object.freeze({
      rootId: readString(menu, fallbackMenu, 'root_id', 'spell-menu'),
      title: readString(menu, fallbackMenu, 'title', 'Spells'),
    }),
    fire: parseSpellEntry('fire', asRecord(root?.fire), asRecord(fallbackRoot?.fire)),
    water: parseSpellEntry('water', asRecord(root?.water), asRecord(fallbackRoot?.water)),
    air: parseSpellEntry('air', asRecord(root?.air), asRecord(fallbackRoot?.air)),
    earth: parseSpellEntry('earth', asRecord(root?.earth), asRecord(fallbackRoot?.earth)),
    lightning: parseSpellEntry(
      'lightning',
      asRecord(root?.lightning),
      asRecord(fallbackRoot?.lightning),
    ),
    fireball: parseSpellEntry(
      'fireball',
      asRecord(root?.fireball),
      asRecord(fallbackRoot?.fireball),
    ),
  });
}

export function parseSpellConfig(source = spellsYamlText) {
  try {
    return parseSpellDocument(sourceDocument(source));
  } catch (error) {
    console.warn('[spells] Failed to parse spell YAML; using generated defaults.', error);
    return parseSpellDocument(spellDefaults);
  }
}

export const defaultSpellConfig = parseSpellConfig();
