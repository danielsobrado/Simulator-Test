/**
 * Hover tooltip for an inventory slot, positioned near the pointer but clamped inside the
 * panel. Follows the clamping approach already used by WorldMapUi.showTooltip.
 */
export class InventoryTooltip {
  /** @param {{ container: HTMLElement }} options */
  constructor({ container }) {
    this.container = container;

    const element = document.createElement('div');
    element.className = 'inventory-tooltip';
    element.setAttribute('role', 'tooltip');
    element.hidden = true;
    container.append(element);
    this.element = element;
  }

  /**
   * @param {object} definition catalog definition of the hovered item
   * @param {number} quantity
   * @param {{ x: number, y: number } | null} screen pointer position, panel-relative
   */
  show(definition, quantity, screen) {
    if (!definition) {
      this.hide();
      return;
    }

    const lines = [];
    lines.push(`<div class="inventory-tooltip__name" data-rarity="${definition.rarity}">${escapeHtml(definition.label)}</div>`);

    const traits = [definition.rarity, definition.category];
    if (definition.weaponType) traits.push(definition.weaponType);
    if (definition.hands === 2) traits.push('two-handed');
    lines.push(`<div class="inventory-tooltip__traits">${escapeHtml(traits.join(' · '))}</div>`);

    const stats = [`Weight ${formatNumber(definition.weight)}`, `Value ${definition.value}g`];
    if (quantity > 1) stats.unshift(`Quantity ${quantity}`);
    lines.push(`<div class="inventory-tooltip__stats">${escapeHtml(stats.join('   '))}</div>`);

    if (definition.equipmentSlots?.length) {
      lines.push('<div class="inventory-tooltip__hint">Double-click to equip</div>');
    } else if (definition.category === 'consumable') {
      lines.push('<div class="inventory-tooltip__hint">Double-click to use</div>');
    }

    this.element.innerHTML = lines.join('');
    this.element.hidden = false;
    this.position(screen);
  }

  position(screen) {
    if (!screen) return;
    const bounds = this.container.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const maxLeft = Math.max(8, bounds.width - width - 8);
    const maxTop = Math.max(8, bounds.height - height - 8);
    this.element.style.left = `${Math.min(Math.max(8, screen.x + 16), maxLeft)}px`;
    this.element.style.top = `${Math.min(Math.max(8, screen.y + 16), maxTop)}px`;
  }

  hide() {
    this.element.hidden = true;
  }

  dispose() {
    this.element.remove();
  }
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}
