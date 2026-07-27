import {
  ACCESSORY_SLOTS,
  ARMOUR_SLOTS,
  DEFAULT_BAG_CAPACITY,
  INVENTORY_DOCUMENT_VERSION,
  WEAPON_HAND_SLOTS,
  WEAPON_SET_IDS,
  createEmptyEquipment,
  createEmptyInventoryState,
  weaponSetKey,
} from './inventoryConstants.js';
import { cloneInventoryEntry, createInventoryEntry } from './InventoryEntry.js';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail('invalid_document', `${label} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    fail('invalid_document', `${label} must be an integer >= 1.`);
  }
}

function normalizeEntry(raw, catalog, path) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('invalid_document', `${path} must be an entry object or null.`);
  }
  if (typeof raw.itemKey !== 'string' || !catalog.has(raw.itemKey)) {
    fail('unknown_item', `${path} references unknown item key "${raw.itemKey}".`);
  }
  const definition = catalog.require(raw.itemKey);
  assertPositiveInteger(raw.quantity, `${path}.quantity`);
  if (raw.quantity > definition.stackLimit) {
    fail('invalid_document', `${path}.quantity exceeds stackLimit.`);
  }
  return createInventoryEntry({
    itemKey: raw.itemKey,
    quantity: raw.quantity,
    instanceId: raw.instanceId ?? null,
    metadata: raw.metadata,
    stackLimit: definition.stackLimit,
  });
}

function assertEquippedEntry(entry, slot, path, catalog) {
  if (entry == null) return;
  if (entry.quantity !== 1) {
    fail('invalid_document', `${path} must have quantity 1.`);
  }
  const definition = catalog.require(entry.itemKey);
  if (!definition.equipmentSlots.includes(slot)) {
    fail(
      'invalid_document',
      `${path} item "${entry.itemKey}" cannot occupy slot "${slot}".`,
    );
  }
}

function normalizeWeaponSet(raw, catalog, path) {
  const set = { mainHand: null, offHand: null };
  if (raw == null) return set;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail('invalid_document', `${path} must be an object.`);
  }
  for (const slot of WEAPON_HAND_SLOTS) {
    set[slot] = normalizeEntry(raw[slot] ?? null, catalog, `${path}.${slot}`);
    assertEquippedEntry(set[slot], slot, `${path}.${slot}`, catalog);
  }
  if (set.mainHand && catalog.isTwoHanded(set.mainHand.itemKey) && set.offHand) {
    fail(
      'invalid_document',
      `${path}: two-handed main hand cannot share the set with an off-hand item.`,
    );
  }
  return set;
}

function collectInstanceIds(state, into) {
  for (const entry of state.bagSlots) {
    if (entry?.instanceId) into.push({ id: entry.instanceId, path: 'bag' });
  }
  for (const slot of ARMOUR_SLOTS) {
    const entry = state.equipment.armour[slot];
    if (entry?.instanceId) into.push({ id: entry.instanceId, path: `armour.${slot}` });
  }
  for (const slot of ACCESSORY_SLOTS) {
    const entry = state.equipment.accessories[slot];
    if (entry?.instanceId) into.push({ id: entry.instanceId, path: `accessories.${slot}` });
  }
  for (const setId of WEAPON_SET_IDS) {
    const setKey = weaponSetKey(setId);
    for (const slot of WEAPON_HAND_SLOTS) {
      const entry = state.equipment.weaponSets[setKey][slot];
      if (entry?.instanceId) {
        into.push({ id: entry.instanceId, path: `weaponSets.${setKey}.${slot}` });
      }
    }
  }
}

/**
 * Validate and normalize an inventory document against a catalogue.
 * Returns a deep-cloned, padded state ready for InventoryStore.replaceDocument.
 */
export function normalizeInventoryDocument(document, catalog, {
  defaultCapacity = DEFAULT_BAG_CAPACITY,
} = {}) {
  if (document == null) {
    return createEmptyInventoryState({ capacity: defaultCapacity });
  }
  if (typeof document !== 'object' || Array.isArray(document)) {
    fail('invalid_document', 'Inventory document must be an object.');
  }

  const version = document.version ?? INVENTORY_DOCUMENT_VERSION;
  assertPositiveInteger(version, 'version');
  if (version > INVENTORY_DOCUMENT_VERSION) {
    fail('unsupported_version', `Unsupported inventory version ${version}.`);
  }

  const capacity = document.capacity ?? defaultCapacity;
  assertPositiveInteger(capacity, 'capacity');

  const bagSource = Array.isArray(document.bagSlots) ? document.bagSlots : [];
  if (bagSource.length > capacity) {
    fail('invalid_document', 'bagSlots length exceeds capacity.');
  }
  const bagSlots = Array.from({ length: capacity }, (_, index) => (
    normalizeEntry(bagSource[index] ?? null, catalog, `bagSlots[${index}]`)
  ));

  const equipmentSource = document.equipment ?? {};
  const equipment = createEmptyEquipment();
  const armourSource = equipmentSource.armour ?? {};
  for (const slot of ARMOUR_SLOTS) {
    equipment.armour[slot] = normalizeEntry(
      armourSource[slot] ?? null,
      catalog,
      `equipment.armour.${slot}`,
    );
    assertEquippedEntry(
      equipment.armour[slot],
      slot,
      `equipment.armour.${slot}`,
      catalog,
    );
  }
  const accessorySource = equipmentSource.accessories ?? {};
  for (const slot of ACCESSORY_SLOTS) {
    equipment.accessories[slot] = normalizeEntry(
      accessorySource[slot] ?? null,
      catalog,
      `equipment.accessories.${slot}`,
    );
    assertEquippedEntry(
      equipment.accessories[slot],
      slot,
      `equipment.accessories.${slot}`,
      catalog,
    );
  }
  const weaponSetsSource = equipmentSource.weaponSets ?? {};
  for (const setId of WEAPON_SET_IDS) {
    const key = weaponSetKey(setId);
    equipment.weaponSets[key] = normalizeWeaponSet(
      weaponSetsSource[key] ?? null,
      catalog,
      `equipment.weaponSets.${key}`,
    );
  }

  const activeWeaponSet = document.activeWeaponSet ?? 1;
  if (!WEAPON_SET_IDS.includes(activeWeaponSet)) {
    fail('invalid_document', `activeWeaponSet must be one of ${WEAPON_SET_IDS.join(', ')}.`);
  }

  const gold = document.currency?.gold ?? 0;
  assertNonNegativeInteger(gold, 'currency.gold');

  const state = {
    version: INVENTORY_DOCUMENT_VERSION,
    capacity,
    bagSlots,
    equipment,
    activeWeaponSet,
    currency: { gold },
  };

  const instanceRefs = [];
  collectInstanceIds(state, instanceRefs);
  const seen = new Set();
  for (const ref of instanceRefs) {
    if (seen.has(ref.id)) {
      fail('invalid_document', `Duplicate instanceId "${ref.id}".`);
    }
    seen.add(ref.id);
  }

  return state;
}

/**
 * Validate the complete equipment configuration of a live/draft state.
 * Used after move planning so both directions of a swap are checked.
 */
export function validateEquipmentState(state, catalog) {
  for (const slot of ARMOUR_SLOTS) {
    const entry = state.equipment.armour[slot];
    if (!entry) continue;
    if (entry.quantity !== 1) {
      return failResult('invalid_quantity', `Equipment slot "${slot}" must hold quantity 1.`);
    }
    if (!catalog.canEquipInSlot(entry.itemKey, slot)) {
      return failResult('incompatible_equipment', `Item cannot occupy slot "${slot}".`);
    }
  }
  for (const slot of ACCESSORY_SLOTS) {
    const entry = state.equipment.accessories[slot];
    if (!entry) continue;
    if (entry.quantity !== 1) {
      return failResult('invalid_quantity', `Equipment slot "${slot}" must hold quantity 1.`);
    }
    if (!catalog.canEquipInSlot(entry.itemKey, slot)) {
      return failResult('incompatible_equipment', `Item cannot occupy slot "${slot}".`);
    }
  }
  for (const setId of WEAPON_SET_IDS) {
    const setKey = weaponSetKey(setId);
    const set = state.equipment.weaponSets[setKey];
    for (const slot of WEAPON_HAND_SLOTS) {
      const entry = set[slot];
      if (!entry) continue;
      if (entry.quantity !== 1) {
        return failResult('invalid_quantity', `Weapon slot "${setKey}.${slot}" must hold quantity 1.`);
      }
      if (!catalog.canEquipInSlot(entry.itemKey, slot)) {
        return failResult(
          'incompatible_equipment',
          `Item cannot occupy weapon slot "${setKey}.${slot}".`,
        );
      }
    }
    if (set.mainHand && catalog.isTwoHanded(set.mainHand.itemKey) && set.offHand) {
      return failResult(
        'incompatible_equipment',
        'Two-handed main hand cannot share a set with an off-hand item.',
      );
    }
  }
  return okResult();
}

export function cloneInventoryState(state) {
  return {
    version: state.version,
    capacity: state.capacity,
    bagSlots: state.bagSlots.map(cloneInventoryEntry),
    equipment: {
      armour: Object.fromEntries(
        Object.entries(state.equipment.armour).map(([slot, entry]) => [slot, cloneInventoryEntry(entry)]),
      ),
      accessories: Object.fromEntries(
        Object.entries(state.equipment.accessories).map(([slot, entry]) => [slot, cloneInventoryEntry(entry)]),
      ),
      weaponSets: Object.fromEntries(
        WEAPON_SET_IDS.map((setId) => {
          const key = weaponSetKey(setId);
          const set = state.equipment.weaponSets[key];
          return [key, {
            mainHand: cloneInventoryEntry(set.mainHand),
            offHand: cloneInventoryEntry(set.offHand),
          }];
        }),
      ),
    },
    activeWeaponSet: state.activeWeaponSet,
    currency: { gold: state.currency.gold },
  };
}

export function okResult(extra = {}) {
  return { ok: true, ...extra };
}

export function failResult(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

export function entryMatchesStaged(entry, staged) {
  if (!entry || !staged) return false;
  if (entry.itemKey !== staged.itemKey) return false;
  if ((entry.instanceId ?? null) !== (staged.instanceId ?? null)) return false;
  if (entry.quantity < staged.quantity) return false;
  return true;
}
