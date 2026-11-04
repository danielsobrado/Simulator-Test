/**
 * Biome surface-response captures (scripts/run-biome-surface-qa.mjs): a
 * deterministic spot inside each biome, and a staged scene in front of the
 * camera there — a trail of prints, a spell crater, ripples on water and a
 * water spell — so each biome's `ripples`, `prints` and `dunes` read side by side.
 */

/** Cells round a candidate that must share its biome, so the shot is inside it. */
const INSIDE_CELLS = 8;
/** Metres ahead at which water makes a shore shot. */
const WATER_REACH = [8, 14];
const DIRECTIONS = 8;
/** Candidates of the right biome tried for a shore before settling for dry ground. */
const SHORE_TRIES = 3000;
/** Metres ahead the ground shot looks at, which must be dry. */
const GROUND_REACH = [2, 4, 6];
/** The procedural world has no bounds; search the span the visual manifests use. */
const PROCEDURAL_SPAN = Object.freeze({ minCellX: -8000, minCellZ: -8000, widthCells: 16000, heightCells: 16000 });

const hasWater = (generator, cellX, cellZ) => (generator.sampleWater?.(cellX, cellZ)?.kind ?? 0) > 0;
/** Cells either side checked for slope, and the rise allowed across them (m): no cliffs, no canyon walls. */
const SLOPE_CELLS = 3;
const MAX_RISE = 1.5;

function gentle(generator, cellX, cellZ) {
  if (!generator.sampleHeight) return true;
  const here = generator.sampleHeight(cellX, cellZ);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) =>
    Math.abs(generator.sampleHeight(cellX + dx * SLOPE_CELLS, cellZ + dz * SLOPE_CELLS) - here) <= MAX_RISE);
}

/** The camera looks down −z at yaw 0. */
const yawToward = (dx, dz) => Math.atan2(-dx, -dz);

/**
 * A heading for the ground shot: dry for the first few metres and as far from
 * the spell's heading as possible, so prints are on land and the blob is out
 * of frame. Null when every heading runs into water.
 */
function dryHeading(generator, tileSize, x, z, awayFrom) {
  let best = null;
  for (let index = 0; index < DIRECTIONS; index += 1) {
    const angle = index / DIRECTIONS * Math.PI * 2;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const dry = GROUND_REACH.every((reach) => !hasWater(generator, (x + dx * reach) / tileSize, -(z + dz * reach) / tileSize));
    if (!dry) continue;
    const yaw = yawToward(dx, dz);
    const spread = Math.abs(Math.atan2(Math.sin(yaw - awayFrom), Math.cos(yaw - awayFrom)));
    if (!best || spread > best.spread) best = { yaw, spread };
  }
  return best?.yaw ?? null;
}

/**
 * A canonical pose inside `tileId`, facing water within ~14 m when there is
 * some, with a dry `groundYaw` for the ground shot; the same pose every run
 * for the same world and seed.
 *
 * @returns {{ x: number, z: number, yaw: number, groundYaw: number, water: boolean, sampled: number } | null}
 */
export function findBiomeSurfacePose(generator, tileSize, tileId, { seed = 20261103, attempts = 2000000 } = {}) {
  const span = generator.source?.bounds ?? PROCEDURAL_SPAN;
  let state = seed >>> 0;
  const next = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  let dry = null;
  let matches = 0;
  for (let sampled = 1; sampled <= attempts; sampled += 1) {
    const cellX = span.minCellX + Math.floor(next() * span.widthCells);
    const cellZ = span.minCellZ + Math.floor(next() * span.heightCells);
    if (generator.sampleTile(cellX, cellZ) !== tileId || hasWater(generator, cellX + 0.5, cellZ + 0.5)) continue;
    const inside = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .every(([dx, dz]) => generator.sampleTile(cellX + dx * INSIDE_CELLS, cellZ + dz * INSIDE_CELLS) === tileId);
    if (!inside || !gentle(generator, cellX, cellZ)) continue;
    const x = (cellX + 0.5) * tileSize;
    const z = -(cellZ + 0.5) * tileSize;
    for (let index = 0; index < DIRECTIONS; index += 1) {
      const angle = index / DIRECTIONS * Math.PI * 2;
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const wet = WATER_REACH.every((reach) => hasWater(generator, (x + dx * reach) / tileSize, -(z + dz * reach) / tileSize));
      // The camera looks down −z at yaw 0.
      if (!wet) continue;
      const yaw = yawToward(dx, dz);
      const groundYaw = dryHeading(generator, tileSize, x, z, yaw);
      if (groundYaw !== null) return { x, z, yaw, groundYaw, water: true, sampled };
    }
    if (!dry) {
      const yaw = next() * Math.PI * 2;
      const groundYaw = dryHeading(generator, tileSize, x, z, yaw);
      if (groundYaw !== null) dry = { x, z, yaw, groundYaw, water: false, sampled };
    }
    matches += 1;
    if (matches >= SHORE_TRIES) return dry;
  }
  return dry;
}

