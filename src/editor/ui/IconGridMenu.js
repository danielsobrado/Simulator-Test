/**
 * A compact translucent grid of icon tiles.
 *
 * The sibling of `RadialPalette`: same ownership model (owns its DOM, reports
 * through callbacks, knows nothing about walls or materials), same
 * pure-markup-function split so its layout is testable in Node. The difference
 * is shape — a radial menu runs out of room past about eight petals, and the
 * variant sets this replaces (six opening kinds, four profiles, four bonds)
 * want to be *scanned* side by side rather than aimed at.
 *
 * Groups stack as rows and each carries its own column count, which is what
 * gives the ragged layout of the reference: a wide row of kinds above a short
 * row of profiles, one panel, no headings taking up space.
 *
 * The stylesheet is imported by the composition root rather than here — this
 * module is unit-tested and Node's loader cannot resolve a CSS import. See
 * `compactMenus.css`, imported from `src/main.js`.
 */

import { escapeAttribute } from './markup.js';

const DEFAULT_COLUMNS = 6;
/** Gap between the pointer and the panel, and between the panel and the host edge. */
const EDGE_MARGIN = 8;

function buildTile(item) {
  const classes = ['icon-grid__tile'];
  if (item.active) classes.push('is-active');
  // `aria-pressed` only where the caller actually models a pressed state;
  // emitting it on a plain action would announce a toggle that does not exist.
  const pressed = item.active === undefined ? '' : ` aria-pressed="${Boolean(item.active)}"`;
  return `<button type="button" role="menuitem" class="${classes.join(' ')}"`
    + ` data-grid-item="${escapeAttribute(item.id)}"`
    + ` aria-label="${escapeAttribute(item.label)}"`
    + ` title="${escapeAttribute(item.label)}"`
    + `${pressed}>`
    // Icon markup is inserted raw — see the note in `markup.js`. It must come
    // from `icons.js`, never from a world document.
    + `${item.icon ?? ''}</button>`;
}

/**
 * Build the panel's markup.
 *
 * @param options.groups `[{ id, label, columns, items: [{ id, icon, label, active }] }]`
 * @param options.columns default column count for groups that do not set one.
 */
export function buildIconGridMarkup({ groups = [], columns = DEFAULT_COLUMNS } = {}) {
  return groups
    .map((group) => {
      const items = group?.items ?? [];
      // An empty group renders nothing rather than an empty row, so a caller can
      // build groups conditionally without leaving gaps in the panel.
      if (items.length === 0) return '';
      const label = group.label ? ` aria-label="${escapeAttribute(group.label)}"` : '';
      const id = group.id ? ` data-grid-group="${escapeAttribute(group.id)}"` : '';
      const columnCount = group.columns ?? columns;
      return `<div class="icon-grid__group" role="group"${id}${label}`
        + ` style="--grid-columns:${Number(columnCount) || DEFAULT_COLUMNS}">`
        + items.map(buildTile).join('')
        + '</div>';
    })
    .join('');
}

export class IconGridMenu {
  /**
   * @param options.host element the panel positions itself inside.
   * @param options.modifier extra class for caller-specific colours.
   */
  constructor({
    host,
    modifier = '',
    onSelect = null,
    onHover = null,
    onHoverEnd = null,
    onClose = null,
  }) {
    if (!host) throw new Error('An icon grid menu needs a host element.');
    this.host = host;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onHoverEnd = onHoverEnd;
    this.onClose = onClose;

    this.element = document.createElement('div');
    this.element.className = `icon-grid${modifier ? ` ${modifier}` : ''}`;
    this.element.setAttribute('role', 'menu');
    this.element.hidden = true;
    this.host.append(this.element);

    this.boundClick = (event) => this.handleClick(event);
    this.boundPointerOver = (event) => this.handlePointerOver(event);
    this.boundPointerOut = (event) => this.handlePointerOut(event);
    this.element.addEventListener('click', this.boundClick);
    this.element.addEventListener('pointerover', this.boundPointerOver);
    this.element.addEventListener('pointerout', this.boundPointerOut);
  }

  get isOpen() {
    return !this.element.hidden;
  }

  get buttons() {
    return [...this.element.querySelectorAll('button')];
  }

  /**
   * @param options.focus whether to move focus onto the first tile. Re-rendering
   *   an already-open panel passes `false`: a keyboard user who has arrowed to
   *   the fourth tile and pressed it should not be thrown back to the first.
   */
  open({ clientX, clientY, groups = [], columns = DEFAULT_COLUMNS, focus = true }) {
    const active = document.activeElement?.dataset?.gridItem ?? null;
    this.element.innerHTML = buildIconGridMarkup({ groups, columns });
    this.element.hidden = false;

    // Measured rather than derived: unlike the radial palette, whose radius is
    // known from its rings, a grid's size depends on how many groups the caller
    // passed. One reflow on open, none while it is up.
    const bounds = this.host.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    const rect = this.element.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const maxX = Math.max(EDGE_MARGIN, bounds.width - rect.width - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, bounds.height - rect.height - EDGE_MARGIN);
    const x = Math.min(maxX, Math.max(EDGE_MARGIN, clientX - bounds.left + EDGE_MARGIN));
    const y = Math.min(maxY, Math.max(EDGE_MARGIN, clientY - bounds.top + EDGE_MARGIN));
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    if (focus) this.buttons[0]?.focus();
    // Re-rendering replaces the element the user was on, so restore focus to the
    // tile with the same id rather than leaving it on a detached node.
    else if (active) this.element.querySelector(`[data-grid-item="${CSS.escape(active)}"]`)?.focus();
  }

  close({ notify = true } = {}) {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.element.innerHTML = '';
    if (notify) this.onClose?.();
  }

  /** Arrow-key navigation between tiles, in reading order across all groups. */
  focusStep(delta) {
    const buttons = this.buttons;
    if (buttons.length === 0) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  }

  handleClick(event) {
    const item = event.target.closest('[data-grid-item]');
    if (item) this.onSelect?.(item.dataset.gridItem);
  }

  handlePointerOver(event) {
    const item = event.target.closest('[data-grid-item]');
    if (item) this.onHover?.(item.dataset.gridItem);
  }

  handlePointerOut(event) {
    if (event.target.closest('[data-grid-item]')) this.onHoverEnd?.();
  }

  dispose() {
    this.element.removeEventListener('click', this.boundClick);
    this.element.removeEventListener('pointerover', this.boundPointerOver);
    this.element.removeEventListener('pointerout', this.boundPointerOut);
    this.element.remove();
  }
}
