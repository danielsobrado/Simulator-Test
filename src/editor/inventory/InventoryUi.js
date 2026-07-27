import { WEAPON_SET_IDS } from './inventoryConstants.js';
import { bagLocation, parseLocation, serializeLocation, weaponLocation } from './inventoryLocations.js';
import {
  EQUIPMENT_SLOT_DESCRIPTORS,
  WEAPON_SLOT_DESCRIPTORS,
  weaponSetLabel,
} from './ui/inventoryLayout.js';
import { InventorySlotView } from './ui/InventorySlotView.js';
import { InventoryDragLayer } from './ui/InventoryDragLayer.js';
import { InventoryTooltip } from './ui/InventoryTooltip.js';
import { InventoryContextMenu } from './ui/InventoryContextMenu.js';
import { InventoryKeyboardNav } from './ui/InventoryKeyboardNav.js';

/**
 * The inventory overlay's view. Owns the DOM and routes user gestures to
 * InventoryController; it never mutates inventory state itself.
 *
 * The whole panel is built once in the constructor and only patched afterwards. The
 * controller emits on hover and selection changes as well as store mutations, so a
 * rebuild-per-emit would be pathological — see InventorySlotView.patch for the diffing
 * that keeps a pointer sweep across the grid cheap.
 */
export class InventoryUi {
  /**
   * @param {{
   *   root: HTMLElement,
   *   controller: import('./InventoryController.js').InventoryController,
   * }} options
   */
  constructor({ root, controller }) {
    this.root = root;
    this.controller = controller;
    this.store = controller.store;
    this.catalog = controller.catalog;

    this.slots = new Map();
    this.weaponSlotViews = [];
    this.iconsWarmed = false;
    this.actionSignature = null;
    this.tooltipSignature = null;
    this.pendingDrop = null;
    this.previousFocus = null;
    this.wasOpen = false;

    this.buildDom();
    this.buildSlots();
    this.bindEvents();

    this.tooltip = new InventoryTooltip({ container: this.panel });
    this.contextMenu = new InventoryContextMenu({
      container: this.panel,
      onAction: (action, location) => this.runAction(action, location),
    });
    this.keyboardNav = new InventoryKeyboardNav({
      panel: this.panel,
      getSlotButtons: () => this.slotButtons(),
    });
    this.dragLayer = new InventoryDragLayer({
      panel: this.panel,
      container: this.panel,
      onDragStart: (location) => this.controller.beginDrag(location).ok === true,
      onDrop: (location) => this.commitDrop(location),
      onCancel: () => this.controller.cancelDrag(),
    });

    this.controller.setKeyNavigationHandler((event) => this.keyboardNav.handleKey(event));
    this.unsubscribe = this.controller.subscribe((state) => this.render(state));
  }

  // ---------------------------------------------------------------- construction

