/**
 * The editor's inline line-art icon set.
 *
 * Menus used to carry Unicode glyphs — `▬ ⊓ ⋰ ∿` for wall tops, `▤ ▦ ▨ ▩` for
 * masonry bonds, plain words for the workshop gizmo. Those render differently on
 * every platform, cannot be sized or coloured, and gave the two toolbars no
 * shared visual language. These do.
 *
 * Every icon is drawn on one 24×24 grid as stroked paths with **no colour of
 * their own**: `stroke="currentColor"` on the root means an icon takes the
 * colour of the button it sits in, so hover, active and disabled states are a
 * CSS concern rather than a second copy of the artwork. `tests/Icons.test.js`
 * pins that — a hardcoded fill is invisible until someone changes theme.
 *
 * `icon()` returns a **string**, not an element. The menu components assemble
 * markup as strings so their layout is testable in Node, which has no DOM.
 */

import { escapeAttribute } from './markup.js';

export const ICON_VIEWBOX = '0 0 24 24';

/**
 * Path data only. The stroke attributes live on the `<svg>` the wrapper builds,
 * so an icon cannot accidentally opt out of `currentColor`.
 */
export const ICONS = Object.freeze({
  // --- Gizmo actions -------------------------------------------------------
  cut: '<circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/>'
    + '<path d="M7.8 16.2 18.5 4.5M16.2 16.2 5.5 4.5"/>',
  duplicate: '<rect x="9" y="9" width="11" height="11" rx="2"/>'
    + '<path d="M15 5.5H6.5A2.5 2.5 0 0 0 4 8v8.5"/>',
  trash: '<path d="M4 7h16M10 4h4M6.5 7l1 12.5A2 2 0 0 0 9.5 21h5a2 2 0 0 0 2-1.5L17.5 7"/>'
    + '<path d="M10.5 11v6M13.5 11v6"/>',
  move: '<path d="M12 3v18M3 12h18"/>'
    + '<path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/>',
  scale: '<path d="M4 10V4h6M20 14v6h-6"/><path d="M4 4l7 7M20 20l-7-7"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/>'
    + '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3'
    + 'M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>',
  link: '<circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="12" r="2.5"/>'
    + '<circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8 15.8 7.2M8.2 13.2l7.6 3.6"/>',
  anchor: '<circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V20"/><path d="M5 14a7 7 0 0 0 14 0"/>',

  // --- Opening kinds (ConstructionSchema FEATURE_KINDS) --------------------
  door: '<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M4 21h16"/>'
    + '<circle cx="14.5" cy="12.5" r="1"/>',
  window: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/>'
    + '<path d="M12 4.5v15M4.5 12h15"/>',
  arch: '<path d="M5 21V11a7 7 0 0 1 14 0v10"/><path d="M3 21h18"/>',
  gate: '<path d="M5 21V11a7 7 0 0 1 14 0v10"/><path d="M3 21h18"/>'
    + '<path d="M9 21v-9.5M12 21v-11M15 21v-9.5M5.5 15h13"/>',
  tower: '<path d="M4 21h16"/><path d="M6.5 21V5h2.5v2.2h2.75V5h2.5v2.2H17V5h2v16"/>',
  breach: '<path d="M3 20h18"/><path d="M3 20V8h5l1.5 4-2 3.5 3 1.5"/>'
    + '<path d="M21 20V8h-5l-1 3.5 2.2 2.5-2.7 2"/>',

  // --- Opening profiles (ConstructionSchema OPENING_PROFILES) -------------
  'profile-round': '<path d="M5 21V12a7 7 0 0 1 14 0v9"/>',
  'profile-segmental': '<path d="M5 21v-7M19 21v-7"/><path d="M5 14a9.5 9.5 0 0 1 14 0"/>',
  'profile-pointed': '<path d="M5 21v-8a10 10 0 0 1 7-6.5 10 10 0 0 1 7 6.5v8"/>',
  'profile-flat': '<path d="M5 21V10h14v11"/>',

  // --- Wall tops (ConstructionSchema TOP_STYLES) --------------------------
  'top-flat': '<path d="M2.5 9h19"/><path d="M4.5 20V9h15v11"/>',
  'top-crenellated': '<path d="M4 20V7h3v3h3V7h3v3h3V7h3v13"/>',
  'top-ruined': '<path d="M4 20v-9l2.5-1.5L9 12l2.5-3.5L14 11l2.5-2 3.5 3v6"/>',
  'top-irregular': '<path d="M4 20v-7c2-2.2 4-2.2 6 0s4 2.2 6 0 2.7-2 4-.8V20"/>',

  // --- Masonry bonds (ConstructionStyleCatalog) ---------------------------
  'bond-coursed-rubble': '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/>'
    + '<path d="M3.5 10h17M3.5 14h17"/><path d="M9 5.5v4.5M15 10v4M7 14v4.5M13.5 14v4.5"/>',
  'bond-ashlar': '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/>'
    + '<path d="M3.5 9.8h17M3.5 14.2h17"/>'
    + '<path d="M12 5.5v4.3M8 9.8v4.4M16 9.8v4.4M12 14.2v4.3"/>',
  'bond-random-rubble': '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/>'
    + '<path d="M3.5 11.5h5l2-3.5M8.5 11.5 11 15l-3 3.5M11 15h4l1.5-3.5h4M15 5.5l-1.5 6"/>',
  'bond-dry-stone': '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/>'
    + '<path d="M3.5 9.5h17M3.5 12.5h17M3.5 15.5h17"/>'
    + '<path d="M10 5.5v4M7 9.5v3M14 9.5v3M11 12.5v3M17 12.5v3M8 15.5v3"/>',

  // --- Workshop gizmo + primitives ----------------------------------------
  material: '<path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4.5h4.5"/>',
  'reset-all': '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4.5H8"/>'
    + '<path d="M8 12a4 4 0 1 0 1.2-2.85"/>',
  center: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  frame: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9'
    + 'M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  'primitive-rectangle': '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  'primitive-circle': '<circle cx="12" cy="12" r="7.5"/>',
  'primitive-wall': '<rect x="3.5" y="8" width="17" height="8" rx="1"/>'
    + '<path d="M3.5 12h17M9.5 8v4M15 12v4"/>',

  // --- Misc ----------------------------------------------------------------
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  dressed: '<path d="M4 20V8.5a8 8 0 0 1 16 0V20"/><path d="M7.5 20v-9a4.5 4.5 0 0 1 9 0v9"/>',
  plain: '<path d="M6 20V10a6 6 0 0 1 12 0v10"/>',
});

export function iconNames() {
  return Object.keys(ICONS);
}

export function hasIcon(name) {
  return Object.hasOwn(ICONS, name);
}

/**
 * Markup for one icon.
 *
 * An unknown name yields `''` rather than throwing or interpolating
 * `undefined`: a menu with one mistyped icon should lose that glyph, not fail to
 * open or print the word "undefined" into the page.
 */
export function icon(name, { size = 18, className = '' } = {}) {
  const body = ICONS[name];
  if (!body) return '';
  const classAttribute = className ? ` class="${escapeAttribute(className)}"` : '';
  return `<svg${classAttribute} viewBox="${ICON_VIEWBOX}" width="${size}" height="${size}"`
    + ' fill="none" stroke="currentColor" stroke-width="1.5"'
    + ' stroke-linecap="round" stroke-linejoin="round"'
    + ` aria-hidden="true" focusable="false">${body}</svg>`;
}
