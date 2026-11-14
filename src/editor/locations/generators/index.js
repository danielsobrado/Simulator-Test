import * as cavernCity from './CavernCityGenerator.js';
import * as frostgardHold from './FrostgardHoldGenerator.js';
import * as glacierFront from './GlacierFrontGenerator.js';
import * as glacier from './GlacierGenerator.js';
import * as mine from './MineGenerator.js';
import * as mountainHold from './MountainHoldGenerator.js';

/**
 * Generators by the `generatorKey` an archetype names in
 * `config/instanced-locations.yaml`. Each exports `bounds` (the volume it
 * works in), `generate(builder, params)`, and `open = true` if the place lies under the sky. A new family is a new module and
 * a line here; the transition runtime does not change.
 */
export const LOCATION_GENERATORS = Object.freeze({
  'mine-network': mine,
  'vertical-cavern-city': cavernCity,
  'mountain-hold': mountainHold,
  'glacial-cavern': glacier,
  'glacier-front': glacierFront,
  'frostgard-hold': frostgardHold,
});
