/** Inventory document and slot contracts shared by store, catalogue, and UI. */

export const INVENTORY_DOCUMENT_VERSION = 1;

export const DEFAULT_BAG_CAPACITY = 40;

export const ITEM_CATEGORIES = Object.freeze([
  'weapon',
  'armour',
  'accessory',
  'consumable',
  'misc',
]);

export const ITEM_RARITIES = Object.freeze([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]);

export const ARMOUR_SLOTS = Object.freeze([
  'head',
  'chest',
  'hands',
  'legs',
  'feet',
]);

export const ACCESSORY_SLOTS = Object.freeze([
  'neck',
  'ring1',
  'ring2',
  'cloak',
]);

export const WEAPON_HAND_SLOTS = Object.freeze(['mainHand', 'offHand']);

export const WEAPON_SET_IDS = Object.freeze([1, 2]);

/** Flat list of every equippable slot id used in item definitions. */
export const EQUIPMENT_SLOT_IDS = Object.freeze([
  ...ARMOUR_SLOTS,
  ...ACCESSORY_SLOTS,
  ...WEAPON_HAND_SLOTS,
]);

export const LOCATION_KINDS = Object.freeze({
  bag: 'bag',
  equipment: 'equipment',
  weapon: 'weapon',
});

export function createEmptyEquipment() {
  return {
    armour: Object.fromEntries(ARMOUR_SLOTS.map((slot) => [slot, null])),
    accessories: Object.fromEntries(ACCESSORY_SLOTS.map((slot) => [slot, null])),
    weaponSets: {
      set1: { mainHand: null, offHand: null },
      set2: { mainHand: null, offHand: null },
    },
  };
}

export function createEmptyInventoryState({
  capacity = DEFAULT_BAG_CAPACITY,
  gold = 0,
  activeWeaponSet = 1,
} = {}) {
  return {
    version: INVENTORY_DOCUMENT_VERSION,
    capacity,
    bagSlots: Array.from({ length: capacity }, () => null),
    equipment: createEmptyEquipment(),
    activeWeaponSet,
    currency: { gold },
  };
}

export function weaponSetKey(setId) {
  return `set${setId}`;
}
