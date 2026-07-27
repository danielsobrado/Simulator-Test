import {
  EQUIPMENT_SLOT_IDS,
  ITEM_CATEGORIES,
  ITEM_RARITIES,
} from './inventoryConstants.js';

const CATEGORY_SET = new Set(ITEM_CATEGORIES);
const RARITY_SET = new Set(ITEM_RARITIES);
const SLOT_SET = new Set(EQUIPMENT_SLOT_IDS);

function fail(message) {
  throw new Error(`Invalid item catalogue: ${message}`);
}

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    fail(`${label} must be a non-negative finite number.`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    fail(`${label} must be an integer >= 1.`);
  }
}

function normalizeEquipmentSlots(raw, itemKey) {
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) fail(`items.${itemKey}.equipmentSlots must be an array.`);
  const slots = [];
  for (const slot of raw) {
    if (!SLOT_SET.has(slot)) {
      fail(`items.${itemKey} references unknown equipment slot "${slot}".`);
    }
    if (!slots.includes(slot)) slots.push(slot);
  }
  return Object.freeze(slots);
}

function normalizeTags(raw, itemKey) {
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) fail(`items.${itemKey}.tags must be an array.`);
  for (const tag of raw) {
    if (typeof tag !== 'string' || tag.length === 0) {
      fail(`items.${itemKey}.tags must contain non-empty strings.`);
    }
  }
  return Object.freeze([...raw]);
}

/**
 * Validate and freeze a single item definition.
 * @param {string} itemKey
 * @param {object} raw
 * @param {{ requireActions?: boolean, knownActions?: Set<string> }} [options]
 */
export function normalizeItemDefinition(itemKey, raw, options = {}) {
  if (typeof itemKey !== 'string' || itemKey.length === 0) {
    fail('item keys must be non-empty strings.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`items.${itemKey} must be an object.`);
  }
  if (typeof raw.label !== 'string' || raw.label.trim().length === 0) {
    fail(`items.${itemKey}.label is required.`);
  }
  if (!CATEGORY_SET.has(raw.category)) {
    fail(`items.${itemKey}.category "${raw.category}" is invalid.`);
  }
  if (typeof raw.icon !== 'string' || raw.icon.trim().length === 0) {
    fail(`items.${itemKey}.icon is required.`);
  }
  assertPositiveInteger(raw.stackLimit, `items.${itemKey}.stackLimit`);
  if (!RARITY_SET.has(raw.rarity)) {
    fail(`items.${itemKey}.rarity "${raw.rarity}" is invalid.`);
  }
  assertFiniteNonNegative(raw.value, `items.${itemKey}.value`);
  assertFiniteNonNegative(raw.weight, `items.${itemKey}.weight`);

  const equipmentSlots = normalizeEquipmentSlots(raw.equipmentSlots, itemKey);
  let hands = null;
  if (raw.hands != null) {
    if (raw.hands !== 1 && raw.hands !== 2) {
      fail(`items.${itemKey}.hands must be 1 or 2.`);
    }
    hands = raw.hands;
  }
  if (hands === 2 && equipmentSlots.includes('offHand') && !equipmentSlots.includes('mainHand')) {
    fail(`items.${itemKey}: two-handed items cannot be off-hand-only.`);
  }

  if (raw.category === 'consumable') {
    if (typeof raw.action !== 'string' || raw.action.trim().length === 0) {
      fail(`items.${itemKey}.action is required for consumables.`);
    }
    if (options.requireActions && options.knownActions && !options.knownActions.has(raw.action)) {
      fail(`items.${itemKey}.action "${raw.action}" is not registered.`);
    }
  }

  return Object.freeze({
    key: itemKey,
    label: raw.label.trim(),
    category: raw.category,
    icon: raw.icon.trim(),
    stackLimit: raw.stackLimit,
    equipmentSlots,
    weaponType: typeof raw.weaponType === 'string' ? raw.weaponType : null,
    hands,
    action: typeof raw.action === 'string' ? raw.action : null,
    value: raw.value,
    weight: raw.weight,
    rarity: raw.rarity,
    tags: normalizeTags(raw.tags, itemKey),
  });
}

/**
 * Validate a YAML/document payload shaped as `{ items: { key: def, ... } }`.
 * @returns {ReadonlyMap<string, object>}
 */
export function createItemDefinitions(document, options = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    fail('document must be an object.');
  }
  const items = document.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    fail('"items" must be an object keyed by item id.');
  }

  const definitions = new Map();
  for (const [itemKey, raw] of Object.entries(items)) {
    if (definitions.has(itemKey)) {
      fail(`duplicate item key "${itemKey}".`);
    }
    definitions.set(itemKey, normalizeItemDefinition(itemKey, raw, options));
  }
  return definitions;
}
