/**
 * Automatic prototype choice for one scatter layer.
 *
 * Before this existed, "automatic mix" meant one weighted roll over every
 * prototype in the layer, identical in every biome — so a savanna, a taiga and a
 * farm all grew the same three grass clumps, and only an explicit per-biome
 * override in Settings could vary them. Three filters compose here instead,
 * matching the three scales at which the world already varies:
 *
 * - `tileIds` gates a prototype to the biomes it belongs in. This is the coarse
 *   decision: dry blades in a savanna, tall green ones in a wetland.
 * - `character` weights it by one channel of `RegionalCharacterField`, which
 *   varies over ~420 m. This is what stops a single biome being uniform: the
 *   meadow districts of a grassland carry clumps and flowers while its scrub
 *   districts carry dry blades, from the same biome set.
 * - `canopy` weights it by forest habitat, so a wood's shaded interior and its
 *   sunlit fringe grow different things.
 *
 * All three are optional. A rule with none of them behaves exactly like the
 * previous global weighted roll.
 *
 * Selection must stay allocation-free: it runs once per scatter candidate, which
 * is up to 144 per chunk for trees across a streaming window.
 */

export const CHARACTER_CHANNELS = Object.freeze(['meadow', 'forest', 'scrub', 'rocky']);
export const CANOPY_PREFERENCES = Object.freeze(['any', 'core', 'edge', 'open']);

// Floor under every dynamic factor. A prototype that a district or a canopy
// merely disfavours must still be reachable, or a chunk whose candidates all
// land in that district would have no eligible prototype at all.
const DYNAMIC_FLOOR = 0.08;

function clamp01(value) {
  return value > 1 ? 1 : (value > 0 ? value : 0);
}

function canopyFactor(preference, habitat) {
  if (preference === 'any') return 1;
  const coverage = clamp01(Number(habitat?.patchCoverage) || 0);
  const edge = clamp01(Number(habitat?.patchEdge) || 0);
  if (preference === 'core') return DYNAMIC_FLOOR + coverage * (1 - edge);
  if (preference === 'edge') return DYNAMIC_FLOOR + edge;
  return DYNAMIC_FLOOR + (1 - coverage);
}

export function normalizeBiomePrototypeRule(rule = {}) {
  const weight = rule.weight === undefined ? 1 : Number(rule.weight);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('Biome prototype rule weights must be positive.');
  }
  const characterStrength = Number(rule.characterStrength);
  const character = rule.character ?? null;
  if (character !== null && !CHARACTER_CHANNELS.includes(character)) {
    throw new Error(`Unknown regional character channel "${character}".`);
  }
  const canopy = rule.canopy ?? 'any';
  if (!CANOPY_PREFERENCES.includes(canopy)) {
    throw new Error(`Unknown canopy preference "${canopy}".`);
  }
  return Object.freeze({
    tileIds: rule.tileIds ? new Set(rule.tileIds) : null,
    weight,
    character,
    characterStrength: Number.isFinite(characterStrength) && characterStrength > 0
      ? characterStrength
      : 1,
    canopy,
  });
}

/**
 * `rules` must contain one entry per prototype, in prototype-index order.
 *
 * The returned selector is `(roll, tileId, x, z, habitat) => prototypeIndex`.
 * `x`, `z` and `habitat` may be omitted; the corresponding filters then go
 * inert rather than failing, which keeps callers that have no forest field or no
 * regional field working unchanged.
 */
export function createBiomePrototypeSelector({ rules, regionalCharacterField = null }) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('A biome prototype selector needs at least one prototype rule.');
  }
  const normalized = rules.map((rule) => normalizeBiomePrototypeRule(rule));
  const everyIndex = Int32Array.from(normalized, (_rule, index) => index);
  const hasCharacter = Boolean(regionalCharacterField)
    && normalized.some((rule) => rule.character !== null);
  const hasCanopy = normalized.some((rule) => rule.canopy !== 'any');
  const dynamic = hasCharacter || hasCanopy;

  // Eligible index lists are per biome and never change, so they are built once
  // on first sight of a tile and reused for every later candidate.
  const eligibleByTile = new Map();
  const weightScratch = new Float64Array(normalized.length);

  function eligibleFor(tileId) {
    const cached = eligibleByTile.get(tileId);
    if (cached) return cached;
    const indices = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const { tileIds } = normalized[index];
      if (!tileIds || tileIds.has(tileId)) indices.push(index);
    }
    // No rule claims this biome — fall back to the whole set rather than
    // returning nothing. `buildStableChunkManifest` requires a valid index, and
    // a biome added to a layer's `tileIds` without a matching variant should
    // still scatter something.
    const result = indices.length > 0 ? Int32Array.from(indices) : everyIndex;
    eligibleByTile.set(tileId, result);
    return result;
  }

  function selectPrototype(roll, tileId, x = 0, z = 0, habitat = null) {
    const eligible = eligibleFor(tileId);
    if (eligible.length === 1) return eligible[0];
    const target = roll > 0 ? (roll < 1 ? roll : 1 - Number.EPSILON) : 0;

    let total = 0;
    for (let slot = 0; slot < eligible.length; slot += 1) {
      const rule = normalized[eligible[slot]];
      let weight = rule.weight;
      if (dynamic) {
        if (rule.character !== null && regionalCharacterField) {
          const influence = regionalCharacterField.sampleChannel(x, z, rule.character);
          weight *= (DYNAMIC_FLOOR + influence) ** rule.characterStrength;
        }
        if (rule.canopy !== 'any') weight *= canopyFactor(rule.canopy, habitat);
      }
      weightScratch[slot] = weight;
      total += weight;
    }
    if (!(total > 0)) return eligible[Math.min(eligible.length - 1, Math.floor(target * eligible.length))];

    let remaining = target * total;
    for (let slot = 0; slot < eligible.length; slot += 1) {
      remaining -= weightScratch[slot];
      if (remaining < 0) return eligible[slot];
    }
    return eligible[eligible.length - 1];
  }

  // Lets a caller skip sampling the forest habitat field per candidate when no
  // rule would look at it, which is the common case.
  selectPrototype.usesCanopy = hasCanopy;
  return selectPrototype;
}
