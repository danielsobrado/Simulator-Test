import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  dot,
  float,
  fract,
  int,
  ivec2,
  max,
  min,
  normalize,
  smoothstep,
  step,
  textureLoad,
  uniform,
  vec3,
} from 'three/tsl';

/**
 * Sun (or moon) light falling through a room's windows onto its floor and
 * walls, shaped by the leaded glazing — a light cookie, computed rather than
 * lit. Rooms share the town's interior materials with no lights of their own;
 * a real light per window would not scale to a town's hundreds of windows and
 * would add a shadow pass apiece. Instead each fragment traces toward the sun
 * and asks whether that ray leaves through one of its room's window openings,
 * and through glass rather than lead.
 *
 * The windows come from the house generator (SettlementWindows.generated) and
 * are cut into the room walls by SettlementInteriorGeometry, which hands this
 * module one row per room of a small float table.
 */

/** Most windows a room's light is traced through; extra windows are cut but cast no patch. */
export const MAX_ROOM_WINDOWS = 6;
/** Texels per window in the table: [centre x, centre z, normal x, normal z], [half width, sill, head, 1]. */
const TEXELS_PER_WINDOW = 2;
/** Diamond quarries of the leading, in metres along the diagonal (as SettlementDusk draws the glass). */
export const QUARRY = 0.22;
/**
 * How bright the patch is, against the sun on open ground (three lights a
 * Lambert surface with albedo · E · N·L / π). Above 1: an enclosed room still
 * takes the sky's fill light, which no real room gets, so a physically bright
 * patch barely read against it; a sunbeam indoors should stand well out.
 */
const COOKIE_GAIN = 2.2 / Math.PI;
/** The patch softens with distance from the window: the sun is not a point. */
const PENUMBRA_PER_METRE = 0.012;

/**
 * The light that reaches a town's interiors through their windows: direction
 * toward the sun (or the moon by night, which the sky's look already turns its
 * key light into) and its colour at strength. Written by SettlementView from
 * the sky every frame.
 */
export const settlementSunlight = {
  direction: uniform(new THREE.Vector3(0.3, 0.8, 0.2)),
  radiance: uniform(new THREE.Color(0, 0, 0)),
};

/**
 * @param {{ direction: {x:number,y:number,z:number}, color: THREE.ColorRepresentation, intensity: number }} light
 */
export function updateSettlementSunlight({ direction, color, intensity }) {
  if (direction) settlementSunlight.direction.value.set(direction.x, direction.y, direction.z).normalize();
  settlementSunlight.radiance.value.set(color ?? '#ffffff').multiplyScalar(Math.max(0, intensity ?? 0));
}

/**
 * The window table of one town: a row per room, MAX_ROOM_WINDOWS windows a
 * row, in settlement-local metres (the interior mesh's own frame).
 *
 * @param {Array<Array<{ x:number, z:number, nx:number, nz:number, halfWidth:number, sill:number, head:number }>>} rooms
 */
export function createWindowTable(rooms) {
  const width = MAX_ROOM_WINDOWS * TEXELS_PER_WINDOW;
  const height = Math.max(1, rooms.length);
  const data = new Float32Array(width * height * 4);
  rooms.forEach((windows, row) => {
    windows.slice(0, MAX_ROOM_WINDOWS).forEach((window, index) => {
      const at = (row * width + index * TEXELS_PER_WINDOW) * 4;
      data.set([window.x, window.z, window.nx, window.nz, window.halfWidth, window.sill, window.head, 1], at);
    });
  });
  const table = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  table.minFilter = THREE.NearestFilter;
  table.magFilter = THREE.NearestFilter;
  table.generateMipmaps = false;
  table.needsUpdate = true;
  return table;
}

/**
 * How much of the sun reaches this point through its room's windows, 0..1,
 * already shaped by the leading and the Lambert term.
 *
 * @param {object} options
 * @param {THREE.DataTexture} options.table from createWindowTable
 * @param {Node} options.room the fragment's room row (float)
 * @param {Node} options.position settlement-local position
 * @param {Node} options.normal settlement-local surface normal
 */
export function windowLightNode({ table, room, position, normal }) {
  return Fn(() => {
    const sun = normalize(settlementSunlight.direction);
    const row = int(room.add(0.5));
    const light = float(0).toVar();
    Loop(MAX_ROOM_WINDOWS, ({ i }) => {
      const frame = textureLoad(table, ivec2(i.mul(TEXELS_PER_WINDOW), row));
      const extent = textureLoad(table, ivec2(i.mul(TEXELS_PER_WINDOW).add(1), row));
      const outward = vec3(frame.z, 0, frame.w);
      const centre = vec3(frame.x, position.y, frame.y);
      // The sun must stand outside this wall, and the ray must reach the wall.
      const facing = dot(sun, outward);
      const distance = dot(centre.sub(position), outward).div(max(facing, 1e-3));
      const hit = position.add(sun.mul(distance));
      const along = dot(hit.sub(centre), vec3(frame.w.negate(), 0, frame.z));
      const soft = distance.mul(PENUMBRA_PER_METRE).add(0.01);
      const opening = smoothstep(extent.x.add(soft), extent.x.sub(soft), abs(along))
        .mul(smoothstep(extent.y.sub(soft), extent.y.add(soft), hit.y))
        .mul(smoothstep(extent.z.add(soft), extent.z.sub(soft), hit.y));
      // The lead between the quarries throws its lattice; far from the window
      // the penumbra blurs it into the patch.
      const height = hit.y.sub(extent.y);
      const a = fract(along.add(height).div(QUARRY));
      const b = fract(along.sub(height).div(QUARRY));
      const edge = min(min(a, a.oneMinus()), min(b, b.oneMinus()));
      const blur = soft.div(QUARRY);
      const lattice = smoothstep(float(0.02).sub(blur.mul(0.5)), float(0.07).add(blur), edge);
      const valid = extent.w.mul(step(0.02, facing)).mul(step(0, distance));
      light.addAssign(opening.mul(lattice).mul(valid));
    });
    return light.min(1).mul(max(dot(normalize(normal), sun), 0));
  })();
}

/** The light a surface of colour `albedo` adds where the window light falls on it. */
export function windowLightEmission({ albedo, light }) {
  return albedo.mul(settlementSunlight.radiance).mul(light).mul(COOKIE_GAIN);
}
