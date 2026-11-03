/**
 * The grimoire: spells drawn by the procedural VFX stack (src/editor/vfx).
 * `targeting` decides how a cast resolves its context:
 *   ground  — the terrain point under the crosshair, or an air point at range
 *   ray     — a line from the hand toward the crosshair (Lightning Bolt, Sunbeam)
 *   cone    — from the hand along the aim (Cone of Cold)
 *   self    — at the caster (Thunderwave, Cure Wounds)
 *
 * `castMs` drives the dock's channel ring and the caster's stance.
 */
export const GRIMOIRE_PAGES = Object.freeze([
  Object.freeze({
    id: 'evocation',
    title: 'Evocation',
    spells: Object.freeze([
      { id: 'fireball', label: 'Fireball', recipe: 'fireball', targeting: 'ground', rangeM: 60, castMs: 4200 },
      { id: 'lightningBolt', label: 'Lightning Bolt', recipe: 'lightningBolt', targeting: 'ray', rangeM: 30, castMs: 1400 },
      { id: 'thunderwave', label: 'Thunderwave', recipe: 'thunderwave', targeting: 'self', rangeM: 0, castMs: 1500 },
      { id: 'coneOfCold', label: 'Cone of Cold', recipe: 'coneOfCold', targeting: 'cone', rangeM: 18, castMs: 2000 },
      { id: 'iceStorm', label: 'Ice Storm', recipe: 'iceStorm', targeting: 'ground', rangeM: 60, castMs: 3600 },
      { id: 'magicMissile', label: 'Magic Missile', recipe: 'magicMissile', targeting: 'ground', rangeM: 36, castMs: 1600 },
      { id: 'shatter', label: 'Shatter', recipe: 'shatter', targeting: 'ground', rangeM: 36, castMs: 1500 },
      { id: 'meteorSwarm', label: 'Meteor Swarm', recipe: 'meteorSwarm', targeting: 'ground', rangeM: 120, castMs: 5200 },
    ].map(Object.freeze)),
  }),
  Object.freeze({
    id: 'mysteries',
    title: 'Mysteries',
    spells: Object.freeze([
      { id: 'acidSplash', label: 'Acid Splash', recipe: 'acidSplash', targeting: 'ground', rangeM: 18, castMs: 1800 },
      { id: 'blight', label: 'Blight', recipe: 'blight', targeting: 'ground', rangeM: 30, castMs: 2400 },
      { id: 'cureWounds', label: 'Cure Wounds', recipe: 'cureWounds', targeting: 'self', rangeM: 0, castMs: 2200 },
      { id: 'fogCloud', label: 'Fog Cloud', recipe: 'fogCloud', targeting: 'ground', rangeM: 36, castMs: 3000 },
      { id: 'stinkingCloud', label: 'Stinking Cloud', recipe: 'stinkingCloud', targeting: 'ground', rangeM: 27, castMs: 3000 },
      { id: 'wallOfFire', label: 'Wall of Fire', recipe: 'wallOfFire', targeting: 'ground', rangeM: 36, castMs: 3000 },
      { id: 'moonbeam', label: 'Moonbeam', recipe: 'moonbeam', targeting: 'ground', rangeM: 36, castMs: 3000 },
      { id: 'sunbeam', label: 'Sunbeam', recipe: 'sunbeam', targeting: 'ray', rangeM: 18, castMs: 1400 },
    ].map(Object.freeze)),
  }),
  // Water magic reads differently in every biome: see vfx/recipes/waterRecipes.js.
  Object.freeze({
    id: 'tides',
    title: 'Tides',
    spells: Object.freeze([
      { id: 'tidalOrb', label: 'Tidal Orb', recipe: 'tidalOrb', targeting: 'ground', rangeM: 40, castMs: 1800 },
      { id: 'rainCall', label: 'Rain Call', recipe: 'rainCall', targeting: 'ground', rangeM: 40, castMs: 2600 },
      { id: 'waterySphere', label: 'Watery Sphere', recipe: 'waterySphere', targeting: 'ground', rangeM: 30, castMs: 2200 },
    ].map(Object.freeze)),
  }),
]);

export const GRIMOIRE_SPELLS = Object.freeze(GRIMOIRE_PAGES.flatMap((page) => page.spells));

export function findGrimoireSpell(spellId) {
  return GRIMOIRE_SPELLS.find((spell) => spell.id === spellId) ?? null;
}
