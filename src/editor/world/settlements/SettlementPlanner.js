import { buildingDoor, buildingWindows } from './SettlementBuildingCatalog.js';
import { planDecor } from './SettlementDecor.js';
import { planDefences } from './SettlementDefences.js';
import { gateProfileFor, planGateApproaches } from './SettlementGateApproach.js';
import { rect } from './SettlementGeometry.js';
import { marketHalls, placeSquares } from './SettlementMarkets.js';
import { SettlementOccupancy } from './SettlementOccupancy.js';
import { planBuildings, planFarms } from './SettlementPlots.js';
import { hashInts, settlementProfile } from './SettlementProfile.js';
import { settlementSignature } from './SettlementSignature.js';
import { planStones } from './SettlementStones.js';
import { planTrim } from './SettlementTrim.js';
import { planWallDressing } from './SettlementWallDressing.js';
import { planRandom, planStreets } from './SettlementStreets.js';

export const SETTLEMENT_PLAN_VERSION = 19;
/** Part of every town's seed. Raising it redraws every town; the version above only invalidates caches. */
const SETTLEMENT_LAYOUT_EPOCH = 14;

/**
 * Plan one settlement: streets, market square, landmark and house plots,
 * defences, the farm belt, walkway decor and loose stone.
 *
 * Deterministic in its inputs — the world seed, the burg, the routes near it
 * and the ground — so terrain workers and the main thread derive the same plan
 * independently, and nothing is stored with the world. Coordinates are plan
 * space (see SettlementGeometry); `sampleHeight` and `isBuildable` take plan
 * space too.
 *
 * Every building carries `pad`, the level its footprint is flattened to: the
 * ground at its centre. The terrain grades to it and the renderer stands the
 * building on it, so the two cannot disagree.
 */
export function planSettlement({
  settlement,
  worldSeed,
  routeBearings = [],
  sampleHeight = () => 12,
  isBuildable = () => true,
  geography = undefined,
}) {
  const profile = settlementProfile(settlement, geography ? { geography } : {});
  const random = planRandom(hashInts(worldSeed, settlement.id, SETTLEMENT_LAYOUT_EPOCH));
  const signature = settlementSignature(settlement, profile, worldSeed, routeBearings.length);
  const { streets, squareRadius, bearings, quayBearing } = planStreets({ profile, signature, routeBearings, random, isBuildable });
  const maxPadFall = profile.hasRegionalIdentity && profile.identity?.activeOverlays?.includes('mountain-pass') ? 5.2 : undefined;
  const squares = placeSquares({ profile, signature, streets, squareRadius, quayBearing, isBuildable });
  const occupancy = new SettlementOccupancy({ streets, squares, isBuildable, sampleHeight, maxPadFall });
  // A market hall stands in its square, where nothing else may: claimed before any plot is.
  const halls = marketHalls(squares);
  for (const hall of halls) occupancy.claim(rect(hall.x, hall.z, hall.width, hall.depth, hall.yaw));
  const buildings = [...halls, ...planBuildings({ profile, signature, occupancy, streets, bearings, quayBearing, random })];
  const defences = planDefences({ profile, occupancy, streets, random });
  const { farms, fields } = planFarms({ profile, signature, occupancy, streets, random });
  const { props, walks } = planDecor({
    profile,
    signature,
    occupancy,
    streets,
    squareRadius,
    squares,
    buildings: [...buildings, ...farms],
    fields,
    random,
  });
  // Last, so adding or retuning loose stone never reshuffles the town itself.
  const outcropRandom = planRandom(hashInts(worldSeed, settlement.id, 0x0c7));
  const stones = planStones({ profile, occupancy, buildings: [...buildings, ...farms], fields, random, outcropRandom });
  const trim = planTrim({ profile, occupancy, buildings: [...buildings, ...farms, ...defences], fields, random });
  // After everything else and on its own stream, for the same reason.
  const gateSeed = planRandom(hashInts(worldSeed, settlement.id, 0x6a7e));
  const gateProfile = gateProfileFor(profile);
  const gateways = planGateApproaches({ streets, defences, occupancy, gateProfile, random: gateSeed });
  const wallDressing = planWallDressing({ defences, wall: gateProfile.wall, occupancy, random: gateSeed });
  const styleKey = profile.style.key;
  // A building the plan fronts on a street gets the door its pooled mesh has (SettlementDoors.generated).
  const withPad = (item) => ({
    ...item,
    pad: sampleHeight(item.x, item.z),
    door: item.front ? buildingDoor(styleKey, item.kind, item.variant) : null,
    // Cut into the room behind the door and lit by the sun through them.
    windows: item.front ? buildingWindows(styleKey, item.kind, item.variant) : [],
  });
  return Object.freeze({
    version: SETTLEMENT_PLAN_VERSION,
    id: settlement.id,
    name: settlement.name ?? '',
    profile,
    identity: profile.identity,
    recipe: profile.recipe,
    signature,
    squareRadius,
    // Every square, primary (at the origin, squareRadius) first: { x, z, radius, kind, name }.
    squares,
    streets: [...streets, ...walks],
    buildings: [...buildings, ...farms, ...defences].map(withPad),
    props: [...props, ...stones, ...trim, ...gateways.props, ...wallDressing],
    // Worn ground in front of each gate: { points, halfWidths }, gate first.
    approaches: gateways.approaches,
    fields,
  });
}
