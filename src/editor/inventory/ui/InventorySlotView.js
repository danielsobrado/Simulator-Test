import { serializeLocation } from '../inventoryLocations.js';
import { CATEGORY_GLYPHS, describeSlot } from './inventoryLayout.js';

/**
 * One inventory slot as a persistent DOM node.
 *
 * The controller emits on every hover and selection change, not just on store mutations,
 * so patch() is the hot path: it folds the slot's whole visible state into a signature
 * string and returns without touching the DOM when nothing changed. A pointer moving
 * across the grid therefore costs 53 string comparisons and two element updates.
 */
export class InventorySlotView {
  /**
   * @param {{
   *   location: object,
   *   label: string,
   *   glyph?: string,
   *   size?: string,
   *   area?: string,
   *   kind?: string,
   * }} options
   */
  constructor({ location, label, glyph = '·', size = 'small', area = null, kind = 'equipment' }) {
    this.location = location;
    this.label = label;
    this.signature = null;
    this.emptyGlyph = glyph;
    this.definition = null;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-slot';
    button.dataset.location = serializeLocation(location);
    button.dataset.size = size;
    button.dataset.kind = kind;
    button.dataset.empty = 'true';
    // Roving tabindex: InventoryKeyboardNav promotes exactly one slot to 0 at a time so
    // Tab steps over the grid rather than through all 53 buttons.
    button.tabIndex = -1;
    if (area) button.style.gridArea = area;

    const well = document.createElement('span');
    well.className = 'inventory-slot__well';
    well.setAttribute('aria-hidden', 'true');

    const placeholder = document.createElement('span');
    placeholder.className = 'inventory-slot__placeholder';
    placeholder.textContent = glyph;

    const icon = document.createElement('img');
    icon.className = 'inventory-slot__icon';
    icon.alt = '';
    icon.decoding = 'async';
    icon.draggable = false;
    icon.hidden = true;
    // A dangling icon path must degrade to the category glyph rather than a broken image;
    // config/items.yaml points at art that may not have been authored yet.
    //
    // This fires asynchronously, after patch() has already hidden the placeholder in
    // anticipation of an icon that then failed to load. Restoring the glyph here is what
    // keeps an item visible at all — without it every slot reads as empty until the art
    // exists.
    icon.addEventListener('error', () => {
      this.button.dataset.icon = 'missing';
      this.icon.hidden = true;
      this.showPlaceholderGlyph();
    });

    const quantity = document.createElement('span');
    quantity.className = 'inventory-slot__quantity';
    quantity.hidden = true;

    const rarity = document.createElement('span');
    rarity.className = 'inventory-slot__rarity';
    rarity.setAttribute('aria-hidden', 'true');

    well.append(placeholder, icon, rarity);
    button.append(well, quantity);

    button.addEventListener('animationend', () => button.classList.remove('is-invalid'));

    this.button = button;
    this.icon = icon;
    this.quantity = quantity;
    this.placeholder = placeholder;
  }

  /**
   * @param {object | null} entry inventory entry occupying this slot
   * @param {object | null} definition catalog definition for that entry
   * @param {{ selected?: boolean, hovered?: boolean, dragSource?: boolean, focused?: boolean }} flags
   */
  patch(entry, definition, flags = {}) {
    const itemKey = entry?.itemKey ?? '';
    const count = entry?.quantity ?? 0;
    const selected = flags.selected === true;
    const hovered = flags.hovered === true;
    const dragSource = flags.dragSource === true;

    const signature = `${itemKey}|${count}|${selected ? 1 : 0}|${hovered ? 1 : 0}|${dragSource ? 1 : 0}`;
    if (signature === this.signature) return;
    this.signature = signature;

    const button = this.button;
    button.dataset.empty = entry ? 'false' : 'true';
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.setAttribute('aria-label', describeSlot(this.label, definition, count));
    button.classList.toggle('is-selected', selected);
    button.classList.toggle('is-hovered', hovered);
    button.classList.toggle('is-drag-source', dragSource);

    this.definition = definition;

    if (!entry) {
      this.icon.hidden = true;
      this.icon.removeAttribute('src');
      this.quantity.hidden = true;
      this.placeholder.hidden = false;
      this.placeholder.textContent = this.emptyGlyph;
      delete button.dataset.rarity;
      delete button.dataset.icon;
      return;
    }

    if (definition?.icon) {
      // Only reassign src when the item actually changed, or the browser re-decodes on
      // every hover. A fresh src also clears the stale "missing" mark from the last item.
      if (this.icon.getAttribute('src') !== definition.icon) {
        delete button.dataset.icon;
        this.icon.src = definition.icon;
      }
      const missing = button.dataset.icon === 'missing';
      this.icon.hidden = missing;
      this.placeholder.hidden = !missing;
      if (missing) this.showPlaceholderGlyph();
    } else {
      this.icon.hidden = true;
      this.showPlaceholderGlyph();
    }

    button.dataset.rarity = definition?.rarity ?? 'common';
    this.quantity.hidden = count <= 1;
    if (count > 1) this.quantity.textContent = String(count);
  }

  /** Show the occupying item's category glyph in place of an icon that is not available. */
  showPlaceholderGlyph() {
    if (!this.definition) return;
    this.placeholder.hidden = false;
    this.placeholder.textContent = CATEGORY_GLYPHS[this.definition.category] ?? '✦';
  }

  /** Re-point a weapon slot at a different weapon set without rebuilding the node. */
  setLocation(location) {
    this.location = location;
    this.button.dataset.location = serializeLocation(location);
    this.signature = null;
  }

  /** Brief red pulse for a rejected drop. The store was never mutated, so this is cosmetic. */
  flashInvalid() {
    this.button.classList.remove('is-invalid');
    // Force a reflow so the animation restarts when the same slot is rejected twice.
    void this.button.offsetWidth;
    this.button.classList.add('is-invalid');
  }

  setTabbable(tabbable) {
    this.button.tabIndex = tabbable ? 0 : -1;
  }
}
