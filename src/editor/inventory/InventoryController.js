import { GAMEPLAY_OVERLAY } from '../ui/gameplayOverlayConstants.js';
import { locationsEqual } from './inventoryLocations.js';

/**
 * Interaction state for the inventory overlay. Item authority stays in InventoryStore.
 */
export class InventoryController {
  /**
   * @param {{
   *   store: import('./InventoryStore.js').InventoryStore,
   *   overlayController?: import('../ui/GameplayOverlayController.js').GameplayOverlayController | null,
   *   catalog?: import('./ItemCatalog.js').ItemCatalog | null,
   * }} options
   */
  constructor({ store, overlayController = null, catalog = null }) {
    if (!store) throw new Error('InventoryController requires an InventoryStore.');
    this.store = store;
    this.catalog = catalog ?? store.catalog ?? null;
    this.overlayController = overlayController;
    this.listeners = new Set();

    this.selectedLocation = null;
    this.hoveredLocation = null;
    this.drag = null;
    this.contextMenu = null;
    this.tooltip = null;
    this._openWithoutOverlay = false;
    this._closing = false;
    this.keyNavigationHandler = null;

    this.unregisterOverlay = this.overlayController
      ? this.overlayController.registerOverlay(GAMEPLAY_OVERLAY.inventory, {
        onOpen: () => this.handleOverlayOpen(),
        onClose: () => this.handleOverlayClose(),
        onEscape: () => this.handleEscape(),
        onKeyDown: (event) => this.handleKeyDown(event),
      })
      : null;

    this.unsubscribeStore = this.store.subscribe(() => this.emit());
  }

  get isOpen() {
    // GameplayOverlayController invokes onClose() before it clears activeOverlay, so
    // during the close callback it still reports this overlay as open. Subscribers that
    // render from isOpen would then paint the panel as visible and never hear about the
    // close, leaving it stranded on screen. The flag closes that window.
    if (this._closing) return false;
    return this.overlayController
      ? this.overlayController.isOpen(GAMEPLAY_OVERLAY.inventory)
      : this._openWithoutOverlay === true;
  }

