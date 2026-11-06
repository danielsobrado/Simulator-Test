import { createStonePlacementSink, stoneHash01 } from './stonePlacementSink.js';

/**
 * Rock formations: tors and outcrops built from the same painted stones as the
 * scatter, scaled up and packed together, so a big rock area reads as the same
 * rock as the boulders at its foot (and takes the biome's rock look and the
 * stones' collision with it).
 *
 * A formation grid of `cellMeters` cells holds at most one formation each; the
 * biome under a cell's centre gives the chance (biome-looks `formations`). A
 * formation is one or two keystones with smaller stones crowding round them,
 * shrinking outward, so it reads as one broken mass rather than a sprinkle.
 */
export const DEFAULT_ROCK_FORMATIONS = Object.freeze({
  enabled: true,
  cellMeters: 96,
  // Massed, not a monolith: at 6-14 stones over 7-16 m one keystone stood alone
  // with a few pebbles round its foot.
  minStones: 10,
  maxStones: 22,
  /** Metres from the centre the outermost stones reach. */
  minRadius: 10,
  maxRadius: 26,
  /** Keystones per formation, from one up to this many. */
  maxKeystones: 3,
  keystoneMinScale: 4.5,
  keystoneMaxScale: 8.5,
  stoneMinScale: 1.8,
  stoneMaxScale: 5,
  /** Metres above the sea a stone needs: a tor does not stand in the shallows. */
  minimumAboveSea: 0.6,
});

const SALT = 0x6f73;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** The stones of the formation in grid cell (gx, gz), or null when the cell has none. */
export function formationStones(gx, gz, config, shareAt) {
  const h = (channel) => stoneHash01(gx, gz, channel, SALT);
  const cx = (gx + 0.2 + 0.6 * h(0)) * config.cellMeters;
  const cz = (gz + 0.2 + 0.6 * h(1)) * config.cellMeters;
  if (!(h(2) < shareAt(cx, cz))) return null;
  const count = config.minStones + Math.floor(h(3) * (config.maxStones - config.minStones + 1));
  const radius = lerp(config.minRadius, config.maxRadius, h(4));
  const stones = [];
  for (let i = 0; i < count; i += 1) {
    const r = (channel) => stoneHash01(gx * 31 + i, gz * 17 - i, channel, SALT + 1);
    // Keystones near the middle, the rest crowding outward and shrinking.
    const keystone = i < 1 + Math.floor(h(5) * config.maxKeystones);
    const reach = keystone ? radius * 0.35 * r(0) : radius * (0.25 + 0.75 * Math.sqrt(r(0)));
    const angle = r(1) * Math.PI * 2;
    const scale = keystone
      ? lerp(config.keystoneMinScale, config.keystoneMaxScale, r(2))
      : lerp(config.stoneMaxScale, config.stoneMinScale, reach / radius) * (0.75 + 0.5 * r(2));
    stones.push({ identity: `${gx}:${gz}:${i}`, x: cx + Math.cos(angle) * reach, z: cz + Math.sin(angle) * reach,
      scale, roll: r(3), rotation: r(4), priority: r(5) });
  }
  return { cx, cz, radius, stones };
}

/**
 * The formation stones that land in one chunk. Every formation cell whose stones
 * could reach the chunk is tried; the sink keeps only the stones this chunk owns.
 *
 * @param {object} options sink options (see createStonePlacementSink), plus:
 * @param {(x: number, z: number) => number} options.shareAt formation chance at a point, 0..1
 * @param {number} options.seaLevel
 * @param {(x: number, z: number) => boolean} [options.blocked] e.g. path clearance
 * @param {object} [options.config] `rocks.formations`
 */
export function* iterateRockFormations({ shareAt, seaLevel, blocked = null, config = DEFAULT_ROCK_FORMATIONS, ...sinkOptions }) {
  if (!config.enabled) return [];
  const sink = createStonePlacementSink({ prefix: 'formation-rock', ...sinkOptions });
  const { tileSize, heightAt } = sinkOptions;
  const { minX, minZ, maxX, maxZ } = sink.cells;
  const reach = config.maxRadius + config.cellMeters;
  const x0 = minX * tileSize - reach;
  const x1 = maxX * tileSize + reach;
  const z0 = -maxZ * tileSize - reach;
  const z1 = -minZ * tileSize + reach;
  for (let gz = Math.floor(z0 / config.cellMeters); gz * config.cellMeters < z1; gz += 1) {
    for (let gx = Math.floor(x0 / config.cellMeters); gx * config.cellMeters < x1; gx += 1) {
      yield;
      const formation = formationStones(gx, gz, config, shareAt);
      if (!formation) continue;
      for (const stone of formation.stones) {
        if (!sink.owns(stone.x, stone.z) || blocked?.(stone.x, stone.z)) continue;
        const height = heightAt(stone.x, stone.z);
        if (!Number.isFinite(seaLevel) || height < seaLevel + config.minimumAboveSea) continue;
        sink.place(stone.identity, stone.x, stone.z, stone.scale, stone.roll, stone.rotation, stone.priority, height);
      }
    }
  }
  return sink.placements;
}
