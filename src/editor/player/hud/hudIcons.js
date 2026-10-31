/**
 * Line glyphs for the walking HUD and the mode switch, on the same 24-unit grid
 * as NaturalEditorIcons. They stroke with `currentColor`, so each widget sets
 * the colour.
 */
const HUD_ICONS = Object.freeze({
  fly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 10-10"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4L19 9a2.8 2.8 0 0 0-4-4L4.5 15.5v4Z"/><path d="m13.8 6.2 4 4"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 3.6c1.7 0 2.6 1.7 2.6 4.1 0 1.9-.6 3.3-1 4.2H6.6c-.4-.9-1-2.3-1-4.2 0-2.4.9-4.1 2.6-4.1Z"/><path d="M6.7 14.6h3.1v1.2a1.55 1.55 0 0 1-3.1 0Z"/><path d="M15.8 7.8c1.7 0 2.6 1.7 2.6 4.1 0 1.9-.6 3.3-1 4.2h-3.2c-.4-.9-1-2.3-1-4.2 0-2.4.9-4.1 2.6-4.1Z"/><path d="M14.3 18.8h3.1V20a1.55 1.55 0 0 1-3.1 0Z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.2-5.4-6.2-10.6a6.2 6.2 0 0 1 12.4 0C18.2 15.6 12 21 12 21Z"/><circle cx="12" cy="10.3" r="2.2"/></svg>',
  mouse: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3.5"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11M15 6.5v11"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.2 20.8 19H3.2L12 4.2Z"/><path d="M12 10v4M12 16.8v.2"/></svg>',
  spinner: '<svg class="hud-spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5a7.5 7.5 0 1 1-7.5 7.5"/></svg>',
});

export function hudIcon(name) {
  return HUD_ICONS[name] ?? '';
}

/** A small paper keycap, e.g. `Esc` or `Shift`. */
export function createKeycap(label) {
  const key = document.createElement('kbd');
  key.className = 'hud-key';
  key.textContent = label;
  return key;
}
