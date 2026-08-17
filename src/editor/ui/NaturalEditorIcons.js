const ICONS = Object.freeze({
  terrain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18.5 9.2 8.2l3.1 4.5 2.2-3.1 6.5 8.9H3Z"/><path d="m7.8 10.5 1.5 1.6 1.2-1.2"/></svg>',
  nature: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20v-7"/><path d="M12 13c-4.7 0-7-2.7-7-6.7 4.3-.4 7 1.6 7 6.7Z"/><path d="M12 13c4.7 0 7-2.7 7-6.7-4.3-.4-7 1.6-7 6.7Z"/></svg>',
  build: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9l4-3 4 3 4-3 4 3v11H4Z"/><path d="M8 6V3M16 6V3M9 20v-5h6v5"/></svg>',
  decor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m5.6 5.6 2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="3.2"/></svg>',
  wall: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19V8h4v3h3V8h4v3h3V8h4v11H3Z"/><path d="M3 15h18"/></svg>',
  structures: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10l8-6 8 6v10H4Z"/><path d="M9 20v-6h6v6"/></svg>',
  defense: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.6-2.7 8-7 10-4.3-2-7-5.4-7-10V6l7-3Z"/><path d="M9 12h6M12 9v6"/></svg>',
  workshop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 8.5-8.5"/><path d="m14.5 4.5 5 5-3 3-5-5 3-3Z"/><path d="m4 16 4 4-4 1 0-5Z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M5 12h7.5a6 6 0 0 1 6 6"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5"/><path d="M19 12h-7.5a6 6 0 0 0-6 6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8V4l-3 3"/><path d="M18.5 7.5A8 8 0 1 0 20 14"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  'select-add': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="10" height="10" rx="2"/><path d="M14 10h6M17 7v6M8 19h9a2 2 0 0 0 2-2v-2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M8 10v7M12 10v7M16 10v7M7 7l1 14h8l1-14"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
});

export function naturalEditorIcon(name) {
  return ICONS[name] ?? '';
}
