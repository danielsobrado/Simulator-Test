import { parseLocation } from '../inventoryLocations.js';

/** Pointer travel, in px, before a press is treated as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Pointer-driven drag for inventory slots.
 *
 * HTML5 drag-and-drop is not used anywhere in this project; every drag (map panning, the
 * editor's brush strokes) is built from pointerdown/pointermove plus setPointerCapture,
 * and the inventory follows suit. That also keeps touch and mouse on one code path.
 *
 * Dragging is visual state only: nothing is committed until a drop resolves to a valid
 * location, so an abandoned drag can never leave the store half-mutated.
 */
export class InventoryDragLayer {
  /**
   * @param {{
   *   panel: HTMLElement,
   *   container: HTMLElement,
   *   onDragStart: (location: object) => boolean,
   *   onDrop: (location: object | null) => void,
   *   onCancel: () => void,
   * }} options
   */
  constructor({ panel, container, onDragStart, onDrop, onCancel }) {
    this.panel = panel;
    this.container = container;
    this.onDragStart = onDragStart;
    this.onDrop = onDrop;
    this.onCancel = onCancel;

    this.pending = null;
    this.active = false;
    this.pointerId = null;

    const ghost = document.createElement('div');
    ghost.className = 'inventory-drag-ghost';
    ghost.hidden = true;
    // Without this, elementFromPoint during the drop resolves to the ghost itself.
    ghost.style.pointerEvents = 'none';
    container.append(ghost);
    this.ghost = ghost;

    this.handlePointerDown = (event) => this.beginPress(event);
    this.handlePointerMove = (event) => this.movePress(event);
    this.handlePointerUp = (event) => this.endPress(event);
    this.handleWindowBlur = () => this.abort();

    panel.addEventListener('pointerdown', this.handlePointerDown);
    panel.addEventListener('pointermove', this.handlePointerMove);
    panel.addEventListener('pointerup', this.handlePointerUp);
    panel.addEventListener('pointercancel', this.handleWindowBlur);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  beginPress(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const slot = event.target.closest?.('[data-location]');
    if (!slot || slot.dataset.empty === 'true') return;
    const location = parseLocation(slot.dataset.location);
    if (!location) return;

    this.pending = {
      location,
      x: event.clientX,
      y: event.clientY,
      icon: slot.querySelector('.inventory-slot__icon'),
      glyph: slot.querySelector('.inventory-slot__placeholder'),
    };
    this.pointerId = event.pointerId;
  }

  movePress(event) {
    if (!this.pending || event.pointerId !== this.pointerId) return;

    if (!this.active) {
      const travelled = Math.hypot(event.clientX - this.pending.x, event.clientY - this.pending.y);
      if (travelled < DRAG_THRESHOLD_PX) return;
      if (this.onDragStart(this.pending.location) !== true) {
        this.pending = null;
        return;
      }
      this.active = true;
      this.showGhost();
      this.panel.setPointerCapture?.(event.pointerId);
      this.panel.classList.add('is-dragging');
    }

    this.positionGhost(event.clientX, event.clientY);
    event.preventDefault();
  }

  endPress(event) {
    if (event.pointerId !== this.pointerId) return;
    if (!this.active) {
      this.pending = null;
      this.pointerId = null;
      return;
    }

    // The ghost is pointer-events:none, but hide it anyway so hit-testing can never be
    // confused by a stacking-context edge case.
    this.ghost.hidden = true;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const slot = target?.closest?.('[data-location]') ?? null;
    const location = slot ? parseLocation(slot.dataset.location) : null;

    this.reset(event.pointerId);
    this.onDrop(location);
  }

  abort() {
    if (!this.active) {
      this.pending = null;
      this.pointerId = null;
      return;
    }
    this.reset(this.pointerId);
    this.onCancel();
  }

  reset(pointerId) {
    if (pointerId != null) this.panel.releasePointerCapture?.(pointerId);
    this.panel.classList.remove('is-dragging');
    this.ghost.hidden = true;
    this.ghost.replaceChildren();
    this.pending = null;
    this.active = false;
    this.pointerId = null;
  }

  showGhost() {
    const { icon, glyph } = this.pending;
    this.ghost.replaceChildren();
    if (icon && !icon.hidden && icon.getAttribute('src')) {
      const clone = icon.cloneNode(true);
      clone.hidden = false;
      this.ghost.append(clone);
    } else if (glyph) {
      const clone = glyph.cloneNode(true);
      clone.hidden = false;
      this.ghost.append(clone);
    }
    this.ghost.hidden = false;
  }

  positionGhost(clientX, clientY) {
    const bounds = this.container.getBoundingClientRect();
    this.ghost.style.left = `${clientX - bounds.left}px`;
    this.ghost.style.top = `${clientY - bounds.top}px`;
  }

  dispose() {
    this.panel.removeEventListener('pointerdown', this.handlePointerDown);
    this.panel.removeEventListener('pointermove', this.handlePointerMove);
    this.panel.removeEventListener('pointerup', this.handlePointerUp);
    this.panel.removeEventListener('pointercancel', this.handleWindowBlur);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.ghost.remove();
  }
}
