/** Seconds between craters stamped by one growing blast: each stamp walks thousands of texels. */
const STAMP_INTERVAL_S = 0.12;
/** Craters stop growing here, metres; past it the blast only flattens grass. */
const MAX_CRATER_RADIUS = 4;
/** How deep a full-strength blast presses snow and sand, 0..1 of a footprint. */
const CRATER_DEPTH = 0.6;

/**
 * Spells pressing the ground (EffectDirector `press`) beyond the meadow: the
 * water near the player takes a ring wave, and snow, sand and mud take a
 * shallow crater. A disc held at one radius (a puddle, a rune) is stamped
 * once, not every refresh.
 *
 * @param {object} options
 * @param {{ press(x, z, radius, strength, inner): void }} options.water render-space press on the ripple field
 * @param {() => { x: number, z: number }} options.getOrigin floating origin
 * @param {(x, z, radius, depth, inner) => void} options.stampDisc canonical disc stamp
 * @param {() => number} options.now seconds
 */
export function createSpellSurfacePress({ water, getOrigin, stampDisc, now }) {
  let stamped = null;
  let lastStamp = -Infinity;
  return (x, z, radius, strength, inner = 0.6) => {
    if (!(radius > 0) || !(strength > 0)) return;
    water?.press(x, z, radius, strength, inner);
    const held = stamped && Math.abs(stamped.radius - radius) < 0.05 && Math.hypot(stamped.x - x, stamped.z - z) < 0.05;
    const seconds = now();
    if (held || seconds - lastStamp < STAMP_INTERVAL_S) return;
    stamped = { x, z, radius };
    lastStamp = seconds;
    const origin = getOrigin();
    stampDisc(x + origin.x, z + origin.z, Math.min(radius, MAX_CRATER_RADIUS), CRATER_DEPTH * Math.min(1, strength), inner);
  };
}