  getViewState() {
    const inventory = this.store.getState();
    return Object.freeze({
      isOpen: this.isOpen,
      selectedLocation: this.selectedLocation,
      hoveredLocation: this.hoveredLocation,
      drag: this.drag,
      contextMenu: this.contextMenu,
      tooltip: this.tooltip,
      inventory,
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getViewState());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.getViewState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('Inventory controller listener failed.', error);
      }
    }
  }

  open() {
    if (this.overlayController) {
      this.overlayController.open(GAMEPLAY_OVERLAY.inventory);
      return;
    }
    this._openWithoutOverlay = true;
    this.handleOverlayOpen();
  }

  close() {
    if (this.overlayController) {
      this.overlayController.close(GAMEPLAY_OVERLAY.inventory);
      return;
    }
    this._openWithoutOverlay = false;
    this.handleOverlayClose();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  handleOverlayOpen() {
    this.emit();
  }

  handleOverlayClose() {
    this._closing = true;
    try {
      this.cancelDrag();
      this.contextMenu = null;
      this.tooltip = null;
      this.selectedLocation = null;
      this.hoveredLocation = null;
      this.emit();
    } finally {
      this._closing = false;
    }
  }

  /** @returns {boolean} true when a local interaction was cancelled. */
  handleEscape() {
    if (this.drag) {
      this.cancelDrag();
      return true;
    }
    if (this.contextMenu) {
      this.contextMenu = null;
      this.emit();
      return true;
    }
    return false;
  }

  /**
   * The view registers slot navigation here rather than listening for keydown itself.
   * GameplayOverlayController calls stopImmediatePropagation on every key while an
   * overlay is open, so a listener attached by the view would never fire; this handler
   * runs inside the one keydown path the coordinator does forward.
   *
   * @param {((event: KeyboardEvent) => boolean) | null} handler
   */
  setKeyNavigationHandler(handler) {
    this.keyNavigationHandler = handler ?? null;
  }

  handleKeyDown(event) {
    if (!this.isOpen) return false;
    if (event.code === 'Digit1' || event.key === '1') {
      this.switchWeaponSet(1);
      return true;
    }
    if (event.code === 'Digit2' || event.key === '2') {
      this.switchWeaponSet(2);
      return true;
    }
    return this.keyNavigationHandler?.(event) === true;
  }

  selectLocation(location) {
    this.selectedLocation = location;
    this.emit();
  }

  hoverLocation(location) {
    this.hoveredLocation = location;
    this.emit();
  }

  beginDrag(location) {
    const entry = this.readEntry(location);
    if (!entry) return { ok: false, code: 'empty_slot', message: 'Slot is empty.' };
    this.drag = Object.freeze({
      from: location,
      itemKey: entry.itemKey,
      quantity: entry.quantity,
    });
    this.selectedLocation = location;
    this.emit();
    return { ok: true };
  }

  cancelDrag() {
    if (this.drag == null) return;
    this.drag = null;
    this.emit();
  }

  dropOn(location) {
    if (!this.drag) {
      return { ok: false, code: 'no_drag', message: 'Nothing is being dragged.' };
    }
    if (locationsEqual(this.drag.from, location)) {
      this.cancelDrag();
      return { ok: true, cancelled: true };
    }
    // Clear drag before the store commit so subscribers never see a moved item
    // while the controller still reports an active drag.
    const from = this.drag.from;
    this.drag = null;
    const result = this.store.moveItem(from, location);
    if (!result.ok) {
      this.emit();
      return result;
    }
    this.selectedLocation = location;
    this.emit();
    return result;
  }

  /** Tap-select / tap-destination for touch. */
  activateLocation(location) {
    if (this.drag) {
      return this.dropOn(location);
    }
    if (this.selectedLocation && !locationsEqual(this.selectedLocation, location)) {
      const result = this.store.moveItem(this.selectedLocation, location);
      if (result.ok) {
        this.selectedLocation = location;
      }
      this.emit();
      return result;
    }
    this.selectLocation(location);
    return { ok: true };
  }

  doubleActivate(location) {
    const entry = this.readEntry(location);
    if (!entry) return { ok: false, code: 'empty_slot', message: 'Slot is empty.' };
    const definition = this.catalog?.get(entry.itemKey);
    if (location.kind === 'equipment' || location.kind === 'weapon') {
      return this.store.unequipItem(location);
    }
    if (definition?.equipmentSlots?.length) {
      return this.store.equipItem(location);
    }
    if (definition?.category === 'consumable') {
      const staged = this.store.useItem(location);
      if (!staged.ok || !staged.pending) return staged;
      return this.store.confirmUse(staged.token);
    }
    return { ok: false, code: 'no_action', message: 'No default action for this item.' };
  }

  switchWeaponSet(setId) {
    const result = this.store.switchWeaponSet(setId);
    this.emit();
    return result;
  }

  openContextMenu(location, screen = null) {
    const entry = this.readEntry(location);
    if (!entry) {
      this.contextMenu = null;
      this.emit();
      return;
    }
    this.contextMenu = Object.freeze({
      location,
      itemKey: entry.itemKey,
      screen,
    });
    this.selectedLocation = location;
    this.emit();
  }

  closeContextMenu() {
    this.contextMenu = null;
    this.emit();
  }

  setTooltip(location, screen = null) {
    const entry = this.readEntry(location);
    this.tooltip = entry
      ? Object.freeze({ location, itemKey: entry.itemKey, screen })
      : null;
    this.emit();
  }

  clearTooltip() {
    this.tooltip = null;
    this.emit();
  }

  readEntry(location) {
    if (!location) return null;
    const state = this.store.getState();
    if (location.kind === 'bag') {
      return state.bagSlots[location.index] ?? null;
    }
    if (location.kind === 'equipment') {
      return state.equipment.armour[location.slot]
        ?? state.equipment.accessories[location.slot]
        ?? null;
    }
    if (location.kind === 'weapon') {
      const setKey = `set${location.set}`;
      return state.equipment.weaponSets[setKey]?.[location.slot] ?? null;
    }
    return null;
  }

  dispose() {
    this.unregisterOverlay?.();
    this.unsubscribeStore?.();
    this.keyNavigationHandler = null;
    this.listeners.clear();
  }
}
