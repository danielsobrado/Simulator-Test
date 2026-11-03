import {
  float,
  max,
  mix,
  oneMinus,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import { seaStateUniforms } from '../../water/seaState.js';
import { groundDeformationNode } from './groundDeformationNode.js';
import { groundDeformationUniforms } from './groundDeformationState.js';
import { heightRelief } from '../../materials/heightRelief.js';

/** How deep a full print dents bare ground, metres. */
const PRINT_RELIEF_METRES = 0.03;
/** Height above the sea that still counts as beach sand for prints. */
const BEACH_TOP = 1.8;

/**
 * Footprints on the terrain: pressed snow goes a shade darker and cooler, sand
 * a shade darker and wetter-looking. Where the ground is snow (the baked snow
 * weight), beach (just above the sea), or dry ground in a biome whose
 * `prints.ground` takes them (desert sand, bog mud); elsewhere nothing shows.
 *
 * @param {object} options
 * @param {object} options.terrainUv chunk uv
 * @param {number} options.chunkWorldSize metres
 * @param {object} options.chunkCenter vec2 uniform, canonical chunk centre (whole metres)
 * @param {object} options.groundHeight world height of the ground
 * @param {object} options.snow 0..1 baked snow weight
 * @param {object} [options.ground] 0..1 dry ground in a biome that takes prints
 */
export function createFootprintShading({ terrainUv, chunkWorldSize, chunkCenter, groundHeight, snow, ground = float(0) }) {
  const localMeters = vec2(terrainUv.x, terrainUv.y).mul(chunkWorldSize);
  // The chunk's corner in whole metres on cell axes (canonical z runs the other way).
  const originMeters = vec2(
    chunkCenter.x.sub(chunkWorldSize * 0.5),
    chunkCenter.y.negate().sub(chunkWorldSize * 0.5),
  ).round();
  const depth = groundDeformationNode(originMeters, localMeters);
  const above = groundHeight.sub(seaStateUniforms.seaLevel);
  const beach = smoothstep(-0.2, 0.1, above).mul(oneMinus(smoothstep(BEACH_TOP - 0.4, BEACH_TOP, above)));
  const surface = max(max(snow, beach), ground.mul(groundDeformationUniforms.ground));
  const pressed = depth.mul(surface);
  return {
    pressed,
    /**
     * Pressed sand and mud dent the normal: a hollow with a lip round its edge.
     * Snow carries its own relief (SnowDetail), so `snow` hands it back.
     */
    relief(normal) {
      const height = pressed.negate().add(pressed.mul(oneMinus(pressed)).mul(1.2)).mul(PRINT_RELIEF_METRES);
      return mix(heightRelief(normal, height), normal, snow).normalize();
    },
    apply(color) {
      // Pressed snow takes a cool blue shade, strong enough to read from eye height.
      const tint = mix(vec3(groundDeformationUniforms.tint), vec3(0.6, 0.69, 0.84), snow);
      const printed = mix(color, color.mul(tint), pressed.mul(float(0.85)));
      // Sand and mud pushed up round the edge of a print catch a little light.
      const rim = pressed.mul(oneMinus(pressed)).mul(4).mul(oneMinus(snow));
      return printed.mul(rim.mul(0.12).add(1));
    },
  };
}
