import {
  ACCESSORY_SLOTS,
  ARMOUR_SLOTS,
  DEFAULT_BAG_CAPACITY,
  WEAPON_HAND_SLOTS,
  WEAPON_SET_IDS,
  createEmptyInventoryState,
  weaponSetKey,
} from './inventoryConstants.js';
import {
  canMergeEntries,
  cloneInventoryEntry,
  createInventoryEntry,
} from './InventoryEntry.js';
import { locationsEqual } from './inventoryLocations.js';
import {
  cloneInventoryState,
  entryMatchesStaged,
  failResult,
  normalizeInventoryDocument,
  okResult,
  validateEquipmentState,
} from './InventoryValidation.js';

function isArmourSlot(slot) {
  return ARMOUR_SLOTS.includes(slot);
}

function isAccessorySlot(slot) {
  return ACCESSORY_SLOTS.includes(slot);
}

function isEquipmentLocation(location) {
  return location?.kind === 'equipment' || location?.kind === 'weapon';
}

function createOperationId(store) {
  const id = `op-${store.nextOperationId}`;
  store.nextOperationId += 1;
  return id;
}

/**
 * Sole authority for bag contents, equipment, weapon sets, and currency.
 * Every mutating operation computes the next state fully before committing.
 */
export class InventoryStore {
  /**
   * @param {import('./ItemCatalog.js').ItemCatalog} catalog
   * @param {object} [document]
   * @param {{ capacity?: number }} [options]
   */
  constructor(catalog, document = null, options = {}) {
    if (!catalog) throw new Error('InventoryStore requires an ItemCatalog.');
    this.catalog = catalog;
    this.defaultCapacity = options.capacity ?? DEFAULT_BAG_CAPACITY;
    this.listeners = new Set();
    this.revision = 0;
    this.nextOperationId = 1;
    this.pendingOperations = new Map();
    this.state = normalizeInventoryDocument(
      document ?? createEmptyInventoryState({ capacity: this.defaultCapacity }),
      catalog,
      { defaultCapacity: this.defaultCapacity },
    );
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change) {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        console.error('Inventory change listener failed.', error);
      }
    }
  }

  getState() {
    return cloneInventoryState(this.state);
  }

  toDocument() {
    return cloneInventoryState(this.state);
  }

  replaceDocument(document, { emit = true } = {}) {
    const next = normalizeInventoryDocument(document, this.catalog, {
      defaultCapacity: this.defaultCapacity,
    });
    const before = this.toDocument();
    this.state = next;
    this.revision += 1;
    this.pendingOperations.clear();
    if (emit) {
      this.emit({ kind: 'replace', before, after: this.toDocument() });
    }
    return okResult({ state: this.getState() });
  }

  /**
   * Apply a starting-loadout document atomically.
   * Builds a draft store first; the live state is replaced only after success.
   */
  applyStartingLoadout(loadout) {
    const capacity = loadout?.capacity ?? this.defaultCapacity;
    const gold = loadout?.currency?.gold ?? 0;
    const draft = new InventoryStore(
      this.catalog,
      createEmptyInventoryState({ capacity, gold }),
      { capacity },
    );
    const items = Array.isArray(loadout?.items) ? loadout.items : [];
    for (const item of items) {
      const result = draft.addItem(item.itemKey, item.quantity ?? 1, {
        metadata: item.metadata,
        emit: false,
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
      if (result.rejected > 0) {
        throw new Error(`Starting loadout could not place all of ${item.itemKey}.`);
      }
    }
    const before = this.toDocument();
    this.state = draft.toDocument();
    this.revision += 1;
    this.pendingOperations.clear();
    this.emit({ kind: 'replace', before, after: this.toDocument() });
    return okResult({ state: this.getState() });
  }

  addItem(itemKey, quantity = 1, { metadata, emit = true } = {}) {
    if (!this.catalog.has(itemKey)) {
      return failResult('unknown_item', `Unknown item key "${itemKey}".`);
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return failResult('invalid_quantity', 'Quantity must be an integer >= 1.');
    }

    const definition = this.catalog.require(itemKey);
    const next = cloneInventoryState(this.state);
    let remaining = quantity;
    const acceptedBefore = quantity;

    if (definition.stackLimit > 1) {
      for (let index = 0; index < next.bagSlots.length && remaining > 0; index += 1) {
        const slot = next.bagSlots[index];
        if (!slot || slot.itemKey !== itemKey) continue;
        const probe = createInventoryEntry({
          itemKey,
          quantity: 1,
          metadata,
          stackLimit: definition.stackLimit,
        });
        if (!canMergeEntries(slot, probe)) continue;
        const space = definition.stackLimit - slot.quantity;
        if (space <= 0) continue;
        const take = Math.min(space, remaining);
        next.bagSlots[index] = createInventoryEntry({
          itemKey: slot.itemKey,
          quantity: slot.quantity + take,
          instanceId: slot.instanceId ?? null,
          metadata: slot.metadata,
          stackLimit: definition.stackLimit,
        });
        remaining -= take;
      }
    }

    while (remaining > 0) {
      const emptyIndex = next.bagSlots.findIndex((slot) => slot == null);
      if (emptyIndex < 0) break;
      const take = Math.min(definition.stackLimit, remaining);
      next.bagSlots[emptyIndex] = createInventoryEntry({
        itemKey,
        quantity: take,
        metadata,
        stackLimit: definition.stackLimit,
      });
      remaining -= take;
    }

    const accepted = acceptedBefore - remaining;
    if (accepted === 0) {
      return failResult('inventory_full', 'Inventory is full.', {
        accepted: 0,
        rejected: quantity,
      });
    }

    this.commit(next, { kind: 'add', emit });
    return okResult({
      accepted,
      rejected: remaining,
      state: this.getState(),
    });
  }

  removeItem(itemKey, quantity = 1, { emit = true } = {}) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      return failResult('invalid_quantity', 'Quantity must be an integer >= 1.');
    }
    const next = cloneInventoryState(this.state);
    let remaining = quantity;
    for (let index = next.bagSlots.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const slot = next.bagSlots[index];
      if (!slot || slot.itemKey !== itemKey) continue;
      if (slot.quantity <= remaining) {
        remaining -= slot.quantity;
        next.bagSlots[index] = null;
      } else {
        next.bagSlots[index] = createInventoryEntry({
          itemKey: slot.itemKey,
          quantity: slot.quantity - remaining,
          instanceId: slot.instanceId ?? null,
          metadata: slot.metadata,
          stackLimit: this.catalog.stackLimit(slot.itemKey),
        });
        remaining = 0;
      }
    }
    if (remaining > 0) {
      return failResult('insufficient_quantity', `Not enough ${itemKey} to remove.`);
    }
    this.commit(next, { kind: 'remove', emit });
    return okResult({ state: this.getState() });
  }

  moveItem(from, to) {
    const resolved = this.resolveMovePlan(from, to);
    if (!resolved.ok) return resolved;
    this.commit(resolved.next, { kind: 'move' });
    return okResult({ state: this.getState() });
  }

  swapItems(from, to) {
    return this.moveItem(from, to);
  }

  mergeStacks(from, to) {
    const fromRef = this.readLocation(this.state, from);
    const toRef = this.readLocation(this.state, to);
    if (!fromRef.ok) return fromRef;
    if (!toRef.ok) return toRef;
    if (!fromRef.entry || !toRef.entry) {
      return failResult('empty_slot', 'Both slots must contain items to merge.');
    }
    if (!canMergeEntries(fromRef.entry, toRef.entry)) {
      return failResult('incompatible_stack', 'Stacks are not compatible.');
    }
    return this.moveItem(from, to);
  }

  splitStack(from, quantity, to = null) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      return failResult('invalid_quantity', 'Split quantity must be an integer >= 1.');
    }
    const fromRef = this.readLocation(this.state, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Source slot is empty.');
    if (fromRef.entry.quantity <= quantity) {
      return failResult('invalid_quantity', 'Split quantity must be less than the stack size.');
    }
    if (from.kind !== 'bag') {
      return failResult('invalid_location', 'Only bag stacks can be split.');
    }

    const next = cloneInventoryState(this.state);
    const stackLimit = this.catalog.stackLimit(fromRef.entry.itemKey);
    const source = next.bagSlots[from.index];
    next.bagSlots[from.index] = createInventoryEntry({
      itemKey: source.itemKey,
      quantity: source.quantity - quantity,
      instanceId: source.instanceId ?? null,
      metadata: source.metadata,
      stackLimit,
    });

    let targetIndex = to?.kind === 'bag' ? to.index : -1;
    if (targetIndex < 0) {
      targetIndex = next.bagSlots.findIndex((slot) => slot == null);
    }
    if (targetIndex < 0 || targetIndex >= next.capacity) {
      return failResult('inventory_full', 'No empty bag slot for the split stack.');
    }
    if (next.bagSlots[targetIndex] != null) {
      return failResult('slot_occupied', 'Split destination must be empty.');
    }
    next.bagSlots[targetIndex] = createInventoryEntry({
      itemKey: source.itemKey,
      quantity,
      metadata: source.metadata,
      stackLimit,
    });

    this.commit(next, { kind: 'split' });
    return okResult({
      to: { kind: 'bag', index: targetIndex },
      state: this.getState(),
    });
  }

  equipItem(from, { set = this.state.activeWeaponSet, slot = null } = {}) {
    const fromRef = this.readLocation(this.state, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Source slot is empty.');

    const definition = this.catalog.require(fromRef.entry.itemKey);
    if (definition.equipmentSlots.length === 0) {
      return failResult('not_equippable', 'Item cannot be equipped.');
    }

    let targetSlot = slot;
    if (!targetSlot) {
      targetSlot = definition.equipmentSlots[0];
    }
    if (!definition.equipmentSlots.includes(targetSlot)) {
      return failResult('incompatible_equipment', `Item cannot equip in slot "${targetSlot}".`);
    }

    const to = WEAPON_HAND_SLOTS.includes(targetSlot)
      ? { kind: 'weapon', set, slot: targetSlot }
      : { kind: 'equipment', slot: targetSlot };

    return this.moveItem(from, to);
  }

  unequipItem(from, toBagIndex = null) {
    if (from.kind !== 'equipment' && from.kind !== 'weapon') {
      return failResult('invalid_location', 'Unequip requires an equipment or weapon location.');
    }
    const fromRef = this.readLocation(this.state, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Equipment slot is empty.');

    const next = cloneInventoryState(this.state);
    const entry = this.takeFromLocation(next, from);
    const placed = this.placeInBag(next, entry, toBagIndex);
    if (!placed.ok) return placed;

    const equipmentCheck = validateEquipmentState(next, this.catalog);
    if (!equipmentCheck.ok) return equipmentCheck;

    this.commit(next, { kind: 'unequip' });
    return okResult({ state: this.getState() });
  }

  switchWeaponSet(setId) {
    if (!WEAPON_SET_IDS.includes(setId)) {
      return failResult('invalid_weapon_set', `Weapon set must be one of ${WEAPON_SET_IDS.join(', ')}.`);
    }
    if (this.state.activeWeaponSet === setId) {
      return okResult({ state: this.getState() });
    }
    const next = cloneInventoryState(this.state);
    next.activeWeaponSet = setId;
    this.commit(next, { kind: 'switch_weapon_set' });
    return okResult({ state: this.getState() });
  }

  useItem(from) {
    const fromRef = this.readLocation(this.state, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Slot is empty.');
    const definition = this.catalog.require(fromRef.entry.itemKey);
    if (definition.category !== 'consumable' || !definition.action) {
      return failResult('not_usable', 'Item cannot be used.');
    }
    const token = Object.freeze({
      operationId: createOperationId(this),
      kind: 'use',
      location: structuredClone(from),
      itemKey: fromRef.entry.itemKey,
      instanceId: fromRef.entry.instanceId ?? null,
      quantity: 1,
      inventoryRevision: this.revision,
      action: definition.action,
    });
    this.pendingOperations.set(token.operationId, token);
    return okResult({
      pending: true,
      token,
      action: definition.action,
      itemKey: definition.key,
      location: from,
      state: this.getState(),
    });
  }

  dropItem(from, quantity = null) {
    const fromRef = this.readLocation(this.state, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Slot is empty.');
    const dropQuantity = quantity ?? fromRef.entry.quantity;
    if (!Number.isInteger(dropQuantity) || dropQuantity < 1 || dropQuantity > fromRef.entry.quantity) {
      return failResult('invalid_quantity', 'Drop quantity is invalid.');
    }
    const token = Object.freeze({
      operationId: createOperationId(this),
      kind: 'drop',
      location: structuredClone(from),
      itemKey: fromRef.entry.itemKey,
      instanceId: fromRef.entry.instanceId ?? null,
      quantity: dropQuantity,
      inventoryRevision: this.revision,
    });
    this.pendingOperations.set(token.operationId, token);
    return okResult({
      pending: true,
      token,
      itemKey: fromRef.entry.itemKey,
      quantity: dropQuantity,
      location: from,
      entry: cloneInventoryEntry(fromRef.entry),
      state: this.getState(),
    });
  }

  /** Confirm a previously staged drop by removing the matching entry. */
  confirmDrop(tokenOrLocation, quantity = null) {
    const token = this.resolvePendingToken(tokenOrLocation, 'drop', quantity);
    if (!token.ok) return token;
    const staged = token.token;
    const fromRef = this.readLocation(this.state, staged.location);
    if (!fromRef.ok) return fromRef;
    if (!entryMatchesStaged(fromRef.entry, staged)) {
      this.pendingOperations.delete(staged.operationId);
      return failResult('stale_operation', 'The staged drop no longer matches the inventory entry.');
    }

    const next = cloneInventoryState(this.state);
    const stackLimit = this.catalog.stackLimit(fromRef.entry.itemKey);
    if (fromRef.entry.quantity === staged.quantity) {
      this.writeLocation(next, staged.location, null);
    } else {
      this.writeLocation(next, staged.location, createInventoryEntry({
        itemKey: fromRef.entry.itemKey,
        quantity: fromRef.entry.quantity - staged.quantity,
        instanceId: fromRef.entry.instanceId ?? null,
        metadata: fromRef.entry.metadata,
        stackLimit,
      }));
    }
    this.pendingOperations.delete(staged.operationId);
    this.commit(next, { kind: 'drop' });
    return okResult({ state: this.getState() });
  }

  /** Confirm a previously staged use by consuming one matching unit. */
  confirmUse(tokenOrLocation) {
    const token = this.resolvePendingToken(tokenOrLocation, 'use', 1);
    if (!token.ok) return token;
    const staged = token.token;
    const fromRef = this.readLocation(this.state, staged.location);
    if (!fromRef.ok) return fromRef;
    if (!entryMatchesStaged(fromRef.entry, staged)) {
      this.pendingOperations.delete(staged.operationId);
      return failResult('stale_operation', 'The staged use no longer matches the inventory entry.');
    }
    const definition = this.catalog.require(fromRef.entry.itemKey);
    if (definition.category !== 'consumable') {
      return failResult('not_usable', 'Item cannot be used.');
    }

    const next = cloneInventoryState(this.state);
    if (fromRef.entry.quantity === 1) {
      this.writeLocation(next, staged.location, null);
    } else {
      this.writeLocation(next, staged.location, createInventoryEntry({
        itemKey: fromRef.entry.itemKey,
        quantity: fromRef.entry.quantity - 1,
        instanceId: fromRef.entry.instanceId ?? null,
        metadata: fromRef.entry.metadata,
        stackLimit: definition.stackLimit,
      }));
    }
    this.pendingOperations.delete(staged.operationId);
    this.commit(next, { kind: 'use' });
    return okResult({ state: this.getState() });
  }

  setGold(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      return failResult('invalid_gold', 'Gold must be a non-negative integer.');
    }
    const next = cloneInventoryState(this.state);
    next.currency.gold = amount;
    this.commit(next, { kind: 'currency' });
    return okResult({ state: this.getState() });
  }

  addGold(amount) {
    if (!Number.isInteger(amount) || amount < 1) {
      return failResult('invalid_gold', 'Gold amount must be an integer >= 1.');
    }
    return this.setGold(this.state.currency.gold + amount);
  }

  removeGold(amount) {
    if (!Number.isInteger(amount) || amount < 1) {
      return failResult('invalid_gold', 'Gold amount must be an integer >= 1.');
    }
    if (this.state.currency.gold < amount) {
      return failResult('insufficient_gold', 'Not enough gold.');
    }
    return this.setGold(this.state.currency.gold - amount);
  }

  // --- internals -----------------------------------------------------------

  resolvePendingToken(tokenOrLocation, kind, quantity) {
    if (tokenOrLocation && typeof tokenOrLocation === 'object' && tokenOrLocation.operationId) {
      const staged = this.pendingOperations.get(tokenOrLocation.operationId);
      if (!staged) {
        return failResult('stale_operation', 'The staged operation is no longer pending.');
      }
      if (staged.kind !== kind) {
        return failResult('invalid_operation', `Expected a ${kind} operation token.`);
      }
      if (staged.inventoryRevision !== this.revision) {
        this.pendingOperations.delete(staged.operationId);
        return failResult(
          'stale_operation',
          'The inventory changed since the operation was staged.',
        );
      }
      return okResult({ token: staged });
    }
    // Legacy location-only callers: synthesise a token from the live entry.
    const fromRef = this.readLocation(this.state, tokenOrLocation);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Slot is empty.');
    const qty = quantity ?? (kind === 'use' ? 1 : fromRef.entry.quantity);
    return okResult({
      token: {
        operationId: createOperationId(this),
        kind,
        location: structuredClone(tokenOrLocation),
        itemKey: fromRef.entry.itemKey,
        instanceId: fromRef.entry.instanceId ?? null,
        quantity: qty,
        inventoryRevision: this.revision,
      },
    });
  }

  commit(next, { kind, emit = true } = {}) {
    const before = this.toDocument();
    this.state = next;
    this.revision += 1;
    if (emit) {
      this.emit({ kind, before, after: this.toDocument() });
    }
  }

  resolveMovePlan(from, to) {
    if (locationsEqual(from, to)) {
      return failResult('same_location', 'Source and destination are the same.');
    }
    const next = cloneInventoryState(this.state);
    const fromRef = this.readLocation(next, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Source slot is empty.');

    const toRef = this.readLocation(next, to);
    if (!toRef.ok) return toRef;

    if (isEquipmentLocation(to)) {
      const definition = this.catalog.require(fromRef.entry.itemKey);
      if (!definition.equipmentSlots.includes(to.slot)) {
        return failResult('incompatible_equipment', `Item cannot equip in slot "${to.slot}".`);
      }
      if (fromRef.entry.quantity !== 1) {
        return failResult('invalid_quantity', 'Only single items can be equipped.');
      }
    }

    if (to.kind === 'weapon' && to.slot === 'offHand') {
      const setKey = weaponSetKey(to.set);
      const mainHand = next.equipment.weaponSets[setKey].mainHand;
      // Ignore the case where we are moving the two-hander out of mainHand.
      const movingOutMain = from.kind === 'weapon'
        && from.set === to.set
        && from.slot === 'mainHand';
      if (!movingOutMain && mainHand && this.catalog.isTwoHanded(mainHand.itemKey)) {
        return failResult(
          'incompatible_equipment',
          'Cannot equip off-hand while a two-handed weapon is equipped.',
        );
      }
    }

    // Free the source first so displaced gear can reuse that bag slot.
    const moving = this.takeFromLocation(next, from);

    if (to.kind === 'weapon' && to.slot === 'mainHand' && this.catalog.isTwoHanded(moving.itemKey)) {
      const setKey = weaponSetKey(to.set);
      const offHand = next.equipment.weaponSets[setKey].offHand;
      if (offHand) {
        const placed = this.placeInBag(next, offHand);
        if (!placed.ok) {
          return failResult(
            'inventory_full',
            'Cannot equip two-handed weapon: no space for the off-hand item.',
          );
        }
        next.equipment.weaponSets[setKey].offHand = null;
      }
    }

    const destRef = this.readLocation(next, to);
    if (!destRef.ok) return destRef;

    if (to.kind === 'bag' && destRef.entry && canMergeEntries(moving, destRef.entry)) {
      const stackLimit = this.catalog.stackLimit(moving.itemKey);
      const space = stackLimit - destRef.entry.quantity;
      if (space <= 0) {
        this.writeLocation(next, to, moving);
        this.writeLocation(next, from, destRef.entry);
      } else {
        const take = Math.min(space, moving.quantity);
        this.writeLocation(next, to, createInventoryEntry({
          itemKey: destRef.entry.itemKey,
          quantity: destRef.entry.quantity + take,
          instanceId: destRef.entry.instanceId ?? null,
          metadata: destRef.entry.metadata,
          stackLimit,
        }));
        if (take < moving.quantity) {
          this.writeLocation(next, from, createInventoryEntry({
            itemKey: moving.itemKey,
            quantity: moving.quantity - take,
            instanceId: moving.instanceId ?? null,
            metadata: moving.metadata,
            stackLimit,
          }));
        }
      }
    } else if (destRef.entry) {
      if (isEquipmentLocation(from) && !this.catalog.canEquipInSlot(destRef.entry.itemKey, from.slot)) {
        return failResult(
          'incompatible_equipment',
          'Swapped item cannot occupy the source equipment slot.',
        );
      }
      if (isEquipmentLocation(to) && !this.catalog.canEquipInSlot(moving.itemKey, to.slot)) {
        return failResult(
          'incompatible_equipment',
          `Item cannot equip in slot "${to.slot}".`,
        );
      }
      if (isEquipmentLocation(from) && destRef.entry.quantity !== 1) {
        return failResult('invalid_quantity', 'Only single items can be equipped.');
      }
      this.writeLocation(next, to, moving);
      this.writeLocation(next, from, destRef.entry);
    } else {
      this.writeLocation(next, to, moving);
    }

    const equipmentCheck = validateEquipmentState(next, this.catalog);
    if (!equipmentCheck.ok) return equipmentCheck;
    return okResult({ next });
  }

  placeInBag(state, entry, preferredIndex = null) {
    if (preferredIndex != null) {
      if (!Number.isInteger(preferredIndex) || preferredIndex < 0 || preferredIndex >= state.capacity) {
        return failResult('invalid_location', 'Bag index is out of range.');
      }
      if (state.bagSlots[preferredIndex] != null) {
        return failResult('slot_occupied', 'Preferred bag slot is occupied.');
      }
      state.bagSlots[preferredIndex] = entry;
      return okResult();
    }
    const emptyIndex = state.bagSlots.findIndex((slot) => slot == null);
    if (emptyIndex < 0) {
      return failResult('inventory_full', 'Inventory is full.');
    }
    state.bagSlots[emptyIndex] = entry;
    return okResult({ index: emptyIndex });
  }

  takeFromLocation(state, location) {
    const ref = this.readLocation(state, location);
    if (!ref.ok) throw new Error(ref.message);
    this.writeLocation(state, location, null);
    return ref.entry;
  }

  readLocation(state, location) {
    if (!location || typeof location !== 'object') {
      return failResult('invalid_location', 'Location is required.');
    }
    if (location.kind === 'bag') {
      if (!Number.isInteger(location.index) || location.index < 0 || location.index >= state.capacity) {
        return failResult('invalid_location', 'Bag index is out of range.');
      }
      return okResult({ entry: state.bagSlots[location.index] });
    }
    if (location.kind === 'equipment') {
      if (isArmourSlot(location.slot)) {
        return okResult({ entry: state.equipment.armour[location.slot] });
      }
      if (isAccessorySlot(location.slot)) {
        return okResult({ entry: state.equipment.accessories[location.slot] });
      }
      return failResult('invalid_location', `Unknown equipment slot "${location.slot}".`);
    }
    if (location.kind === 'weapon') {
      if (!WEAPON_SET_IDS.includes(location.set)) {
        return failResult('invalid_location', `Unknown weapon set "${location.set}".`);
      }
      if (!WEAPON_HAND_SLOTS.includes(location.slot)) {
        return failResult('invalid_location', `Unknown weapon slot "${location.slot}".`);
      }
      return okResult({
        entry: state.equipment.weaponSets[weaponSetKey(location.set)][location.slot],
      });
    }
    return failResult('invalid_location', `Unknown location kind "${location.kind}".`);
  }

  writeLocation(state, location, entry) {
    if (location.kind === 'bag') {
      state.bagSlots[location.index] = entry;
      return;
    }
    if (location.kind === 'equipment') {
      if (isArmourSlot(location.slot)) {
        state.equipment.armour[location.slot] = entry;
        return;
      }
      if (isAccessorySlot(location.slot)) {
        state.equipment.accessories[location.slot] = entry;
        return;
      }
    }
    if (location.kind === 'weapon') {
      state.equipment.weaponSets[weaponSetKey(location.set)][location.slot] = entry;
    }
  }
}