function frameAt(camera, yaw) {
  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const at = (ahead, side) => ({
    x: camera.position.x + forward.x * ahead + right.x * side,
    z: camera.position.z + forward.z * ahead + right.z * side,
  });
  return { forward, right, at };
}

/**
 * Stage the surface scene round the camera: prints walking away to the left
 * and a crater to the right along `groundYaw` (away from the water on a
 * shore), ripples where the water starts and `spell` cast at the water (or
 * the ground) along the camera's own heading.
 */
/** Re-presses the staged grass; the meadow springs back within about a second. */
let holdGrass = null;
export function holdStagedGrass() { holdGrass?.(); }

export function stageSurfaceDemo(editor, { spell = 'waterySphere', water = false, groundYaw = null } = {}) {
  const camera = editor.viewModeController.camera;
  const origin = editor.terrainView.floatingOrigin.getState();
  const { forward, right, at } = frameAt(camera, camera.rotation.y);
  const ground = frameAt(camera, groundYaw ?? camera.rotation.y);
  const canonical = (point) => ({ x: point.x + origin.x, z: point.z + origin.z });
  const { stampFootprint, stampDisc } = editor.groundDeformation;
  const facing = Math.atan2(ground.forward.x, ground.forward.z);
  // Where grass covers the ground the prints alone are hidden under it, so the
  // trail and the crater also press the blades flat, as a walker and a blast do.
  const grass = editor.stylizedSurface?.meadowGrass?.spellGround;
  const presses = [];
  for (let step = 0; step < 10; step += 1) {
    const local = ground.at(1.6 + step * 0.42, -0.9 + (step % 2 ? 0.13 : -0.13));
    const print = canonical(local);
    stampFootprint(print.x, print.z, facing);
    presses.push([local.x, local.z, 0.32, 1, 0.5]);
  }
  const craterLocal = ground.at(3.6, 1.5);
  const crater = canonical(craterLocal);
  stampDisc(crater.x, crater.z, 1.2, 0.8, 0.5);
  presses.push([craterLocal.x, craterLocal.z, 1.3, 1, 0.55]);
  holdGrass = grass ? () => { for (const press of presses) grass.pressDisc(...press); } : null;
  holdGrass?.();
  const field = editor.waterInteraction?.field;
  if (water && field) {
    for (const [ahead, side] of [[10, -2], [11, 1.5], [12.5, 0]]) {
      const drop = canonical(at(ahead, side));
      field.splash(drop.x, drop.z, -0.04, { width: 0.4 });
    }
  }
  // Far enough out on dry ground that the hanging blob stays in frame.
  const target = at(water ? 11 : 10, 0);
  const groundY = editor.terrainView.getWorldHeight(target.x, target.z);
  const played = editor.spellRuntime?.effects?.play(spell, {
    origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: target.x, y: groundY, z: target.z },
    normal: { x: 0, y: 1, z: 0 },
    direction: { x: forward.x, y: 0, z: forward.z },
    forward: { x: forward.x, y: 0, z: forward.z },
    right: { x: right.x, y: 0, z: right.z },
    caster: { x: camera.position.x, y: camera.position.y - 1.7, z: camera.position.z },
  }) ?? false;
  return { played, prints: 10, water, region: structuredClone(editor.biomeSurface?.current ?? null) };
}

/**
 * The ground-shot heading checked against the loaded water field, which also
 * knows water the generator does not (bog pools): the dry heading furthest
 * from `awayFrom`, or `fallback` when every heading is wet.
 */
export function liveDryHeading(editor, awayFrom, fallback) {
  const camera = editor.viewModeController.camera;
  const origin = editor.terrainView.floatingOrigin.getState();
  const x = camera.position.x + origin.x, z = camera.position.z + origin.z;
  let best = null;
  for (let index = 0; index < 16; index += 1) {
    const angle = index / 16 * Math.PI * 2;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const dry = [...GROUND_REACH, 8].every((reach) =>
      !((editor.terrainView.getCanonicalWater(x + dx * reach, z + dz * reach)?.coverage ?? 0) > 0.1));
    if (!dry) continue;
    const yaw = yawToward(dx, dz);
    const spread = Math.abs(Math.atan2(Math.sin(yaw - awayFrom), Math.cos(yaw - awayFrom)));
    if (!best || spread > best.spread) best = { yaw, spread };
  }
  return best?.yaw ?? fallback;
}
