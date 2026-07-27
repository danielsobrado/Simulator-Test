import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { InventoryStore } from '../src/editor/inventory/InventoryStore.js';
import { ItemCatalog } from '../src/editor/inventory/ItemCatalog.js';
import { TerrainAwareEditorController } from '../src/editor/TerrainAwareEditorController.js';
import { ObjectMap } from '../src/editor/ObjectMap.js';
import { VoxelStampStore } from '../src/editor/voxel/VoxelStampStore.js';
import { ChunkedHeightField } from '../src/editor/world/ChunkedHeightField.js';
import { ChunkedTileMap } from '../src/editor/world/ChunkedTileMap.js';
import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { INFINITE_WORLD_FORMAT_VERSION } from '../src/editor/world/worldConstants.js';

const catalog = [{
  key: 'tree',
  label: 'Tree',
  footprint: { width: 1, depth: 1 },
  allowedTileIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
}];

function installDomGlobals() {
  const listeners = new Map();
  const target = {
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((entry) => entry !== handler));
    },
  };
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window')
      ? globalThis.window
      : undefined,
    document: Object.prototype.hasOwnProperty.call(globalThis, 'document')
      ? globalThis.document
      : undefined,
    hadWindow: Object.prototype.hasOwnProperty.call(globalThis, 'window'),
    hadDocument: Object.prototype.hasOwnProperty.call(globalThis, 'document'),
  };
  globalThis.window = target;
  globalThis.document = {
    ...target,
    exitPointerLock() {},
    pointerLockElement: null,
  };
  return () => {
    if (previous.hadWindow) globalThis.window = previous.window;
    else delete globalThis.window;
    if (previous.hadDocument) globalThis.document = previous.document;
    else delete globalThis.document;
  };
}

function itemCatalog() {
  return ItemCatalog.fromDocument(
    yaml.load(readFileSync(new URL('../config/items.yaml', import.meta.url), 'utf8')),
  );
}

function createCanvas() {
  return {
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    style: {},
    width: 100,
    height: 100,
  };
}

function createHarness() {
  const restore = installDomGlobals();
  const worldStore = new InfiniteWorldStore({
    chunkSize: 4,
    tileSize: 2,
    cacheLimit: 16,
    generator: new ProceduralWorldGenerator({ seed: 42 }),
  });
  const tileMap = new ChunkedTileMap({ worldStore, defaultTileId: 0 });
  const heightField = new ChunkedHeightField({ worldStore });
  const objectMap = new ObjectMap({ tileMap, objectCatalog: catalog });
  const voxelStampStore = new VoxelStampStore({ cells: [16, 8, 16], maxStamps: 8 });
  const inventoryStore = new InventoryStore(itemCatalog(), null, { capacity: 40 });
  inventoryStore.addItem('iron_sword', 1);
  inventoryStore.addItem('healing_potion', 3);
  inventoryStore.setGold(40);

  const terrainView = {
    renderer: { domElement: createCanvas() },
    refreshAll() {},
    updatePatch() {},
    updateHeightPatch() {},
    floatingOrigin: null,
  };
  const objectView = {
    refresh() {},
    setSelection() {},
    setHover() {},
    setPlacementPreview() {},
  };
  const editorCamera = { getFocusWorld: () => ({ x: 0, z: 0 }) };

  const controller = new TerrainAwareEditorController({
    tileMap,
    heightField,
    worldStore,
    objectMap,
    terrainView,
    objectView,
    editorCamera,
    objectCatalog: catalog,
    brushSizes: [1, 2],
    defaultBrushSize: 1,
    terrainConfig: { minHeight: -4, maxHeight: 4 },
    voxelStampStore,
    inventoryStore,
  });

  controller.validateLoadedObjectSurfaces = () => {};
  controller.refreshObjects = () => {};

  return {
    controller,
    inventoryStore,
    worldStore,
    tileMap,
    dispose() {
      controller.dispose?.();
      restore();
    },
  };
}

test('inventory round-trips through the world document', () => {
  const harness = createHarness();
  const { controller, inventoryStore } = harness;
  inventoryStore.equipItem({ kind: 'bag', index: 0 });
  inventoryStore.switchWeaponSet(2);
  const document = controller.toDocument();
  assert.equal(document.playerState.inventory.activeWeaponSet, 2);
  assert.equal(document.playerState.inventory.currency.gold, 40);

  const freshStore = new InventoryStore(itemCatalog(), null, { capacity: 40 });
  freshStore.addItem('torch', 1);
  controller.inventoryStore = freshStore;
  controller.loadDocument(document);
  assert.deepEqual(
    freshStore.toDocument(),
    document.playerState.inventory,
  );
  harness.dispose();
});

test('older version-6 world documents without playerState default to empty inventory', () => {
  const harness = createHarness();
  const { controller, inventoryStore } = harness;
  const document = controller.toDocument();
  delete document.playerState;
  document.version = INFINITE_WORLD_FORMAT_VERSION;
  controller.loadDocument(document);
  assert.equal(inventoryStore.getState().currency.gold, 0);
  assert.ok(inventoryStore.getState().bagSlots.every((slot) => slot == null));
  harness.dispose();
});

