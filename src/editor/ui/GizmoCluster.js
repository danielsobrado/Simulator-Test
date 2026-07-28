/**
 * The floating action cluster that sits on a selected object.
 *
 * Small round-square buttons arranged around a point — cut and properties above
 * and below, duplicate and delete to one side, the variant grid to the other.
 * It is the third member of the family with `RadialPalette` and `IconGridMenu`:
 * owns its DOM, reports through callbacks, and splits a pure markup function out
 * so its layout is testable in Node.
 *
 * Placement is expressed as a **named slot**, not coordinates. The markup
 * function only emits the slot's class and the offsets live in
 * `compactMenus.css`, so nudging the arrangement is a stylesheet change and the
 * test can assert intent (`this button is on the left`) rather than pixels.
 *
 * The stylesheet is imported by the composition root — see `compactMenus.css`,
 * imported from `src/main.js`.
 */

import { escapeAttribute } from './markup.js';

export const GIZMO_SLOTS = Object.freeze([
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);

const GIZMO_SLOT_SET = new Set(GIZMO_SLOTS);
const FALLBACK_SLOT = 'center';

/** The slot to render `action` in; anything unrecognised stacks in the centre. */
export function resolveGizmoSlot(slot) {
  return GIZMO_SLOT_SET.has(slot) ? slot : FALLBACK_SLOT;
}

/**
 * Build the cluster's markup.
 *
 * @param options.actions `[{ id, icon, label, slot, active }]`
 */
export function buildGizmoClusterMarkup({ actions = [] } = {}) {
  return actions
    .map((action) => {
      const slot = resolveGizmoSlot(action.slot);
      const classes = ['icon-gizmo__button', `icon-gizmo__button--${slot}`];
      if (action.active) classes.push('is-active');
      const pressed = action.active === undefined
        ? ''
        : ` aria-pressed="${Boolean(action.active)}"`;
      return `<button type="button" class="${classes.join(' ')}"`
        + ` data-gizmo-action="${escapeAttribute(action.id)}"`
        + ` data-gizmo-slot="${slot}"`
        + ` aria-label="${escapeAttribute(action.label)}"`
        + ` title="${escapeAttribute(action.label)}"`
        + `${pressed}>`
        // Raw by design — icon markup comes from `icons.js`. See `markup.js`.
        + `${action.icon ?? ''}</button>`;
    })
    .join('');
}

export class GizmoCluster {
  constructor({ host, modifier = '', onAction = null, onClose = null }) {
    if (!host) throw new Error('A gizmo cluster needs a host element.');
    this.host = host;
    this.onAction = onAction;
    this.onClose = onClose;

    this.element = document.createElement('div');
    this.element.className = `icon-gizmo${modifier ? ` ${modifier}` : ''}`;
    this.element.setAttribute('role', 'toolbar');
    this.element.hidden = true;
    this.host.append(this.element);

    this.boundClick = (event) => this.handleClick(event);
    this.element.addEventListener('click', this.boundClick);
  }

  get isOpen() {
    return !this.element.hidden;
  }

  get buttons() {
    return [...this.element.querySelectorAll('button')];
  }

  /**
   * Open centred on the pointer.
   *
   * Anchored to the event rather than to a projection of the selection: there is
   * no world-to-screen helper in the editor, and adding a per-frame one to keep
   * the cluster glued to a moving wall would put DOM writes in the frame loop.
   */
  open({ clientX, clientY, actions = [] }) {
    this.element.innerHTML = buildGizmoClusterMarkup({ actions });
    this.element.hidden = false;

    const bounds = this.host.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    // The cluster is centred on its origin, so it needs its own half-extent of
    // clearance on every side to stay reachable near a viewport edge.
    const rect = this.element.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const halfWidth = rect.width / 2;
    const halfHeight = rect.height / 2;
    const x = Math.min(
      Math.max(halfWidth, bounds.width - halfWidth),
      Math.max(halfWidth, clientX - bounds.left),
    );
    const y = Math.min(
      Math.max(halfHeight, bounds.height - halfHeight),
      Math.max(halfHeight, clientY - bounds.top),
    );
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }

  close({ notify = true } = {}) {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.element.innerHTML = '';
    if (notify) this.onClose?.();
  }

  handleClick(event) {
    const action = event.target.closest('[data-gizmo-action]');
    if (action) this.onAction?.(action.dataset.gizmoAction);
  }

  dispose() {
    this.element.removeEventListener('click', this.boundClick);
    this.element.remove();
  }
}
