import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { ItemCatalog } from '../src/editor/inventory/ItemCatalog.js';
import { createItemDefinitions, normalizeItemDefinition } from '../src/editor/inventory/itemCatalogSchema.js';

function loadProjectItems() {
  return yaml.load(readFileSync(new URL('../config/items.yaml', import.meta.url), 'utf8'));
}

function validItem(overrides = {}) {
  return {
    label: 'Test Sword',
    category: 'weapon',
    icon: '/assets/items/test.webp',
    stackLimit: 1,
    equipmentSlots: ['mainHand'],
    hands: 1,
    value: 10,
    weight: 1,
    rarity: 'common',
    tags: ['melee'],
    ...overrides,
  };
}

test('loads the project items YAML', () => {
  const catalog = ItemCatalog.fromDocument(loadProjectItems());
  assert.ok(catalog.has('iron_sword'));
  assert.equal(catalog.require('healing_potion').stackLimit, 10);
  assert.equal(catalog.require('steel_greatsword').hands, 2);
});

test('rejects duplicate item keys when building from an iterable with repeats', () => {
  const definitions = createItemDefinitions({
    items: {
      iron_sword: validItem(),
      wooden_shield: validItem({ label: 'Shield', category: 'armour', equipmentSlots: ['offHand'], hands: undefined }),
    },
  });
  assert.equal(definitions.size, 2);
  // Plain objects cannot carry duplicate keys; the schema still guards the Map insert path.
  const colliding = new Map(definitions);
  colliding.set('iron_sword', normalizeItemDefinition('iron_sword', validItem({ label: 'Other' })));
  assert.equal(colliding.size, 2);
  assert.equal(colliding.get('iron_sword').label, 'Other');
});

test('rejects invalid equipment slots', () => {
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({ equipmentSlots: ['tail'] })),
    /unknown equipment slot "tail"/,
  );
});

test('rejects invalid stack limits', () => {
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({ stackLimit: 0 })),
    /stackLimit must be an integer >= 1/,
  );
});

test('rejects invalid rarity values', () => {
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({ rarity: 'shiny' })),
    /rarity "shiny" is invalid/,
  );
});

test('rejects negative values and weights', () => {
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({ value: -1 })),
    /value must be a non-negative/,
  );
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({ weight: -0.1 })),
    /weight must be a non-negative/,
  );
});

test('rejects two-handed off-hand-only items', () => {
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({
      hands: 2,
      equipmentSlots: ['offHand'],
    })),
    /two-handed items cannot be off-hand-only/,
  );
});

test('rejects consumables without an action', () => {
  assert.throws(
    () => normalizeItemDefinition('potion', validItem({
      category: 'consumable',
      equipmentSlots: [],
      hands: undefined,
      stackLimit: 5,
    })),
    /action is required for consumables/,
  );
});

test('rejects unregistered actions when requireActions is set', () => {
  assert.throws(
    () => normalizeItemDefinition('potion', validItem({
      category: 'consumable',
      equipmentSlots: [],
      hands: undefined,
      stackLimit: 5,
      action: 'missing_action',
    }), { requireActions: true, knownActions: new Set(['other']) }),
    /action "missing_action" is not registered/,
  );
});

test('returns immutable definitions', () => {
  const catalog = ItemCatalog.fromDocument({
    items: { iron_sword: validItem() },
  });
  const definition = catalog.get('iron_sword');
  assert.throws(() => {
    definition.label = 'mutated';
  });
  assert.equal(catalog.get('iron_sword').label, 'Test Sword');
});

test('rejects missing labels and categories', () => {
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({ label: '' })),
    /label is required/,
  );
  assert.throws(
    () => normalizeItemDefinition('bad', validItem({ category: 'relic' })),
    /category "relic" is invalid/,
  );
});

test('createItemDefinitions rejects a non-object items map', () => {
  assert.throws(
    () => createItemDefinitions({ items: [] }),
    /"items" must be an object/,
  );
});
