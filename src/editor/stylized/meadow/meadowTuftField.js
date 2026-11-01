/**
 * The tuft field: where stems gather into plants and where they thin to gaps.
 *
 * The growth profile's patch noise sets swells and hollows a dozen metres
 * across; inside them a sparse stand still needs plants — sub-metre clumps
 * whose stems share a height tendency, a resting lean and a little pigment,
 * with softer stragglers between. This is that field, in canonical metres: a
 * core octave at plant scale and a cluster octave that groups plants into
 * drifts. It reshapes stems only; acceptance and population are untouched, so
 * the LOD prefixes and page bounds keep their meaning.
 *
 * Shared by the CPU twin (meadowGrowthMath.js) and the shader nodes
 * (meadowTuftNodes.js), which must agree.
 */
export const MEADOW_TUFT_FIELD = Object.freeze({
  /** Metres per noise cell of the plant-scale octave. */
  coreMeters: 0.55,
  /** Metres per noise cell of the drift octave grouping plants. */
  clusterMeters: 1.45,
  /** Metres per noise cell of the shared resting-lean direction. */
  leanMeters: 2.6,
  coreWeight: 0.6,
  /** Occupancy = smoothstep(low, high, weighted noise). */
  low: 0.3,
  high: 0.78,
  coreOffset: Object.freeze([31.7, 11.3]),
  clusterOffset: Object.freeze([5.9, 47.1]),
  leanOffset: Object.freeze([71.3, 2.9]),
  /** Turns of lean angle across the noise's range. */
  leanTurns: 1.5,
});

/**
 * Short end of the height envelope, as a share of the profile's shortHeight:
 * stragglers between tufts may stand a little under it.
 */
export const MEADOW_SHORT_FLOOR = 0.85;

/** The patch noise's smoothstep into tall growth, broadened from 0.55..0.75. */
export const MEADOW_TALL_RAMP = Object.freeze([0.4, 0.8]);

/**
 * Share of a stand's height swing a far card keeps around the mid height. Cards
 * are clumps over a metre wide: at full swing, tall and short neighbours read as slabs.
 */
export const MEADOW_CARD_HEIGHT_CONTRAST = 0.35;

/**
 * Share of the tuft weight a fully tall patch gives up, so a tall swath keeps
 * its silhouette while the short stand is the one the tufts reshape.
 */
export const MEADOW_TALL_TUFT_RELIEF = 0.6;

/**
 * `grass.meadow.tufts`: how strongly the field shapes stems. All live uniforms.
 * Zero `height`, `lean`, `rootLift` and `valueSpread` with both bends at 1,
 * `widthFloor` 1 and `windShort` 1 restores the untufted stand.
 */
export const MEADOW_TUFT_DEFAULTS = Object.freeze({
  /** Share of the height envelope the tuft field decides (0..1). */
  height: 0.32,
  /** Share of a stem's resting direction taken from its tuft's lean (0..1). */
  lean: 0.55,
  /** Resting-bend multiplier for isolated stems and for tuft cores. */
  bendIsolated: 2.2,
  bendCore: 1.25,
  /** Width follows height: max(widthFloor, (height / tallHeight)^widthPower). */
  widthFloor: 0.5,
  widthPower: 0.6,
  /** Wind compliance of the shortest stems relative to the tallest (0..1). */
  windShort: 0.6,
  /** Root-darkening lifted for isolated stems: no black punctuation (0..1). */
  rootLift: 0.28,
  /** ± value shared by a tuft's stems, so plants read as one pigment. */
  valueSpread: 0.07,
});
