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
  failResult,
  normalizeInventoryDocument,
  okResult,
} from './InventoryValidation.js';

function isArmourSlot(slot) {
  return ARMOUR_SLOTS.includes(slot);
}

function isAccessorySlot(slot) {
  return ACCESSORY_SLOTS.includes(slot);
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
    for (const listener of this.listeners) listener(change);
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
    if (emit) {
      this.emit({ kind: 'replace', before, after: this.toDocument() });
    }
    return okResult({ state: this.getState() });
  }

  /** Apply a starting-loadout document (capacity, currency, items list). */
  applyStartingLoadout(loadout) {
    const capacity = loadout?.capacity ?? this.defaultCapacity;
    const gold = loadout?.currency?.gold ?? 0;
    const empty = createEmptyInventoryState({ capacity, gold });
    this.state = normalizeInventoryDocument(empty, this.catalog, { defaultCapacity: capacity });
    const items = Array.isArray(loadout?.items) ? loadout.items : [];
    for (const item of items) {
      const result = this.addItem(item.itemKey, item.quantity ?? 1, {
        metadata: item.metadata,
        emit: false,
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
    }
    this.emit({ kind: 'replace', before: null, after: this.toDocument() });
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

    // Merge into existing compatible stacks first.
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
    // Decrement only after a successful action in a later gameplay phase.
    // For now, expose intent without mutating so callers can confirm later.
    return okResult({
      action: definition.action,
      itemKey: definition.key,
      location: from,
      pending: true,
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
    // World pickup creation is a later phase; do not mutate until confirmed.
    return okResult({
      pending: true,
      itemKey: fromRef.entry.itemKey,
      quantity: dropQuantity,
      location: from,
      entry: cloneInventoryEntry(fromRef.entry),
      state: this.getState(),
    });
  }

  /** Confirm a previously staged drop by removing from inventory. */
  confirmDrop(from, quantity) {
    const fromRef = this.readLocation(this.state, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Slot is empty.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > fromRef.entry.quantity) {
      return failResult('invalid_quantity', 'Drop quantity is invalid.');
    }
    const next = cloneInventoryState(this.state);
    const stackLimit = this.catalog.stackLimit(fromRef.entry.itemKey);
    if (fromRef.entry.quantity === quantity) {
      this.writeLocation(next, from, null);
    } else {
      this.writeLocation(next, from, createInventoryEntry({
        itemKey: fromRef.entry.itemKey,
        quantity: fromRef.entry.quantity - quantity,
        instanceId: fromRef.entry.instanceId ?? null,
        metadata: fromRef.entry.metadata,
        stackLimit,
      }));
    }
    this.commit(next, { kind: 'drop' });
    return okResult({ state: this.getState() });
  }

  /** Confirm a previously staged use by consuming one unit. */
  confirmUse(from) {
    const fromRef = this.readLocation(this.state, from);
    if (!fromRef.ok) return fromRef;
    if (!fromRef.entry) return failResult('empty_slot', 'Slot is empty.');
    const definition = this.catalog.require(fromRef.entry.itemKey);
    if (definition.category !== 'consumable') {
      return failResult('not_usable', 'Item cannot be used.');
    }
    const next = cloneInventoryState(this.state);
    if (fromRef.entry.quantity === 1) {
      this.writeLocation(next, from, null);
    } else {
      this.writeLocation(next, from, createInventoryEntry({
        itemKey: fromRef.entry.itemKey,
        quantity: fromRef.entry.quantity - 1,
        instanceId: fromRef.entry.instanceId ?? null,
        metadata: fromRef.entry.metadata,
        stackLimit: definition.stackLimit,
      }));
    }
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

  commit(next, { kind, emit = true } = {}) {
    const before = this.toDocument();
    this.state = next;
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

    // Equipment destination validation.
    if (to.kind === 'equipment' || to.kind === 'weapon') {
      const slot = to.slot;
      const definition = this.catalog.require(fromRef.entry.itemKey);
      if (!definition.equipmentSlots.includes(slot)) {
        return failResult('incompatible_equipment', `Item cannot equip in slot "${slot}".`);
      }
      if (fromRef.entry.quantity !== 1) {
        return failResult('invalid_quantity', 'Only single items can be equipped.');
      }
    }

    // Two-handed weapon: clear off-hand into bag before committing.
    if (to.kind === 'weapon' && to.slot === 'mainHand') {
      const definition = this.catalog.require(fromRef.entry.itemKey);
      if (definition.hands === 2) {
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
    }

    // Equipping into off-hand while a two-hander occupies main hand fails.
    if (to.kind === 'weapon' && to.slot === 'offHand') {
      const setKey = weaponSetKey(to.set);
      const mainHand = next.equipment.weaponSets[setKey].mainHand;
      if (mainHand && this.catalog.isTwoHanded(mainHand.itemKey)) {
        return failResult(
          'incompatible_equipment',
          'Cannot equip off-hand while a two-handed weapon is equipped.',
        );
      }
    }

    const moving = this.takeFromLocation(next, from);

    // Merge into compatible bag destination.
    if (to.kind === 'bag' && toRef.entry && canMergeEntries(moving, toRef.entry)) {
      const stackLimit = this.catalog.stackLimit(moving.itemKey);
      const space = stackLimit - toRef.entry.quantity;
      if (space <= 0) {
        // Full stack: swap instead.
        this.writeLocation(next, to, moving);
        this.writeLocation(next, from, toRef.entry);
        return okResult({ next });
      }
      const take = Math.min(space, moving.quantity);
      this.writeLocation(next, to, createInventoryEntry({
        itemKey: toRef.entry.itemKey,
        quantity: toRef.entry.quantity + take,
        instanceId: toRef.entry.instanceId ?? null,
        metadata: toRef.entry.metadata,
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
      return okResult({ next });
    }

    // Swap when destination occupied.
    if (toRef.entry) {
      if (from.kind === 'equipment' || from.kind === 'weapon') {
        // Destination item must fit the source equipment slot when swapping.
        if (to.kind === 'bag') {
          this.writeLocation(next, to, moving);
          this.writeLocation(next, from, toRef.entry);
          // Validate the item now in the equipment slot.
          const check = this.readLocation(next, from);
          const def = this.catalog.require(check.entry.itemKey);
          const slot = from.slot;
          if (!def.equipmentSlots.includes(slot)) {
            return failResult('incompatible_equipment', 'Swapped item cannot occupy the equipment slot.');
          }
          return okResult({ next });
        }
      }
      if (to.kind === 'equipment' || to.kind === 'weapon') {
        // Moving equipment into occupied slot: unequip current into source if bag, else swap if compatible.
        const occupying = toRef.entry;
        if (from.kind === 'bag') {
          this.writeLocation(next, to, moving);
          this.writeLocation(next, from, occupying);
          return okResult({ next });
        }
      }
      this.writeLocation(next, to, moving);
      this.writeLocation(next, from, toRef.entry);
      return okResult({ next });
    }

    this.writeLocation(next, to, moving);
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
