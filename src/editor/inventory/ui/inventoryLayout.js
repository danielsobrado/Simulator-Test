import { equipmentLocation } from '../inventoryLocations.js';

/**
 * Static description of the inventory panel: which slots exist, where they sit in the
 * paper-doll grid, and how they read to a screen reader. Pure data with no DOM, so the
 * layout can be reasoned about and tested without a browser.
 */

/**
 * Bag columns on a desktop viewport. The store's default capacity is 40, so ten columns
 * fill exactly four rows. The narrow breakpoint in inventory.css halves this to five.
 */
export const BAG_GRID_COLUMNS = 10;

/**
 * Fallback glyphs drawn in the slot well when an item icon is missing or has not been
 * authored yet. Keyed by item category so a new item is never a blank square.
 */
export const CATEGORY_GLYPHS = Object.freeze({
  weapon: '⚔',
  armour: '⛨',
  accessory: '◈',
  consumable: '⚱',
  misc: '✦',
});

/** Glyph shown in an empty equipment slot, hinting at what belongs there. */
const SLOT_GLYPHS = Object.freeze({
  head: '⛑',
  chest: '⛨',
  hands: '✋',
  legs: '⫙',
  feet: '⍓',
  neck: '◈',
  ring1: '◯',
  ring2: '◯',
  cloak: '⌇',
  mainHand: '⚔',
  offHand: '⛉',
});

/**
 * Equipment slots in the character panel, laid out to mirror a worn figure. `area` is the
 * CSS grid-area name used by inventory.css; `size` selects the well's footprint.
 *
 * The two weapon slots are deliberately absent here — they belong to a weapon set rather
 * than the body, and are described by WEAPON_SLOT_DESCRIPTORS below.
 */
export const EQUIPMENT_SLOT_DESCRIPTORS = Object.freeze([
  { slot: 'head', label: 'Head', area: 'head', size: 'small' },
  { slot: 'neck', label: 'Neck', area: 'neck', size: 'small' },
  { slot: 'chest', label: 'Chest', area: 'chest', size: 'large' },
  { slot: 'hands', label: 'Hands', area: 'hands', size: 'small' },
  { slot: 'ring1', label: 'Ring I', area: 'ring1', size: 'small' },
  { slot: 'legs', label: 'Legs', area: 'legs', size: 'small' },
  { slot: 'ring2', label: 'Ring II', area: 'ring2', size: 'small' },
  { slot: 'feet', label: 'Feet', area: 'feet', size: 'small' },
  { slot: 'cloak', label: 'Cloak', area: 'cloak', size: 'small' },
].map((descriptor) => Object.freeze({
  ...descriptor,
  glyph: SLOT_GLYPHS[descriptor.slot] ?? '·',
  location: equipmentLocation(descriptor.slot),
})));

/**
 * The active weapon set's two hands. These flank the character panel and are rebound to a
 * different set when the I / II tabs switch `activeWeaponSet`, so their location is built
 * per render rather than frozen here.
 */
export const WEAPON_SLOT_DESCRIPTORS = Object.freeze([
  Object.freeze({ slot: 'mainHand', label: 'Main hand', area: 'main-hand', size: 'tall', glyph: SLOT_GLYPHS.mainHand }),
  Object.freeze({ slot: 'offHand', label: 'Off hand', area: 'off-hand', size: 'tall', glyph: SLOT_GLYPHS.offHand }),
]);

/** Roman numerals for the weapon set tabs, matching the reference panel's I / II. */
export function weaponSetLabel(setId) {
  return setId === 1 ? 'I' : 'II';
}

/**
 * Accessible name for a slot, e.g. "Chest — Leather Armour" or "Chest — empty".
 * Rarity is spoken as well as coloured so it is never conveyed by colour alone.
 */
export function describeSlot(slotLabel, definition, quantity) {
  if (!definition) return `${slotLabel} — empty`;
  const parts = [`${slotLabel} — ${definition.label}`];
  if (quantity > 1) parts.push(`×${quantity}`);
  if (definition.rarity && definition.rarity !== 'common') parts.push(definition.rarity);
  return parts.join(', ');
}
