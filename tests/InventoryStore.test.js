import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { ItemCatalog } from '../src/editor/inventory/ItemCatalog.js';
import { InventoryStore } from '../src/editor/inventory/InventoryStore.js';

function catalog() {
  return ItemCatalog.fromDocument(
    yaml.load(readFileSync(new URL('../config/items.yaml', import.meta.url), 'utf8')),
  );
}

function store(capacity = 40) {
  return new InventoryStore(catalog(), null, { capacity });
}

test('adds a non-stackable item', () => {
  const inventory = store();
  const result = inventory.addItem('iron_sword', 1);
  assert.equal(result.ok, true);
  assert.equal(result.accepted, 1);
  assert.equal(inventory.getState().bagSlots[0].itemKey, 'iron_sword');
  assert.ok(inventory.getState().bagSlots[0].instanceId);
});

test('adds and merges stackable items', () => {
  const inventory = store();
  assert.equal(inventory.addItem('healing_potion', 3).ok, true);
  assert.equal(inventory.addItem('healing_potion', 2).ok, true);
  assert.equal(inventory.getState().bagSlots[0].quantity, 5);
  assert.equal(inventory.getState().bagSlots[1], null);
});

test('rejects incompatible metadata merges', () => {
  const inventory = store();
  inventory.addItem('healing_potion', 2, { metadata: { batch: 'a' } });
  inventory.addItem('healing_potion', 2, { metadata: { batch: 'b' } });
  const state = inventory.getState();
  assert.equal(state.bagSlots[0].quantity, 2);
  assert.equal(state.bagSlots[1].quantity, 2);
  assert.notEqual(state.bagSlots[0].metadata.batch, state.bagSlots[1].metadata.batch);
});

test('reports partial additions when capacity is reached', () => {
  const inventory = store(2);
  inventory.addItem('iron_sword', 1);
  inventory.addItem('wooden_shield', 1);
  const result = inventory.addItem('torch', 5);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'inventory_full');
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 5);
});

test('partially accepts stackable items into remaining space', () => {
  const inventory = store(2);
  inventory.addItem('torch', 20);
  const result = inventory.addItem('torch', 25);
  assert.equal(result.ok, true);
  assert.equal(result.accepted, 20);
  assert.equal(result.rejected, 5);
});

test('removes exact quantities and prevents negative quantities', () => {
  const inventory = store();
  inventory.addItem('healing_potion', 5);
  assert.equal(inventory.removeItem('healing_potion', 3).ok, true);
  assert.equal(inventory.getState().bagSlots[0].quantity, 2);
  assert.equal(inventory.removeItem('healing_potion', 5).ok, false);
  assert.equal(inventory.removeItem('healing_potion', 0).code, 'invalid_quantity');
});

test('splits stacks correctly without losing quantity', () => {
  const inventory = store();
  inventory.addItem('healing_potion', 6);
  const result = inventory.splitStack({ kind: 'bag', index: 0 }, 2);
  assert.equal(result.ok, true);
  const state = inventory.getState();
  assert.equal(state.bagSlots[0].quantity, 4);
  assert.equal(state.bagSlots[1].quantity, 2);
  assert.equal(state.bagSlots[0].quantity + state.bagSlots[1].quantity, 6);
});

test('swaps bag entries', () => {
  const inventory = store();
  inventory.addItem('iron_sword', 1);
  inventory.addItem('wooden_shield', 1);
  assert.equal(inventory.swapItems({ kind: 'bag', index: 0 }, { kind: 'bag', index: 1 }).ok, true);
  const state = inventory.getState();
  assert.equal(state.bagSlots[0].itemKey, 'wooden_shield');
  assert.equal(state.bagSlots[1].itemKey, 'iron_sword');
});

test('equips compatible items and rejects incompatible equipment', () => {
  const inventory = store();
  inventory.addItem('iron_sword', 1);
  inventory.addItem('leather_armour', 1);
  assert.equal(inventory.equipItem({ kind: 'bag', index: 0 }).ok, true);
  assert.equal(
    inventory.getState().equipment.weaponSets.set1.mainHand.itemKey,
    'iron_sword',
  );
  const armourIndex = inventory.getState().bagSlots.findIndex((slot) => slot?.itemKey === 'leather_armour');
  const bad = inventory.moveItem(
    { kind: 'bag', index: armourIndex },
    { kind: 'weapon', set: 1, slot: 'mainHand' },
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'incompatible_equipment');
});

