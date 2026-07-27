import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { InventoryController } from '../src/editor/inventory/InventoryController.js';
import { InventoryStore } from '../src/editor/inventory/InventoryStore.js';
import { ItemCatalog } from '../src/editor/inventory/ItemCatalog.js';
import { bagLocation, weaponLocation } from '../src/editor/inventory/inventoryLocations.js';

function createController() {
  const catalog = ItemCatalog.fromDocument(
    yaml.load(readFileSync(new URL('../config/items.yaml', import.meta.url), 'utf8')),
  );
  const store = new InventoryStore(catalog, null, { capacity: 40 });
  store.addItem('iron_sword', 1);
  store.addItem('healing_potion', 3);
  store.addItem('wooden_shield', 1);
  const controller = new InventoryController({ store, catalog });
  return { controller, store };
}

test('selects a slot', () => {
  const { controller } = createController();
  controller.selectLocation(bagLocation(0));
  assert.deepEqual(controller.getViewState().selectedLocation, bagLocation(0));
  controller.dispose();
});

test('cancels drag', () => {
  const { controller } = createController();
  assert.equal(controller.beginDrag(bagLocation(0)).ok, true);
  assert.ok(controller.getViewState().drag);
  controller.cancelDrag();
  assert.equal(controller.getViewState().drag, null);
  controller.dispose();
});

test('commits a valid move', () => {
  const { controller, store } = createController();
  controller.beginDrag(bagLocation(0));
  const result = controller.dropOn(bagLocation(5));
  assert.equal(result.ok, true);
  assert.equal(store.getState().bagSlots[5].itemKey, 'iron_sword');
  assert.equal(store.getState().bagSlots[0], null);
  assert.equal(controller.getViewState().drag, null);
  controller.dispose();
});

test('rejects an invalid drop', () => {
  const { controller, store } = createController();
  const before = store.toDocument();
  controller.beginDrag(bagLocation(1)); // potion
  const result = controller.dropOn(weaponLocation(1, 'mainHand'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'incompatible_equipment');
  assert.deepEqual(store.toDocument(), before);
  controller.dispose();
});

test('cancels drag on close', () => {
  const { controller } = createController();
  controller.open();
  controller.beginDrag(bagLocation(0));
  controller.close();
  assert.equal(controller.getViewState().drag, null);
  assert.equal(controller.isOpen, false);
  controller.dispose();
});

test('switches weapon sets', () => {
  const { controller, store } = createController();
  assert.equal(controller.switchWeaponSet(2).ok, true);
  assert.equal(store.getState().activeWeaponSet, 2);
  controller.dispose();
});

test('does not mutate the store directly', () => {
  const { controller, store } = createController();
  const state = controller.getViewState().inventory;
  state.bagSlots[0] = null;
  assert.equal(store.getState().bagSlots[0].itemKey, 'iron_sword');
  controller.dispose();
});

test('Escape cancels drag before closing', () => {
  const { controller } = createController();
  controller.open();
  controller.beginDrag(bagLocation(0));
  assert.equal(controller.handleEscape(), true);
  assert.equal(controller.getViewState().drag, null);
  assert.equal(controller.isOpen, true);
  controller.dispose();
});

test('double-activate equips from the bag', () => {
  const { controller, store } = createController();
  const result = controller.doubleActivate(bagLocation(0));
  assert.equal(result.ok, true);
  assert.equal(store.getState().equipment.weaponSets.set1.mainHand.itemKey, 'iron_sword');
  controller.dispose();
});

test('dropOn clears drag before store subscribers observe the move', () => {
  const { controller, store } = createController();
  const frames = [];
  controller.subscribe((state) => {
    frames.push({
      drag: state.drag,
      slot0: state.inventory.bagSlots[0]?.itemKey ?? null,
      slot5: state.inventory.bagSlots[5]?.itemKey ?? null,
    });
  });
  frames.length = 0;
  controller.beginDrag(bagLocation(0));
  frames.length = 0;
  const result = controller.dropOn(bagLocation(5));
  assert.equal(result.ok, true);
  assert.ok(frames.length >= 1);
  for (const frame of frames) {
    if (frame.slot5 === 'iron_sword') {
      assert.equal(frame.drag, null, 'drag must already be clear when the move is visible');
    }
  }
  assert.equal(store.getState().bagSlots[5].itemKey, 'iron_sword');
  controller.dispose();
});

test('double-activate on a consumable stages use without consuming', () => {
  const { controller, store } = createController();
  const potionIndex = store.getState().bagSlots.findIndex((slot) => slot?.itemKey === 'healing_potion');
  const before = store.getState().bagSlots[potionIndex].quantity;
  const result = controller.doubleActivate(bagLocation(potionIndex));
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.ok(result.token?.operationId);
  assert.equal(store.getState().bagSlots[potionIndex].quantity, before);
  assert.equal(store.confirmUse(result.token).ok, true);
  assert.equal(store.getState().bagSlots[potionIndex].quantity, before - 1);
  controller.dispose();
});
