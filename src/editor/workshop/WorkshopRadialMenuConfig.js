import yaml from 'js-yaml';
import configSource from '../../../config/workshop-radial-menus.yaml?raw';

const VALID_SIDES = new Set(['left', 'right']);
const VALID_SOURCES = new Set(['materialPresets', 'materialMaps', 'colorField', 'toggles']);
const VALID_EVENTS = new Set(['change', 'input']);

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Workshop radial menu ${field} must be a non-empty string.`);
  }
  return value;
}

function normalizeItem(item, field) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Workshop radial menu ${field} must be an object.`);
  }
  return Object.freeze({
    value: requireString(String(item.value ?? ''), `${field}.value`),
    label: requireString(item.label, `${field}.label`),
    glyph: typeof item.glyph === 'string' ? item.glyph : '',
    color: typeof item.color === 'string' ? item.color : '',
  });
}

function normalizeLane(lane, modeId, laneIndex) {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
    throw new Error(`Workshop radial menu mode ${modeId} lane ${laneIndex} must be an object.`);
  }
  const id = requireString(lane.id, `mode ${modeId} lane id`);
  if (!VALID_SIDES.has(lane.side)) {
    throw new Error(`Workshop radial menu lane ${id} has invalid side ${lane.side}.`);
  }
  if (lane.source && !VALID_SOURCES.has(lane.source)) {
    throw new Error(`Workshop radial menu lane ${id} has invalid source ${lane.source}.`);
  }
  const eventName = lane.event ?? 'change';
  if (!VALID_EVENTS.has(eventName)) {
    throw new Error(`Workshop radial menu lane ${id} has invalid event ${eventName}.`);
  }
  const items = (lane.items ?? []).map((item, index) => normalizeItem(item, `${id}.items[${index}]`));
  const fallbackItems = (lane.fallbackItems ?? []).map(
    (item, index) => normalizeItem(item, `${id}.fallbackItems[${index}]`),
  );
  if (!lane.field && !lane.source) {
    throw new Error(`Workshop radial menu lane ${id} needs a field or source.`);
  }
  return Object.freeze({
    id,
    side: lane.side,
    label: requireString(lane.label, `lane ${id} label`),
    field: typeof lane.field === 'string' ? lane.field : '',
    source: typeof lane.source === 'string' ? lane.source : '',
    target: typeof lane.target === 'string' ? lane.target : '',
    event: eventName,
    items: Object.freeze(items),
    fallbackItems: Object.freeze(fallbackItems),
  });
}

function normalizeMode(mode, index) {
  if (!mode || typeof mode !== 'object' || Array.isArray(mode)) {
    throw new Error(`Workshop radial menu mode ${index} must be an object.`);
  }
  const id = requireString(mode.id, `mode ${index} id`);
  const lanes = (mode.lanes ?? []).map((lane, laneIndex) => normalizeLane(lane, id, laneIndex));
  if (lanes.length === 0) throw new Error(`Workshop radial menu mode ${id} needs at least one lane.`);
  return Object.freeze({
    id,
    label: requireString(mode.label, `mode ${id} label`),
    glyph: typeof mode.glyph === 'string' ? mode.glyph : '',
    materialMode: mode.materialMode === true,
    lanes: Object.freeze(lanes),
  });
}

function boundedInteger(value, fallback, minimum, maximum, field) {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`Workshop radial menu ${field} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

export function loadWorkshopRadialMenuConfig() {
  const source = yaml.load(configSource);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Workshop radial menu config must be an object.');
  }
  const modes = (source.modes ?? []).map(normalizeMode);
  const modeIds = new Set(modes.map(({ id }) => id));
  if (modes.length === 0 || modeIds.size !== modes.length) {
    throw new Error('Workshop radial menu modes must be non-empty and uniquely named.');
  }
  const defaultMode = source.defaultMode ?? modes[0].id;
  if (!modeIds.has(defaultMode)) throw new Error(`Unknown workshop radial default mode ${defaultMode}.`);
  const materialPresetColors = Object.freeze({ ...(source.materialPresetColors ?? {}) });
  return Object.freeze({
    version: boundedInteger(source.version, 1, 1, 1, 'version'),
    defaultMode,
    visibleSlots: boundedInteger(source.visibleSlots, 5, 3, 7, 'visibleSlots'),
    wheelCooldownMs: boundedInteger(source.wheelCooldownMs, 90, 30, 500, 'wheelCooldownMs'),
    swipeThresholdPx: boundedInteger(source.swipeThresholdPx, 28, 12, 120, 'swipeThresholdPx'),
    materialPresetColors,
    modes: Object.freeze(modes),
  });
}
