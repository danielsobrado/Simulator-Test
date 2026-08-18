import yaml from 'js-yaml';
import configSource from '../../../config/workshop-radial-menus.yaml?raw';

const VALID_SIDES = new Set(['left', 'right']);
const VALID_SOURCES = new Set(['materialPresets', 'materialMaps', 'colorField', 'toggles']);
const VALID_EVENTS = new Set(['change', 'input']);
const VALID_COLOR = /^#[0-9a-f]{6}$/i;

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Workshop radial menu ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalColor(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !VALID_COLOR.test(value)) {
    throw new Error(`Workshop radial menu ${field} must be a six-digit hex color.`);
  }
  return value.toLowerCase();
}

function normalizeItem(item, field) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Workshop radial menu ${field} must be an object.`);
  }
  return Object.freeze({
    value: requireString(String(item.value ?? ''), `${field}.value`),
    label: requireString(item.label, `${field}.label`),
    glyph: typeof item.glyph === 'string' ? item.glyph : '',
    color: optionalColor(item.color, `${field}.color`),
  });
}

function normalizeItems(items, field) {
  const normalized = (items ?? []).map((item, index) => normalizeItem(item, `${field}[${index}]`));
  const values = new Set(normalized.map(({ value }) => value));
  if (values.size !== normalized.length) {
    throw new Error(`Workshop radial menu ${field} values must be unique.`);
  }
  return Object.freeze(normalized);
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
  const items = normalizeItems(lane.items, `${id}.items`);
  const fallbackItems = normalizeItems(lane.fallbackItems, `${id}.fallbackItems`);
  if (!lane.field && !lane.source) {
    throw new Error(`Workshop radial menu lane ${id} needs a field or source.`);
  }
  if (lane.source === 'colorField') {
    requireString(lane.target, `lane ${id} target`);
    for (const item of items) optionalColor(item.value, `${id} color value`);
  }
  if (lane.field && items.length === 0) {
    throw new Error(`Workshop radial menu field lane ${id} needs items.`);
  }
  if (['materialMaps', 'colorField', 'toggles'].includes(lane.source) && items.length === 0) {
    throw new Error(`Workshop radial menu lane ${id} needs items.`);
  }
  return Object.freeze({
    id,
    side: lane.side,
    label: requireString(lane.label, `lane ${id} label`),
    field: typeof lane.field === 'string' ? lane.field : '',
    source: typeof lane.source === 'string' ? lane.source : '',
    target: typeof lane.target === 'string' ? lane.target : '',
    event: eventName,
    items,
    fallbackItems,
  });
}

function normalizeMode(mode, index) {
  if (!mode || typeof mode !== 'object' || Array.isArray(mode)) {
    throw new Error(`Workshop radial menu mode ${index} must be an object.`);
  }
  const id = requireString(mode.id, `mode ${index} id`);
  const lanes = (mode.lanes ?? []).map((lane, laneIndex) => normalizeLane(lane, id, laneIndex));
  if (lanes.length === 0) throw new Error(`Workshop radial menu mode ${id} needs at least one lane.`);
  const laneIds = new Set(lanes.map((lane) => lane.id));
  if (laneIds.size !== lanes.length) {
    throw new Error(`Workshop radial menu mode ${id} lane ids must be unique.`);
  }
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

function boundedOddInteger(value, fallback, minimum, maximum, field) {
  const result = boundedInteger(value, fallback, minimum, maximum, field);
  if (result % 2 === 0) throw new Error(`Workshop radial menu ${field} must be odd.`);
  return result;
}

function normalizePresetColors(input) {
  if (input === undefined) return Object.freeze({});
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workshop radial menu materialPresetColors must be an object.');
  }
  return Object.freeze(Object.fromEntries(Object.entries(input).map(([presetId, color]) => [
    requireString(presetId, 'material preset color id'),
    optionalColor(color, `material preset ${presetId} color`),
  ])));
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
  return Object.freeze({
    version: boundedInteger(source.version, 1, 1, 2, 'version'),
    defaultMode,
    visibleSlots: boundedOddInteger(source.visibleSlots, 5, 3, 7, 'visibleSlots'),
    wheelCooldownMs: boundedInteger(source.wheelCooldownMs, 0, 0, 500, 'wheelCooldownMs'),
    wheelStepPx: boundedInteger(source.wheelStepPx, 42, 12, 160, 'wheelStepPx'),
    wheelMaxStepsPerEvent: boundedInteger(
      source.wheelMaxStepsPerEvent,
      2,
      1,
      4,
      'wheelMaxStepsPerEvent',
    ),
    swipeThresholdPx: boundedInteger(source.swipeThresholdPx, 30, 12, 120, 'swipeThresholdPx'),
    commitDelayMs: boundedInteger(source.commitDelayMs, 90, 40, 500, 'commitDelayMs'),
    readoutMs: boundedInteger(source.readoutMs, 850, 250, 3000, 'readoutMs'),
    materialPresetColors: normalizePresetColors(source.materialPresetColors),
    modes: Object.freeze(modes),
  });
}
