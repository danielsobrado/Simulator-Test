/**
 * Drow proportions.
 *
 * The ported figure was a human snow traveller — 1.79 m, deliberately a little
 * long in the leg and narrow in the shoulder because the silhouette is read at
 * fifteen metres through a robe. A drow is read the same way and wants the same
 * exaggeration pushed one step further: taller, appreciably slimmer, longer in
 * the limb, narrower across the shoulder.
 *
 * Every number is a multiplier on the human base, and nothing downstream stores
 * an absolute measurement — the bind pose in `characterBones.js` and the ring
 * tables in `geometry/` both derive from these, so changing one value here moves
 * the skeleton and the geometry together. That is the whole reason the profile
 * exists: in the source the two were hand-matched literals in different files,
 * and any edit to one silently detached the mesh from the bones.
 */
export const DROW_PROFILE = Object.freeze({
  /** Thigh and shin. The single strongest "elf" cue in a silhouette. */
  legLength: 1.045,
  /** Pelvis-to-head spacing. Modest: a long torso reads as gangly, not elven. */
  torsoHeight: 1.015,
  /** Upper arm and forearm. */
  armLength: 1.035,
  shoulderWidth: 0.93,
  hipWidth: 0.97,
  /** Limb cross-sections. Applied by the geometry, not by the skeleton. */
  limbRadius: 0.90,
  torsoRadius: 0.92,
  /** Skull. Slightly finer, which lets the ears read as long rather than large. */
  headScale: 0.97,
});

/**
 * The unmodified human proportions, kept so tests can assert the profile is
 * doing something and so a comparison render is one argument away.
 */
export const HUMAN_PROFILE = Object.freeze({
  legLength: 1,
  torsoHeight: 1,
  armLength: 1,
  shoulderWidth: 1,
  hipWidth: 1,
  limbRadius: 1,
  torsoRadius: 1,
  headScale: 1,
});
