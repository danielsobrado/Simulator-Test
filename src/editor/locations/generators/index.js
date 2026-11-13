import * as cavernCity from './CavernCityGenerator.js';
import * as glacier from './GlacierGenerator.js';
import * as mine from './MineGenerator.js';
import * as mountainHold from './MountainHoldGenerator.js';

/**
 * Generators by the `generatorKey` an archetype names in
 * `config/instanced-locations.yaml`. Each exports `bounds` (the volume it
 * works in) and `generate(builder, params)`. A new family is a new module and
 * a line here; the transition runtime does not change.
 */
export const LOCATION_GENERATORS = Object.freeze({
  'mine-network': mine,
  'vertical-cavern-city': cavernCity,
  'mountain-hold': mountainHold,
  'glacial-cavern': glacier,
});