test('invalid inventory rejects the complete load and restores prior inventory', () => {
  const harness = createHarness();
  const { controller, inventoryStore } = harness;
  const before = inventoryStore.toDocument();
  const document = controller.toDocument();
  document.playerState.inventory.bagSlots[0] = { itemKey: 'no_such_item', quantity: 1 };
  assert.throws(() => controller.loadDocument(document), /unknown item key/);
  assert.deepEqual(inventoryStore.toDocument(), before);
  harness.dispose();
});

test('failed world load restores the previous inventory', () => {
  const harness = createHarness();
  const { controller, inventoryStore } = harness;
  const before = inventoryStore.toDocument();
  const document = controller.toDocument();
  document.version = 1;
  assert.throws(() => controller.loadDocument(document));
  assert.deepEqual(inventoryStore.toDocument(), before);
  harness.dispose();
});

test('Azgaar-style import preserves inventory when playerState is absent', () => {
  const harness = createHarness();
  const { controller, inventoryStore } = harness;
  const before = inventoryStore.toDocument();
  const document = controller.toDocument();
  delete document.playerState;
  document.objects = [];
  document.chunks = [];
  controller.loadDocument(document, { preserveInventory: true });
  assert.deepEqual(inventoryStore.toDocument(), before);
  harness.dispose();
});

test('Clear World preserves inventory', () => {
  const harness = createHarness();
  const { controller, inventoryStore, tileMap } = harness;
  tileMap.paintSquare(0, 0, 1, 1);
  const before = inventoryStore.toDocument();
  controller.clearWorld();
  assert.deepEqual(inventoryStore.toDocument(), before);
  harness.dispose();
});

test('explicit empty replace clears inventory for a new-game reset', () => {
  const harness = createHarness();
  harness.inventoryStore.replaceDocument(null);
  assert.equal(harness.inventoryStore.getState().currency.gold, 0);
  assert.ok(harness.inventoryStore.getState().bagSlots.every((slot) => slot == null));
  harness.dispose();
});

test('rejects bread equipped as chest armour', () => {
  const harness = createHarness();
  const document = harness.controller.toDocument();
  document.playerState.inventory.equipment.armour.chest = {
    itemKey: 'bread',
    quantity: 1,
  };
  assert.throws(
    () => harness.controller.loadDocument(document),
    /cannot occupy slot "chest"/,
  );
  harness.dispose();
});

test('rejects potion stacks in weapon slots', () => {
  const harness = createHarness();
  const document = harness.controller.toDocument();
  document.playerState.inventory.equipment.weaponSets.set1.mainHand = {
    itemKey: 'healing_potion',
    quantity: 10,
  };
  assert.throws(
    () => harness.controller.loadDocument(document),
    /quantity 1|cannot occupy/,
  );
  harness.dispose();
});

test('rejects a shield in the head slot', () => {
  const harness = createHarness();
  const document = harness.controller.toDocument();
  document.playerState.inventory.equipment.armour.head = {
    itemKey: 'wooden_shield',
    quantity: 1,
  };
  assert.throws(
    () => harness.controller.loadDocument(document),
    /cannot occupy slot "head"/,
  );
  harness.dispose();
});

test('rejects a two-handed weapon with an occupied off-hand', () => {
  const harness = createHarness();
  const document = harness.controller.toDocument();
  document.playerState.inventory.equipment.weaponSets.set1.mainHand = {
    itemKey: 'steel_greatsword',
    quantity: 1,
    instanceId: 'gs-1',
  };
  document.playerState.inventory.equipment.weaponSets.set1.offHand = {
    itemKey: 'wooden_shield',
    quantity: 1,
    instanceId: 'sh-1',
  };
  assert.throws(
    () => harness.controller.loadDocument(document),
    /two-handed main hand/,
  );
  harness.dispose();
});

test('rejects equipped entries with quantity greater than one', () => {
  const harness = createHarness();
  const document = harness.controller.toDocument();
  document.playerState.inventory.equipment.armour.chest = {
    itemKey: 'leather_armour',
    quantity: 2,
  };
  assert.throws(
    () => harness.controller.loadDocument(document),
    /must have quantity 1|exceeds stackLimit/,
  );
  harness.dispose();
});

test('rejects duplicate instance IDs across the document', () => {
  const harness = createHarness();
  const document = harness.controller.toDocument();
  document.playerState.inventory.bagSlots[0] = {
    itemKey: 'iron_sword',
    quantity: 1,
    instanceId: 'dup-1',
  };
  document.playerState.inventory.equipment.weaponSets.set1.mainHand = {
    itemKey: 'steel_greatsword',
    quantity: 1,
    instanceId: 'dup-1',
  };
  assert.throws(
    () => harness.controller.loadDocument(document),
    /Duplicate instanceId/,
  );
  harness.dispose();
});
