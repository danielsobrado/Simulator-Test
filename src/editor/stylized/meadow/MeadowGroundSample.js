import { sampleSurfaceMaskChannel } from '../../world/SurfaceMaskSampling.js';
import { acceptsMeadowHabitat } from './meadowHabitat.js';
import { sampleHeight } from '../scatterMath.js';
import { hash2d } from './meadowGrassGeometry.js';
import { createMeadowPathSampler } from './MeadowPathSampler.js';
import { forestDensitySamplerFromGrid } from '../forest/ForestFloor.js';
import { BIOME_BLUR_CELLS } from '../../world/BiomeFieldBlur.js';
import {
  CANOPY_FLOOR_PATCH_SALT,
  canopyFloorCover,
  ecotoneJitter,
  grassPatchCover,
  grassStandDensity,
} from '../../world/GrassPatchiness.js';

/** Cells a stem may reach across to mix neighboring biome silhouettes. */
const ECOTONE_REACH_CELLS = 0.9;
/** Decorrelates the density tap's jitter from the silhouette's. */
const DENSITY_TAP_SHIFT = 311.7;

export const MIN_GRASS_STRENGTH = 0.02;
/** How far a root zone's three lobes push in and out of its circle. */
const ROOT_LOBE = 0.22;
const sampleMask = (pixels, size, x, z, channel) => sampleSurfaceMaskChannel(pixels, size, size, x, z, channel);
function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The identical ground rule runs against immutable job inputs on either thread. */
export function createMeadowGroundSample(snapshot, { forest = null, paths = null } = {}) {
  const { page, descriptor, chunkSize, tileSize, eligible, shapeTable, growth, worldSeed, rocks, flatten, roots = [] } = snapshot;
  const mask = page.surfaceMaskPixels;
  paths ??= createMeadowPathSampler(snapshot.pathConfig);
  forest ??= snapshot.forest ? forestDensitySamplerFromGrid(snapshot.forest) : null;
  const pathResult = { path: 0, blocked: false };
  const jitter = { x: 0, z: 0 };
  const last = chunkSize - 1;
  return (x, z, rank, out) => {
    const localX = x / tileSize - descriptor.originCellX;
    const localZ = -z / tileSize - descriptor.originCellZ;
    if (localX < 0 || localZ < 0 || localX >= chunkSize || localZ >= chunkSize) return false;
    const ownTile = page.tiles[Math.floor(localZ) * chunkSize + Math.floor(localX)];
    if (!eligible[ownTile]) return false;
    // Clamp to this page so the result never depends on neighboring residency.
    ecotoneJitter(x, z, ECOTONE_REACH_CELLS, jitter);
    const reachX = Math.min(last, Math.max(0, Math.floor(localX + jitter.x)));
    const reachZ = Math.min(last, Math.max(0, Math.floor(localZ + jitter.z)));
    const reached = page.tiles[reachZ * chunkSize + reachX];
    const tile = eligible[reached] ? reached : ownTile;
    const coverage=mask?sampleMask(mask,chunkSize,localX,localZ,1):1;
    // Density from a wider tap (BIOME_BLUR_CELLS): averaged over stems it is
    // the blurred density the surface mask bakes its islands from, so a thin
    // biome's stand thins in over ~10 m instead of at the border. Read live,
    // so settings affect islands before pages rebuild.
    ecotoneJitter(x + DENSITY_TAP_SHIFT, z - DENSITY_TAP_SHIFT, BIOME_BLUR_CELLS, jitter);
    const tapX = Math.min(last, Math.max(0, Math.floor(localX + jitter.x)));
    const tapZ = Math.min(last, Math.max(0, Math.floor(localZ + jitter.z)));
    const tapped = page.tiles[tapZ * chunkSize + tapX];
    const densityTile = eligible[tapped] ? tapped : tile;
    const biomeDensity=growth?growth.profiles[growth.table[densityTile]].density:1;
    const density=growth
      ?grassPatchCover(x/tileSize,-z/tileSize,biomeDensity,worldSeed)*grassStandDensity(x,z,biomeDensity,worldSeed)
      :1;
    if(!acceptsMeadowHabitat(x,z,worldSeed,coverage,density))return false;
    let strength=.30+.70*coverage;
    let path = 0;
    if (mask) {
      strength *= 1 - smoothstep(0.15, 0.6, sampleMask(mask, chunkSize, localX, localZ, 2));
      path = sampleMask(mask, chunkSize, localX, localZ, 0);
    }
    const pathSample=paths.sample(x,z,coverage,path,pathResult);
    if(pathSample.blocked)return false;
    path=pathSample.path;
    // Path shoulder: the stand thins and shortens toward the edge, never a hard grass line.
    if (pathSample.shoulder > 0) {
      if (hash2d(rank, 97) < pathSample.shoulder * 0.8) return false;
      strength *= 1 - 0.45 * pathSample.shoulder;
    }
    // Canopy grass gathers into its own islands instead of an even speckle.
    if (forest) {
      const floor = forest(x - descriptor.centerWorldX, z - descriptor.centerWorldZ);
      if (floor < 1) {
        const keep = canopyFloorCover(x / tileSize, -z / tileSize, floor, worldSeed ^ CANOPY_FLOOR_PATCH_SALT)
          * grassStandDensity(x, z, floor, worldSeed ^ CANOPY_FLOOR_PATCH_SALT);
        if (hash2d(rank, 91) >= keep) return false;
      }
    }
    // Nothing grows under a rock; round its foot the stand is pressed flatter.
    for (const rock of rocks) {
      const distance = Math.hypot(x - rock.x, z - rock.z);
      if (distance < rock.radius) return false;
      if (distance < rock.reach) {
        strength *= 1 - flatten * (1 - smoothstep(rock.radius, rock.reach, distance));
      }
    }
    // Root zone: bare roots and litter at a trunk's foot, the stand thinning in
    // over the falloff. Lobed, not round: litter spills unevenly between roots.
    for (const root of roots) {
      const dx = x - root.x, dz = z - root.z, distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= root.reach * root.reach) continue;
      const lobe = 1 + ROOT_LOBE * Math.cos(3 * Math.atan2(dz, dx) + root.phase);
      const keep = smoothstep(root.radius, root.reach, Math.sqrt(distanceSquared) / lobe);
      if (hash2d(rank, 93) >= keep) return false;
      strength *= 0.55 + 0.45 * keep;
    }
    if (strength < MIN_GRASS_STRENGTH) return false;
    out.height = sampleHeight(page, localX, localZ, chunkSize);
    out.strength = strength;
    out.shape = shapeTable[tile];
    out.path = path;
    return true;
  };
}