  buildDom() {
    const overlay = document.createElement('div');
    overlay.className = 'inventory-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="inventory-panel" role="dialog" aria-modal="true" aria-label="Inventory">
        <div class="inventory-panel__frame" aria-hidden="true"></div>
        <header class="inventory-header">
          <h2>Inventory</h2>
          <p class="inventory-header__hint">Drag to move · double-click to equip · right-click for actions · 1 / 2 weapon sets</p>
          <button type="button" class="inventory-close" data-role="inventory-close" aria-label="Close inventory">✕</button>
        </header>

        <div class="inventory-character">
          <div class="inventory-weapon-column" data-side="left">
            <div class="inventory-set-tabs" role="group" aria-label="Weapon set" data-role="weapon-tabs-left"></div>
            <div class="inventory-weapon-slots" data-role="weapon-main"></div>
          </div>

          <div class="inventory-doll" data-role="inventory-doll"></div>

          <div class="inventory-weapon-column" data-side="right">
            <div class="inventory-set-tabs" role="group" aria-label="Weapon set" data-role="weapon-tabs-right"></div>
            <div class="inventory-weapon-slots" data-role="weapon-off"></div>
          </div>
        </div>

        <div class="inventory-gold">
          <span class="inventory-gold__coin" aria-hidden="true"></span>
          <span class="inventory-gold__value" data-role="inventory-gold">0</span>
          <span class="inventory-gold__label">gold</span>
        </div>

        <div class="inventory-bag" data-role="inventory-bag" role="group" aria-label="Bag"></div>

        <footer class="inventory-details" data-role="inventory-details">
          <div class="inventory-details__text">
            <span class="inventory-details__name" data-role="details-name">Nothing selected</span>
            <span class="inventory-details__meta" data-role="details-meta"></span>
          </div>
          <div class="inventory-details__actions" data-role="details-actions"></div>
        </footer>
      </div>
    `;
    this.root.append(overlay);

    this.overlay = overlay;
    this.panel = overlay.querySelector('.inventory-panel');
    this.doll = overlay.querySelector('[data-role="inventory-doll"]');
    this.bag = overlay.querySelector('[data-role="inventory-bag"]');
    this.goldValue = overlay.querySelector('[data-role="inventory-gold"]');
    this.detailsName = overlay.querySelector('[data-role="details-name"]');
    this.detailsMeta = overlay.querySelector('[data-role="details-meta"]');
    this.detailsActions = overlay.querySelector('[data-role="details-actions"]');
    this.closeButton = overlay.querySelector('[data-role="inventory-close"]');
    this.mainHandHost = overlay.querySelector('[data-role="weapon-main"]');
    this.offHandHost = overlay.querySelector('[data-role="weapon-off"]');
    this.tabHosts = [
      overlay.querySelector('[data-role="weapon-tabs-left"]'),
      overlay.querySelector('[data-role="weapon-tabs-right"]'),
    ];
  }

  buildSlots() {
    for (const descriptor of EQUIPMENT_SLOT_DESCRIPTORS) {
      const view = new InventorySlotView({ ...descriptor, kind: 'equipment' });
      this.slots.set(serializeLocation(descriptor.location), view);
      this.doll.append(view.button);
    }

    // Both hands exist for the active set only; switching sets re-points these nodes
    // instead of rebuilding them, which keeps focus and the DOM stable.
    for (const descriptor of WEAPON_SLOT_DESCRIPTORS) {
      const location = weaponLocation(WEAPON_SET_IDS[0], descriptor.slot);
      const view = new InventorySlotView({ ...descriptor, location, kind: 'weapon', area: null });
      this.weaponSlotViews.push({ descriptor, view });
      const host = descriptor.slot === 'mainHand' ? this.mainHandHost : this.offHandHost;
      host.append(view.button);
    }

    const capacity = this.store.getState().capacity;
    this.bagViews = [];
    for (let index = 0; index < capacity; index += 1) {
      const view = new InventorySlotView({
        location: bagLocation(index),
        label: `Bag slot ${index + 1}`,
        glyph: '',
        size: 'small',
        kind: 'bag',
      });
      this.bagViews.push(view);
      this.slots.set(serializeLocation(view.location), view);
      this.bag.append(view.button);
    }

    for (const host of this.tabHosts) {
      host.innerHTML = WEAPON_SET_IDS.map((setId) => (
        `<button type="button" class="inventory-set-tab" data-set="${setId}"`
        + ` aria-label="Weapon set ${weaponSetLabel(setId)}">${weaponSetLabel(setId)}</button>`
      )).join('');
    }
  }

  bindEvents() {
    this.handleOverlayClick = (event) => {
      if (event.target === this.overlay) this.controller.close();
    };
    this.handleClose = () => this.controller.close();

    this.handlePanelClick = (event) => {
      const tab = event.target.closest?.('.inventory-set-tab');
      if (tab) {
        this.controller.switchWeaponSet(Number(tab.dataset.set));
        return;
      }
      const actionButton = event.target.closest?.('[data-details-action]');
      if (actionButton) {
        this.runAction(actionButton.dataset.detailsAction, this.controller.selectedLocation);
        return;
      }

      this.contextMenu.hide();
      const location = this.locationFromEvent(event);
      if (!location) return;

      // Mouse and touch use different models on purpose. A mouse has drag for moving, so a
      // click only selects. Touch has no drag affordance here, so tap-select then
      // tap-destination is the move gesture.
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        const result = this.controller.activateLocation(location);
        this.reportResult(result, location);
      } else if (event.detail <= 1) {
        this.controller.selectLocation(location);
      }
    };

    this.handleDoubleClick = (event) => {
      const location = this.locationFromEvent(event);
      if (!location) return;
      this.reportResult(this.controller.doubleActivate(location), location);
    };

    this.handleContextMenu = (event) => {
      const location = this.locationFromEvent(event);
      if (!location) return;
      event.preventDefault();
      this.controller.openContextMenu(location, this.panelPoint(event));
    };

    this.handlePointerOver = (event) => {
      const location = this.locationFromEvent(event);
      if (!location) return;
      this.controller.hoverLocation(location);
      this.controller.setTooltip(location, this.panelPoint(event));
    };

    this.handlePointerOut = (event) => {
      if (event.relatedTarget && this.panel.contains(event.relatedTarget)) return;
      this.controller.hoverLocation(null);
      this.controller.clearTooltip();
    };

    this.handlePointerMove = (event) => {
      if (!this.controller.tooltip) return;
      this.tooltip.position(this.panelPoint(event));
    };

    // The world must never scroll or zoom because the pointer happened to be over an open
    // inventory.
    this.handleWheel = (event) => event.stopPropagation();

    this.overlay.addEventListener('click', this.handleOverlayClick);
    this.overlay.addEventListener('wheel', this.handleWheel, { passive: true });
    this.closeButton.addEventListener('click', this.handleClose);
    this.panel.addEventListener('click', this.handlePanelClick);
    this.panel.addEventListener('dblclick', this.handleDoubleClick);
    this.panel.addEventListener('contextmenu', this.handleContextMenu);
    this.panel.addEventListener('pointerover', this.handlePointerOver);
    this.panel.addEventListener('pointerout', this.handlePointerOut);
    this.panel.addEventListener('pointermove', this.handlePointerMove);
  }

  // ---------------------------------------------------------------- rendering

  render(state) {
    const opening = state.isOpen && !this.wasOpen;
    const closing = !state.isOpen && this.wasOpen;
    this.wasOpen = state.isOpen;

    this.overlay.hidden = !state.isOpen;
    if (closing) this.handleClosed();
    if (!state.isOpen) return;

    const inventory = state.inventory;
    this.repointWeaponSlots(inventory.activeWeaponSet);
    this.patchSlots(state, inventory);
    this.patchWeaponTabs(inventory.activeWeaponSet);

    this.goldValue.textContent = inventory.currency.gold.toLocaleString();
    this.renderDetails(state);
    this.renderTooltip(state);
    this.renderContextMenu(state);

    if (opening) this.handleOpened(inventory);
  }

  patchSlots(state, inventory) {
    const selected = state.selectedLocation;
    const hovered = state.hoveredLocation;
    const dragFrom = state.drag?.from ?? null;

    const patch = (view, entry) => {
      const definition = entry ? this.catalog?.get(entry.itemKey) ?? null : null;
      view.patch(entry, definition, {
        selected: sameLocation(view.location, selected),
        hovered: sameLocation(view.location, hovered),
        dragSource: sameLocation(view.location, dragFrom),
      });
    };

    for (const descriptor of EQUIPMENT_SLOT_DESCRIPTORS) {
      const view = this.slots.get(serializeLocation(descriptor.location));
      patch(view, inventory.equipment.armour[descriptor.slot]
        ?? inventory.equipment.accessories[descriptor.slot]
        ?? null);
    }

    const set = inventory.equipment.weaponSets[`set${inventory.activeWeaponSet}`] ?? {};
    for (const { descriptor, view } of this.weaponSlotViews) {
      patch(view, set[descriptor.slot] ?? null);
    }

    for (let index = 0; index < this.bagViews.length; index += 1) {
      patch(this.bagViews[index], inventory.bagSlots[index] ?? null);
    }
  }

  repointWeaponSlots(activeSet) {
    for (const { descriptor, view } of this.weaponSlotViews) {
      const location = weaponLocation(activeSet, descriptor.slot);
      if (serializeLocation(view.location) === serializeLocation(location)) continue;
      this.slots.delete(serializeLocation(view.location));
      view.setLocation(location);
      this.slots.set(serializeLocation(location), view);
    }
  }

  patchWeaponTabs(activeSet) {
    for (const host of this.tabHosts) {
      for (const tab of host.querySelectorAll('.inventory-set-tab')) {
        const active = Number(tab.dataset.set) === activeSet;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }
  }

  renderDetails(state) {
    const location = state.selectedLocation;
    const entry = location ? this.controller.readEntry(location) : null;
    const definition = entry ? this.catalog?.get(entry.itemKey) ?? null : null;

    if (!definition) {
      this.detailsName.textContent = 'Nothing selected';
      this.detailsName.removeAttribute('data-rarity');
      this.detailsMeta.textContent = '';
      this.setActions([]);
      this.pendingDrop = null;
      return;
    }

    this.detailsName.textContent = definition.label;
    this.detailsName.dataset.rarity = definition.rarity;

    const meta = [definition.rarity, definition.category];
    if (definition.hands === 2) meta.push('two-handed');
    meta.push(`weight ${definition.weight}`, `value ${definition.value}g`);
    if (entry.quantity > 1) meta.push(`×${entry.quantity}`);
    this.detailsMeta.textContent = meta.join(' · ');

    const equipped = location.kind === 'equipment' || location.kind === 'weapon';
    const actions = [];
    if (equipped) actions.push(['unequip', 'Unequip']);
    else if (definition.equipmentSlots?.length) actions.push(['equip', 'Equip']);
    if (definition.category === 'consumable') actions.push(['use', 'Use']);
    if (!equipped && definition.stackLimit > 1 && entry.quantity > 1) actions.push(['split', 'Split']);
    if (!equipped) {
      const dropping = this.pendingDrop != null && sameLocation(this.pendingDrop.location, location);
      actions.push(['drop', dropping ? 'Confirm drop' : 'Drop…', dropping]);
    }

    this.setActions(actions);
  }

  /**
   * Replace the footer buttons only when the action set actually changed.
   *
   * Rebuilding unconditionally is not merely wasteful: renderDetails runs on every emit,
   * including the hover emits, so recreating the buttons would destroy the element under
   * the pointer on each one. That fires pointerout/pointerover, which emits again, and the
   * footer never settles.
   */
  setActions(actions) {
    const signature = actions.map(([action, label, danger]) => `${action}:${label}:${danger ? 1 : 0}`).join('|');
    if (signature === this.actionSignature) return;
    this.actionSignature = signature;

    this.detailsActions.replaceChildren(...actions.map(([action, label, danger]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.detailsAction = action;
      if (danger) button.dataset.danger = 'true';
      button.textContent = label;
      return button;
    }));
  }

  renderTooltip(state) {
    if (!state.tooltip || state.drag) {
      this.tooltipSignature = null;
      this.tooltip.hide();
      return;
    }
    const entry = this.controller.readEntry(state.tooltip.location);
    const definition = entry ? this.catalog?.get(entry.itemKey) ?? null : null;

    // Same reasoning as setActions: only rebuild the markup when the hovered item changes.
    // Repositioning on pointer move is handled directly by handlePointerMove.
    const signature = `${entry?.itemKey ?? ''}|${entry?.quantity ?? 0}`;
    if (signature === this.tooltipSignature) {
      this.tooltip.position(state.tooltip.screen);
      return;
    }
    this.tooltipSignature = signature;
    this.tooltip.show(definition, entry?.quantity ?? 0, state.tooltip.screen);
  }

  renderContextMenu(state) {
    if (!state.contextMenu) {
      this.contextMenu.hide();
      return;
    }
    const definition = this.catalog?.get(state.contextMenu.itemKey) ?? null;
    this.contextMenu.show(state.contextMenu.location, definition, state.contextMenu.screen);
  }

  // ---------------------------------------------------------------- actions

  commitDrop(location) {
    if (!location) {
      this.controller.cancelDrag();
      return;
    }
    const result = this.controller.dropOn(location);
    this.reportResult(result, location);
  }

  runAction(action, location) {
    if (!location) return;
    const store = this.store;
    let result;

    switch (action) {
      case 'equip':
        result = store.equipItem(location);
        break;
      case 'unequip':
        result = store.unequipItem(location);
        break;
      case 'use':
        result = this.useItem(location);
        break;
      case 'split': {
        const entry = this.controller.readEntry(location);
        result = entry ? store.splitStack(location, Math.floor(entry.quantity / 2)) : null;
        break;
      }
      case 'drop':
        result = this.dropItem(location);
        break;
      default:
        return;
    }

    this.contextMenu.hide();
    this.controller.closeContextMenu();
    this.reportResult(result, location);
  }

  /**
   * The store stages a use and hands back a token so a gameplay action can confirm only
   * once it has actually run. That consumer is phase I6 and does not exist yet, so the UI
   * confirms immediately. When item actions land, this auto-confirm is the line that moves
   * to the action pipeline — the staging contract above it is already correct.
   */
  useItem(location) {
    const staged = this.store.useItem(location);
    if (!staged.ok || !staged.pending) return staged;
    return this.store.confirmUse(staged.token);
  }

  /** Dropping is destructive, so it takes two clicks: stage, then confirm. */
  dropItem(location) {
    if (this.pendingDrop && sameLocation(this.pendingDrop.location, location)) {
      const { token, quantity } = this.pendingDrop;
      this.pendingDrop = null;
      return this.store.confirmDrop(token, quantity);
    }

    const entry = this.controller.readEntry(location);
    if (!entry) return { ok: false, code: 'empty_slot', message: 'Slot is empty.' };
    const staged = this.store.dropItem(location);
    if (!staged.ok) return staged;
    this.pendingDrop = { location, token: staged.token, quantity: entry.quantity };
    this.controller.emit();
    return { ok: true };
  }

  reportResult(result, location) {
    if (!result || result.ok) return;
    const key = serializeLocation(location);
    this.slots.get(key)?.flashInvalid();
    if (result.message) {
      this.detailsMeta.textContent = result.message;
    }
  }

  // ---------------------------------------------------------------- lifecycle

  handleOpened(inventory) {
    this.warmIcons(inventory);
    this.previousFocus = document.activeElement;
    this.keyboardNav.focusFirstSlot();
  }

  handleClosed() {
    this.pendingDrop = null;
    this.tooltip.hide();
    this.contextMenu.hide();
    // Hand focus back to the viewport so the player can move again without clicking first.
    const target = this.previousFocus ?? document.querySelector('canvas');
    this.previousFocus = null;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }

  /**
   * Decode the icons that are actually in the bag, once, on first open. Doing it here
   * rather than at boot keeps inventory art off the first-frame path entirely.
   */
  warmIcons(inventory) {
    if (this.iconsWarmed || typeof Image === 'undefined') return;
    this.iconsWarmed = true;
    const keys = new Set();
    for (const entry of inventory.bagSlots) if (entry) keys.add(entry.itemKey);
    for (const key of keys) {
      const definition = this.catalog?.get(key);
      if (!definition?.icon) continue;
      const image = new Image();
      image.decoding = 'async';
      image.src = definition.icon;
    }
  }

  // ---------------------------------------------------------------- helpers

  slotButtons() {
    return [...this.panel.querySelectorAll('.inventory-slot')];
  }

  locationFromEvent(event) {
    const slot = event.target.closest?.('[data-location]');
    return slot ? parseLocation(slot.dataset.location) : null;
  }

  panelPoint(event) {
    const bounds = this.panel.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  dispose() {
    this.unsubscribe?.();
    this.controller.setKeyNavigationHandler(null);
    this.overlay.removeEventListener('click', this.handleOverlayClick);
    this.overlay.removeEventListener('wheel', this.handleWheel);
    this.closeButton.removeEventListener('click', this.handleClose);
    this.panel.removeEventListener('click', this.handlePanelClick);
    this.panel.removeEventListener('dblclick', this.handleDoubleClick);
    this.panel.removeEventListener('contextmenu', this.handleContextMenu);
    this.panel.removeEventListener('pointerover', this.handlePointerOver);
    this.panel.removeEventListener('pointerout', this.handlePointerOut);
    this.panel.removeEventListener('pointermove', this.handlePointerMove);
    this.dragLayer.dispose();
    this.tooltip.dispose();
    this.contextMenu.dispose();
    this.slots.clear();
    this.overlay.remove();
  }
}

function sameLocation(left, right) {
  if (!left || !right) return false;
  return serializeLocation(left) === serializeLocation(right);
}
