/**
 * Ground creatures folding the meadow as the player's body does.
 *
 * The meadow's press map is a small window round the player
 * (MeadowInteractionMap), so only creatures inside it are stamped, and a stamp
 * outside it is dropped by the map itself. Bodies are stamped every frame like
 * the player's: the press recovers by frames, and a slower stamp would pulse.
 * Each stamp is a ground disc — no terrain lookup per texel.
 */

/** A walker's pressed disc as a share of its height; the hero's 0.26 m at 1.85 m. */
const WALKER_RADIUS_PER_HEIGHT = 0.14;
/** A serpent flattens a little more than its own girth. */
const SERPENT_PRESS_GIRTH = 1.25;
/** A raised coil or a reared head presses nothing: body radii of clearance. */
const SERPENT_GROUND_CLEARANCE = 0.6;

/**
 * @param {object} options
 * @param {(x: number, z: number, radius: number) => void} options.press render-space disc
 * @param {{ x: number, z: number } | null} options.playerBody render space; null outside walk mode
 * @param {number} options.reach metres from the player a creature still presses
 * @param {Iterable<{ root: { position: { x: number, z: number } }, definition: { targetHeight: number } }>} [options.walkers]
 * @param {Iterable<object>} [options.serpents] GiantSerpent instances
 * @returns {number} discs pressed
 */
export function pressGrassUnderCreatures({ press, playerBody, reach, walkers = [], serpents = [] }) {
  if (!press || !playerBody || !(reach > 0)) return 0;
  let pressed = 0;
  const near = (x, z, radius) => Math.abs(x - playerBody.x) <= reach + radius && Math.abs(z - playerBody.z) <= reach + radius;
  for (const { root, definition } of walkers) {
    const radius = definition.targetHeight * WALKER_RADIUS_PER_HEIGHT;
    const { x, z } = root.position;
    if (!near(x, z, radius)) continue;
    press(x, z, radius); pressed += 1;
  }
  for (const serpent of serpents) {
    if (!serpent.root.visible) continue;
    const { spine, ground, shape, root } = serpent, rings = ground.length;
    // The whole body, coiled or stretched, lies within its length of the root's first ring.
    if (!near(root.position.x + spine[0], root.position.z + spine[2], shape.length)) continue;
    const radius = shape.radius * SERPENT_PRESS_GIRTH;
    // Rings sit far closer than a disc is wide: one disc per body radius covers the trail.
    const stride = Math.max(1, Math.floor(shape.radius / (shape.length / rings)));
    for (let ring = 0; ring < rings; ring += stride) {
      if (spine[ring * 3 + 1] - ground[ring] > shape.radius * (1 + SERPENT_GROUND_CLEARANCE)) continue;
      const x = root.position.x + spine[ring * 3], z = root.position.z + spine[ring * 3 + 2];
      if (!near(x, z, radius)) continue;
      press(x, z, radius); pressed += 1;
    }
  }
  return pressed;
}
