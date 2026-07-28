/**
 * A circular pop-up menu, extracted from the workshop's material palette.
 *
 * The workshop version solved petal layout, hover preview, keyboard navigation
 * and clamping to the viewport; this is that, generalised so the live
 * construction tool can reuse it instead of growing a second implementation
 * that drifts. The one capability added is **multiple rings**, which is why
 * `open` takes `rings` rather than a flat item list: the construction palette
 * needs material presets and wall-top actions visible at once.
 *
 * The component owns its own DOM and events and reports through callbacks. It
 * knows nothing about materials, presets or walls.
 */

// The stylesheet is imported by the composition root rather than here: this
// module's layout maths is unit-tested, and Node's loader cannot resolve a CSS
// import. See `radialPalette.css`, imported from `src/main.js`.
const DEFAULT_RING_RADIUS = 79;
/** Clearance from the outermost ring to the palette's own edge, in pixels. */
const RING_MARGIN = 40;

/** The radius the palette has to reserve for the rings it was given. */
export function paletteRadius(rings = []) {
  return Math.max(
    DEFAULT_RING_RADIUS,
    ...rings.map((ring) => ring.radius ?? DEFAULT_RING_RADIUS),
  ) + RING_MARGIN;
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Angle of petal `index` of `count`: first at the top, then evenly around. */
export function petalAngle(index, count) {
  return -90 + index * (360 / Math.max(1, count));
}

/**
 * Build the palette's markup.
 *
 * Pure and exported so layout is testable in Node — this repo has no DOM test
 * harness, and the geometry (petal count, angles, ring radii) is exactly the
 * part worth pinning.
 */
export function buildRadialMarkup({ rings = [], center = null, footer = null } = {}) {
  const markup = [];
  for (const ring of rings) {
    const radius = ring.radius ?? DEFAULT_RING_RADIUS;
    const items = ring.items ?? [];
    items.forEach((item, index) => {
      const style = [
        `--angle:${petalAngle(index, items.length)}deg`,
        `--ring-radius:${radius}px`,
        item.color ? `--petal-color:${escapeAttribute(item.color)}` : '',
      ].filter(Boolean).join(';');
      markup.push(`<button type="button" role="menuitem" class="radial-palette__petal"`
        + ` data-radial-item="${escapeAttribute(item.id)}"`
        + ` style="${style}"`
        + ` aria-label="${escapeAttribute(item.label)}"`
        + ` title="${escapeAttribute(item.label)}"><span>${item.glyph ?? ''}</span></button>`);
    });
  }
  if (center) {
    markup.push(`<button type="button" class="radial-palette__center"`
      + ` data-radial-action="${escapeAttribute(center.action)}"`
      + ` aria-label="${escapeAttribute(center.label)}"`
      + ` title="${escapeAttribute(center.label)}">${center.glyph ?? ''}</button>`);
  }
  if (footer) {
    markup.push(`<button type="button" class="radial-palette__footer"`
      + ` data-radial-action="${escapeAttribute(footer.action)}"`
      + `>${escapeAttribute(footer.label)}</button>`);
  }
  return markup.join('');
}

export class RadialPalette {
  /**
   * @param options.host element the palette positions itself inside.
   * @param options.modifier extra class for caller-specific colours.
   */
  constructor({
    host,
    modifier = '',
    onSelect = null,
    onHover = null,
    onHoverEnd = null,
    onAction = null,
    onClose = null,
  }) {
    if (!host) throw new Error('A radial palette needs a host element.');
    this.host = host;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onHoverEnd = onHoverEnd;
    this.onAction = onAction;
    this.onClose = onClose;

    this.element = document.createElement('div');
    this.element.className = `radial-palette${modifier ? ` ${modifier}` : ''}`;
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
   * @param options.rings `[{ radius, items: [{ id, label, color, glyph }] }]`
   * @param options.center optional `{ action, glyph, label }`
   * @param options.footer optional `{ action, label }`
   */
  open({ clientX, clientY, rings = [], center = null, footer = null }) {
    this.element.innerHTML = buildRadialMarkup({ rings, center, footer });
    this.element.hidden = false;

    // Grow the disc to the rings it was given. Fixed at two rings' worth, a
    // third ring's petals would sit outside the backdrop and outside the box the
    // clamp below reasons about.
    const radius = paletteRadius(rings);
    this.element.style.setProperty('--palette-size', `${radius * 2}px`);

    // Clamp inside the host so a palette opened near an edge stays reachable.
    const bounds = this.host.getBoundingClientRect();
    const x = Math.min(bounds.width - radius, Math.max(radius, clientX - bounds.left));
    const y = Math.min(bounds.height - radius, Math.max(radius, clientY - bounds.top));
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    this.buttons[0]?.focus();
  }

  close({ notify = true } = {}) {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.element.innerHTML = '';
    if (notify) this.onClose?.();
  }

  /** Arrow-key navigation between petals. */
  focusStep(delta) {
    const buttons = this.buttons;
    if (buttons.length === 0) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  }

  handleClick(event) {
    const item = event.target.closest('[data-radial-item]');
    if (item) {
      this.onSelect?.(item.dataset.radialItem);
      return;
    }
    const action = event.target.closest('[data-radial-action]');
    if (action) this.onAction?.(action.dataset.radialAction);
  }

  handlePointerOver(event) {
    const item = event.target.closest('[data-radial-item]');
    if (item) this.onHover?.(item.dataset.radialItem);
  }

  handlePointerOut(event) {
    if (event.target.closest('[data-radial-item]')) this.onHoverEnd?.();
  }

  dispose() {
    this.element.removeEventListener('click', this.boundClick);
    this.element.removeEventListener('pointerover', this.boundPointerOver);
    this.element.removeEventListener('pointerout', this.boundPointerOut);
    this.element.remove();
  }
}
