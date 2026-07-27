/**
 * Right-click action menu for a slot. Every action it offers is also reachable from the
 * details footer, because touch has no right-click and the plan requires that long-press
 * never be the only route to an essential action.
 */
export class InventoryContextMenu {
  /**
   * @param {{ container: HTMLElement, onAction: (action: string, location: object) => void }} options
   */
  constructor({ container, onAction }) {
    this.container = container;
    this.onAction = onAction;
    this.location = null;

    const element = document.createElement('div');
    element.className = 'inventory-context-menu';
    element.setAttribute('role', 'menu');
    element.hidden = true;
    container.append(element);
    this.element = element;

    this.handleClick = (event) => {
      const button = event.target.closest?.('[data-action]');
      if (!button || !this.location) return;
      event.preventDefault();
      event.stopPropagation();
      this.onAction(button.dataset.action, this.location);
    };
    element.addEventListener('click', this.handleClick);
  }

  /**
   * @param {object} location
   * @param {object | null} definition
   * @param {{ x: number, y: number } | null} screen panel-relative pointer position
   */
  show(location, definition, screen) {
    this.location = location;
    const equipped = location.kind === 'equipment' || location.kind === 'weapon';
    const actions = [];

    if (equipped) {
      actions.push({ action: 'unequip', label: 'Unequip' });
    } else if (definition?.equipmentSlots?.length) {
      actions.push({ action: 'equip', label: 'Equip' });
    }
    if (definition?.category === 'consumable') {
      actions.push({ action: 'use', label: 'Use' });
    }
    if (!equipped && definition && definition.stackLimit > 1) {
      actions.push({ action: 'split', label: 'Split stack' });
    }
    if (!equipped) {
      actions.push({ action: 'drop', label: 'Drop…', danger: true });
    }

    if (actions.length === 0) {
      this.hide();
      return;
    }

    this.element.innerHTML = actions.map((entry) => (
      `<button type="button" role="menuitem" data-action="${entry.action}"`
      + `${entry.danger ? ' data-danger="true"' : ''}>${entry.label}</button>`
    )).join('');
    this.element.hidden = false;
    this.position(screen);
  }

  position(screen) {
    if (!screen) return;
    const bounds = this.container.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    this.element.style.left = `${Math.min(Math.max(8, screen.x), Math.max(8, bounds.width - width - 8))}px`;
    this.element.style.top = `${Math.min(Math.max(8, screen.y), Math.max(8, bounds.height - height - 8))}px`;
  }

  hide() {
    this.element.hidden = true;
    this.location = null;
  }

  dispose() {
    this.element.removeEventListener('click', this.handleClick);
    this.element.remove();
  }
}
