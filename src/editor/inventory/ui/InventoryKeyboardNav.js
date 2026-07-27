import { BAG_GRID_COLUMNS } from './inventoryLayout.js';

/**
 * Arrow-key slot navigation and a Tab focus trap for the open inventory.
 *
 * This deliberately does not listen for keydown. GameplayOverlayController owns a
 * capture-phase listener on globalThis and calls stopImmediatePropagation on every key
 * while an overlay is open, so any listener added here would never fire. Instead
 * InventoryUi registers handleKey() through InventoryController.setKeyNavigationHandler,
 * which runs inside the one path the coordinator forwards.
 *
 * Returning true from handleKey causes the coordinator to preventDefault. Returning false
 * leaves the browser default intact, which is how Enter and Space still activate a focused
 * button without any code here.
 */
export class InventoryKeyboardNav {
  /**
   * @param {{ panel: HTMLElement, getSlotButtons: () => HTMLElement[] }} options
   */
  constructor({ panel, getSlotButtons }) {
    this.panel = panel;
    this.getSlotButtons = getSlotButtons;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {boolean} true when the key was consumed
   */
  handleKey(event) {
    if (event.key === 'Tab') return this.trapTab(event);

    const delta = ARROW_DELTAS[event.key];
    if (!delta) return false;

    const buttons = this.getSlotButtons();
    if (buttons.length === 0) return false;

    const current = document.activeElement;
    const index = buttons.indexOf(current);
    if (index < 0) {
      this.focusSlot(buttons, 0);
      return true;
    }

    const bagButtons = buttons.filter((button) => button.dataset.kind === 'bag');
    const bagIndex = bagButtons.indexOf(current);

    // Inside the bag the arrows read as a real grid; elsewhere the paper doll has no
    // regular geometry, so stepping through the DOM order is the honest behaviour.
    const next = bagIndex >= 0
      ? this.stepInGrid(bagButtons, bagIndex, delta)
      : clamp(index + (delta.x + delta.y * BAG_GRID_COLUMNS), 0, buttons.length - 1);

    this.focusSlot(bagIndex >= 0 ? bagButtons : buttons, next);
    return true;
  }

  stepInGrid(buttons, index, delta) {
    const columns = this.currentColumns();
    const rows = Math.ceil(buttons.length / columns);
    let column = index % columns;
    let row = Math.floor(index / columns);

    column = clamp(column + delta.x, 0, columns - 1);
    row = clamp(row + delta.y, 0, rows - 1);

    return clamp(row * columns + column, 0, buttons.length - 1);
  }

  /**
   * Read the column count back from layout rather than assuming the desktop value, so
   * arrow navigation still matches what the player sees after the narrow breakpoint
   * halves the grid.
   */
  currentColumns() {
    const grid = this.panel.querySelector('[data-role="inventory-bag"]');
    if (!grid) return BAG_GRID_COLUMNS;
    const template = getComputedStyle(grid).gridTemplateColumns;
    const count = template?.split(' ').filter(Boolean).length ?? 0;
    return count > 0 ? count : BAG_GRID_COLUMNS;
  }

  focusSlot(buttons, index) {
    const button = buttons[index];
    if (!button) return;
    for (const other of this.getSlotButtons()) other.tabIndex = -1;
    button.tabIndex = 0;
    button.focus();
  }

  /**
   * Keep focus inside the overlay. The world behind is inert while the inventory is open,
   * so letting Tab escape would strand focus on something the player cannot see.
   */
  trapTab(event) {
    const focusable = [...this.panel.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter((element) => element.tabIndex >= 0 && !element.hidden && element.offsetParent !== null);
    if (focusable.length === 0) return false;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !this.panel.contains(active))) {
      last.focus();
      return true;
    }
    if (!event.shiftKey && (active === last || !this.panel.contains(active))) {
      first.focus();
      return true;
    }
    return false;
  }

  /** Called when the overlay opens so the first Tab has somewhere sensible to start. */
  focusFirstSlot() {
    const buttons = this.getSlotButtons();
    const filled = buttons.find((button) => button.dataset.empty === 'false');
    const target = filled ?? buttons[0];
    if (!target) return;
    for (const other of buttons) other.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  }
}

const ARROW_DELTAS = Object.freeze({
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
});

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