test('handles two-handed weapons by clearing the off-hand', () => {
  const inventory = store();
  inventory.addItem('iron_sword', 1);
  inventory.addItem('wooden_shield', 1);
  inventory.addItem('steel_greatsword', 1);
  inventory.equipItem({ kind: 'bag', index: 0 }, { slot: 'mainHand' });
  inventory.equipItem({ kind: 'bag', index: 1 }, { slot: 'offHand' });
  assert.equal(inventory.getState().equipment.weaponSets.set1.offHand.itemKey, 'wooden_shield');

  const greatswordIndex = inventory.getState().bagSlots.findIndex((slot) => slot?.itemKey === 'steel_greatsword');
  const result = inventory.equipItem({ kind: 'bag', index: greatswordIndex }, { slot: 'mainHand' });
  assert.equal(result.ok, true);
  const state = inventory.getState();
  assert.equal(state.equipment.weaponSets.set1.mainHand.itemKey, 'steel_greatsword');
  assert.equal(state.equipment.weaponSets.set1.offHand, null);
  assert.ok(state.bagSlots.some((slot) => slot?.itemKey === 'wooden_shield'));
});

test('rolls back failed unequip when the bag is full', () => {
  const inventory = store(1);
  inventory.addItem('iron_sword', 1);
  inventory.equipItem({ kind: 'bag', index: 0 });
  inventory.addItem('wooden_shield', 1);
  const before = inventory.toDocument();
  const result = inventory.unequipItem({ kind: 'weapon', set: 1, slot: 'mainHand' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'inventory_full');
  assert.deepEqual(inventory.toDocument(), before);
});

test('switches active weapon sets', () => {
  const inventory = store();
  assert.equal(inventory.switchWeaponSet(2).ok, true);
  assert.equal(inventory.getState().activeWeaponSet, 2);
  assert.equal(inventory.switchWeaponSet(3).ok, false);
});

test('prevents negative gold', () => {
  const inventory = store();
  assert.equal(inventory.setGold(10).ok, true);
  assert.equal(inventory.removeGold(4).ok, true);
  assert.equal(inventory.getState().currency.gold, 6);
  assert.equal(inventory.removeGold(10).code, 'insufficient_gold');
  assert.equal(inventory.setGold(-1).code, 'invalid_gold');
});

test('serialises and restores exactly', () => {
  const inventory = store();
  inventory.applyStartingLoadout(
    yaml.load(readFileSync(new URL('../config/player-starting-loadout.yaml', import.meta.url), 'utf8')),
  );
  inventory.equipItem({ kind: 'bag', index: 0 });
  inventory.switchWeaponSet(2);
  const document = inventory.toDocument();
  const restored = new InventoryStore(catalog(), document);
  assert.deepEqual(restored.toDocument(), document);
});

test('rejects unknown item keys during document load', () => {
  const inventory = store();
  inventory.addItem('iron_sword', 1);
  const before = inventory.toDocument();
  assert.throws(
    () => inventory.replaceDocument({
      ...before,
      bagSlots: [{ itemKey: 'missing_relic', quantity: 1 }],
    }),
    /unknown item key/,
  );
  assert.deepEqual(inventory.toDocument(), before);
});

test('emits one coherent change notification per transaction', () => {
  const inventory = store();
  const events = [];
  inventory.subscribe((change) => events.push(change));
  inventory.addItem('healing_potion', 3);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'add');
  assert.equal(events[0].after.bagSlots[0].quantity, 3);
  assert.equal(events[0].before.bagSlots[0], null);
});

test('getState returns clones so consumers cannot mutate the store', () => {
  const inventory = store();
  inventory.addItem('iron_sword', 1);
  const state = inventory.getState();
  state.bagSlots[0] = null;
  state.currency.gold = 999;
  assert.equal(inventory.getState().bagSlots[0].itemKey, 'iron_sword');
  assert.equal(inventory.getState().currency.gold, 0);
});
