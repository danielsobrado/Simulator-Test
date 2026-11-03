/**
 * Dock glyphs for the grimoire spells, on the same 24-unit grid and part
 * classes as spell_icons.js (`glyph-fill`, `glyph-light`, `glyph-line`,
 * `glyph-shine`), so the dock styles them identically.
 */
const GRIMOIRE_GLYPHS = Object.freeze({
  tidalOrb: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-line glyph-line--soft" d="M3 19.5c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0"/>
    <circle class="glyph-fill" cx="12" cy="9.5" r="5.6"/>
    <path class="glyph-light" d="M9.4 7.6a3.2 3.2 0 0 1 3.4-1.9"/>
  </svg>`,
  waterySphere: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-line glyph-line--soft" d="M4 20.5c2.6-1.2 5.3-1.2 8 0s5.4 1.2 8 0"/>
    <path class="glyph-fill" d="M12 3.2c3.6 0 6 2.5 5.6 5.4 1.8.6 2.4 2.8 1 4-1.4 1.3-3.4.9-4.2 2-1.2 1.4-3.6 1.4-4.8 0-.8-1.1-2.8-.7-4.2-2-1.4-1.2-.8-3.4 1-4C6 5.7 8.4 3.2 12 3.2Z"/>
    <path class="glyph-light" d="M9.6 6.4a3 3 0 0 1 3-1.2"/>
  </svg>`,
  rainCall: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M6.5 12a3.8 3.8 0 0 1 .4-7.6 5.3 5.3 0 0 1 10 1.4 3.1 3.1 0 0 1 .6 6.2Z"/>
    <path class="glyph-line" d="M8 15l-1.2 3.6M12 15l-1.2 4.6M16 15l-1.2 3.6"/>
  </svg>`,
  fireball: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-line glyph-line--soft" d="M9.4 12.9 4 18.3M11.2 15.2 7.4 19M7.6 10.8l-3.3 3.3"/>
    <circle class="glyph-fill" cx="14.6" cy="9.4" r="5.4"/>
    <circle class="glyph-light" cx="15.8" cy="8.2" r="2.2"/>
  </svg>`,
  lightningBolt: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M13.8 2.4 5.4 13.6h5.4l-1.7 8.1 9.3-11.9h-5.6l1-7.4Z"/>
    <path class="glyph-light" d="M13.8 2.4 5.4 13.6h3.2l5.2-11.2Z"/>
  </svg>`,
  thunderwave: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle class="glyph-fill" cx="5" cy="12" r="2.4"/>
    <path class="glyph-line" d="M9.5 7.5a6.4 6.4 0 0 1 0 9"/>
    <path class="glyph-line" d="M13.6 5a10 10 0 0 1 0 14"/>
    <path class="glyph-line glyph-line--soft" d="M17.8 3a13.4 13.4 0 0 1 0 18"/>
  </svg>`,
  coneOfCold: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M3 12 20 4.6v14.8Z"/>
    <path class="glyph-shine" d="M14 8.6v6.8M11 10.3l6 3.4M11 13.7l6-3.4"/>
  </svg>`,
  iceStorm: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M6.5 12.5a3.8 3.8 0 0 1 .4-7.6 5.3 5.3 0 0 1 10 1.4 3.1 3.1 0 0 1 .6 6.2Z"/>
    <path class="glyph-line" d="m8 15.5-1 3M12 15.5l-1 4.5M16 15.5l-1 3"/>
  </svg>`,
  magicMissile: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-line" d="m4 6 5 3-5 3M10 9l5 3-5 3M16 12l5 3-5 3"/>
    <circle class="glyph-fill" cx="20" cy="5" r="2"/>
  </svg>`,
  shatter: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="m12 2.5 2 6.4 6.6-2-4.3 5.3 4.9 4.6-6.6.3L12 21.5l-2.6-4.4-6.6-.3 4.9-4.6-4.3-5.3 6.6 2Z"/>
    <path class="glyph-light" d="m12 8.4 1 3.6-1 3.4-1-3.4Z"/>
  </svg>`,
  meteorSwarm: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-line glyph-line--soft" d="M3 3l7.5 7.5M8 2.5l6 6M2.5 8l6 6"/>
    <circle class="glyph-fill" cx="15.4" cy="15.4" r="5"/>
    <circle class="glyph-light" cx="16.6" cy="14.2" r="1.9"/>
  </svg>`,
  acidSplash: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M12 3c3 3.6 4.8 6.2 4.8 8.7a4.8 4.8 0 0 1-9.6 0C7.2 9.2 9 6.6 12 3Z"/>
    <path class="glyph-line" d="M4.5 20.5h15M6 17.6l-1.6-1.4M18 17.6l1.6-1.4"/>
    <path class="glyph-shine" d="M9.8 12.2a2.3 2.3 0 0 0 2 2.2"/>
  </svg>`,
  blight: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.4 3 5.4V20h9v-4.1c1.7-1 3-2.8 3-5.4A7.5 7.5 0 0 0 12 3Z"/>
    <circle class="glyph-light" cx="9" cy="10.6" r="1.8"/>
    <circle class="glyph-light" cx="15" cy="10.6" r="1.8"/>
    <path class="glyph-shine" d="M10.4 17.5v2M13.6 17.5v2"/>
  </svg>`,
  cureWounds: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M12 20.5 4.4 13a4.6 4.6 0 0 1 6.5-6.5L12 7.6l1.1-1.1a4.6 4.6 0 0 1 6.5 6.5Z"/>
    <path class="glyph-shine" d="M12 9.6v6.2M8.9 12.7h6.2"/>
  </svg>`,
  fogCloud: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M6 14a3.6 3.6 0 0 1 .4-7.2 5 5 0 0 1 9.6 1.4A2.9 2.9 0 0 1 17 14Z"/>
    <path class="glyph-line glyph-line--soft" d="M4 17.5h11M8 20.5h12"/>
  </svg>`,
  stinkingCloud: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M6 15a3.6 3.6 0 0 1 .4-7.2 5 5 0 0 1 9.6 1.4A2.9 2.9 0 0 1 17 15Z"/>
    <circle class="glyph-fill" cx="7" cy="19" r="1.3"/>
    <circle class="glyph-fill" cx="12" cy="20.5" r="1"/>
    <circle class="glyph-fill" cx="17" cy="18.6" r="1.5"/>
  </svg>`,
  wallOfFire: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M5 20c-1.8 0-2.6-1.4-2.6-3 0-2.2 1.6-3.4 2.6-6 .8 2 2.6 3.3 2.6 6 0 1.6-.8 3-2.6 3Z"/>
    <path class="glyph-fill" d="M12 20c-2.3 0-3.3-1.7-3.3-3.8 0-3 2-4.6 3.3-8.2 1 2.8 3.3 4.4 3.3 8.2 0 2.1-1 3.8-3.3 3.8Z"/>
    <path class="glyph-fill" d="M19 20c-1.8 0-2.6-1.4-2.6-3 0-2.2 1.6-3.4 2.6-6 .8 2 2.6 3.3 2.6 6 0 1.6-.8 3-2.6 3Z"/>
    <path class="glyph-light" d="M12 19c-.9 0-1.4-.6-1.4-1.5 0-1.1.7-1.8 1.4-3 .5 1 1.4 1.8 1.4 3 0 .9-.5 1.5-1.4 1.5Z"/>
  </svg>`,
  moonbeam: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M15 2.6a6 6 0 1 0 5.6 8.3A4.8 4.8 0 0 1 15 2.6Z"/>
    <path class="glyph-line glyph-line--soft" d="M9 13v8M13 15v6M5 15v6"/>
  </svg>`,
  sunbeam: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle class="glyph-fill" cx="7" cy="12" r="4"/>
    <path class="glyph-line" d="M12.5 12H21"/>
    <path class="glyph-line glyph-line--soft" d="M7 3.5v2M7 18.5v2M1.5 12h1.4M2.9 7.9l1.2 1.2M2.9 16.1l1.2-1.2"/>
    <circle class="glyph-light" cx="7" cy="12" r="1.6"/>
  </svg>`,
});

export function grimoireGlyph(spellId) {
  return GRIMOIRE_GLYPHS[spellId] ?? '';
}
