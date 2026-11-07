import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { planSettlement } from '../src/editor/world/settlements/SettlementPlanner.js';
import { rect, rectsOverlap } from '../src/editor/world/settlements/SettlementGeometry.js';
import { PAVING_LAYERS, SHADE_LAYER, settlementPavingJob, smoothPath } from '../src/editor/world/settlements/paving/SettlementPavingGeometry.js';
import {
  dressingFor,
  SETTLEMENT_DRESSING_KEYS,
  SETTLEMENT_ROLE_FALLBACK,
  SETTLEMENT_SURFACE_ROLES,
  SETTLEMENT_SURFACE_SETS,
  surfaceSetFiles,
  surfaceSetRecipe,
} from '../src/editor/world/settlements/surfaces/SettlementDressing.js';
import { settlementSkylineArrays } from '../src/editor/world/settlements/view/SettlementSkylineGeometry.js';
import { planDistricts } from '../src/editor/world/settlements/SettlementPlots.js';
import { waterBearing } from '../src/editor/world/settlements/SettlementStreets.js';
import { gatheringSpots } from '../src/editor/world/settlements/SettlementGathering.js';
import { duskFromSky } from '../src/editor/world/settlements/view/SettlementDusk.js';
import { residentManifest } from '../src/editor/actors/ResidentManifest.js';
import { isTrimKind, SETTLEMENT_TRIM, WALL_STAIR } from '../src/editor/world/settlements/SettlementTrim.js';
import { murmurLevel, settlementPresence } from '../src/editor/audio/settlement_ambience.js';
import { houseShell, roomSolids, settlementInteriorArrays } from '../src/editor/world/settlements/view/SettlementInteriorGeometry.js';
import { INTERIOR_BATCH_MAX_VERTICES, INTERIOR_VERTEX_ATTRIBUTES } from '../src/editor/world/settlements/view/interior/InteriorBatchStore.js';
import { planRoom } from '../src/editor/world/settlements/view/interior/RoomPlan.js';
import { ROOM_PIECE_TYPES } from '../src/editor/world/settlements/view/interior/RoomFurnitureMesh.js';
import { buildingDoor, buildingRecipe, SETTLEMENT_BUILDINGS } from '../src/editor/world/settlements/SettlementBuildingCatalog.js';
import { SETTLEMENT_STYLES } from '../src/editor/world/settlements/SettlementProfile.js';
import { planToWorld, settlementPlacements } from '../src/editor/world/settlements/view/SettlementPlacements.js';
import { isStoneKind, SETTLEMENT_STONES, stoneSeed } from '../src/editor/world/settlements/SettlementStones.js';
import { generateStone, STONE_ARCHETYPE_IDS } from '@drusniel/procedural-stone';

const ground = (x, z) => Math.sin(x * 0.01) * 2 + Math.cos(z * 0.013) * 2;

function plan(settlement, routeBearings = [0.4, 2.3, 3.9, 5.2]) {
  return planSettlement({ settlement, worldSeed: 1234, routeBearings, sampleHeight: ground, isBuildable: () => true });
}

const CITY = { id: 18, name: 'Cyvazin', cellX: 500, cellZ: -300, population: 28, capital: true, walls: true, citadel: true, plaza: true, temple: true };
const HAMLET = { id: 5, name: 'Thorp', cellX: 10, cellZ: 20, population: 0.3 };
const TILE_METRES = { earth: 3, cobble: 2, flagstone: 2.5 };

function drain(job) {
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}

test('a settlement plan is deterministic in its inputs', () => {
  assert.deepEqual(plan(CITY), plan(CITY));
});

test('a city is a web of streets: rings and lanes as well as main roads', () => {
  const kinds = new Set(plan(CITY).streets.map(({ kind }) => kind));
  for (const kind of ['main', 'ring', 'lane', 'walk']) assert.ok(kinds.has(kind), `missing ${kind} streets`);
  assert.ok(plan(CITY).streets.filter(({ kind }) => kind === 'ring').length >= 2);
});

test('the market square is walled by house fronts and nothing stands in it', () => {
  const { buildings, squareRadius } = plan(CITY);
  assert.ok(squareRadius > 0);
  const distances = buildings.map((building) => Math.hypot(building.x, building.z) - Math.min(building.width, building.depth) / 2);
  assert.ok(Math.min(...distances) >= squareRadius - 1e-6, 'a building reaches into the square');
  assert.ok(distances.filter((distance) => distance < squareRadius + 4).length >= 6, 'the square is not enclosed');
});

test('no two buildings of a plan overlap', () => {
  const boxes = plan(CITY).buildings
    .filter(({ kind }) => !['wall', 'tower', 'gatehouse'].includes(kind))
    .map((building) => rect(building.x, building.z, building.width, building.depth, building.yaw));
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      assert.equal(rectsOverlap(boxes[left], boxes[right]), false, `buildings ${left} and ${right} overlap`);
    }
  }
});

test('placements turn plan space into canonical world space', () => {
  const cityPlan = plan(CITY);
  const placements = settlementPlacements(CITY, cityPlan, 2, ground);
  assert.equal(placements.length, cityPlan.buildings.length + cityPlan.props.length);
  const building = cityPlan.buildings[0];
  const placed = placements[0];
  assert.deepEqual({ x: placed.x, z: placed.z }, planToWorld(CITY, 2, building.x, building.z));
  assert.equal(placed.z, -(CITY.cellZ * 2 + building.z));
  assert.equal(placed.y, building.pad);
  // The front, (sin yaw, cos yaw) in plan space, is (sin yaw, −cos yaw) in the world.
  assert.ok(Math.abs(Math.sin(placed.rotationY) - Math.sin(building.yaw)) < 1e-12);
  assert.ok(Math.abs(Math.cos(placed.rotationY) + Math.cos(building.yaw)) < 1e-12);
  assert.ok(placements.every(({ seed }) => seed >= 0 && seed < 1));
  assert.ok(placements.some(({ small }) => small) && placements.some(({ small }) => !small));
});

test('a smoothed path keeps its ends and steps finely', () => {
  const path = smoothPath([[0, 0], [12, 1], [24, -2], [36, 0]]);
  assert.deepEqual(path[0], [0, 0]);
  assert.deepEqual(path.at(-1), [36, 0]);
  for (let index = 1; index < path.length; index += 1) {
    assert.ok(Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]) < 2.2);
  }
});

test('paving faces up, hugs the ground and frays only at its border', () => {
  const layers = drain(settlementPavingJob(plan(CITY), ground, TILE_METRES));
  assert.deepEqual(layers.map(({ kind }) => kind).sort(), [...PAVING_LAYERS, SHADE_LAYER].sort());
  for (const { kind, positions, uvs, edges, colors, indices } of layers) {
    assert.equal(uvs.length / 2, positions.length / 3);
    assert.equal(colors.length, positions.length);
    assert.equal(edges.length, positions.length / 3);
    assert.ok(edges.every((edge) => edge >= 0 && edge <= 1));
    assert.ok(edges.some((edge) => edge === 0) && edges.some((edge) => edge === 1));
    for (let vertex = 0; vertex < positions.length; vertex += 3) {
      // Local z is minus plan z; the lift is a few centimetres.
      const lift = positions[vertex + 1] - ground(positions[vertex], -positions[vertex + 2]);
      assert.ok(lift > 0.03 && lift < 0.1, `${kind} paving lifted ${lift} m`);
    }
    for (let index = 0; index < indices.length; index += 3) {
      const [a, b, c] = [indices[index] * 3, indices[index + 1] * 3, indices[index + 2] * 3];
      const normalY = (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a])
        - (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
      assert.ok(normalY >= -1e-6, `${kind} paving has a triangle facing down`);
    }
  }
});

test('a hamlet is paved in earth alone', () => {
  const layers = drain(settlementPavingJob(plan(HAMLET, [2]), ground, TILE_METRES));
  assert.deepEqual(layers.map(({ kind }) => kind), ['earth', SHADE_LAYER]);
});

test('every settlement gets a complete dressing, and towns differ', () => {
  const keys = new Set();
  for (let id = 1; id <= 200; id += 1) {
    for (const topStyle of ['slate', 'terracotta']) {
      const dressing = dressingFor({ id }, { topStyle });
      for (const role of SETTLEMENT_SURFACE_ROLES) {
        assert.ok(SETTLEMENT_SURFACE_SETS[dressing[role]], `settlement ${id} has no ${role} set`);
      }
      assert.equal(dressing.roof, topStyle === 'slate' ? 'roof-slate' : 'roof-clay');
      keys.add(dressing.key);
    }
    assert.deepEqual(dressingFor({ id }, { topStyle: 'slate' }), dressingFor({ id }, { topStyle: 'slate' }));
  }
  assert.deepEqual([...keys].sort(), [...SETTLEMENT_DRESSING_KEYS].sort());
  for (const role of ['cobble', 'flagstone', 'earth']) {
    assert.ok(SETTLEMENT_SURFACE_SETS[dressingFor({ id: 1 }, { topStyle: 'slate' })[role]].tileMetres > 0);
  }
});

test('every surface set ships what it is made from', () => {
  for (const [name, set] of Object.entries(SETTLEMENT_SURFACE_SETS)) {
    assert.notEqual(Boolean(set.source), Boolean(set.ptl), `${name} must be photographed or procedural, not both`);
    if (set.ptl) {
      const recipe = JSON.parse(fs.readFileSync(new URL(`../public/${surfaceSetRecipe(name)}`, import.meta.url), 'utf8'));
      assert.equal(recipe.format, 'ptl-material', `${name} is not a PTL recipe`);
      assert.ok(set.bakeMetres > 0);
    } else {
      for (const file of Object.values(surfaceSetFiles(name))) {
        assert.ok(fs.existsSync(new URL(`../public/assets/textures/settlement/${file}`, import.meta.url)), `${file} is missing`);
      }
    }
  }
});

test('every role falls back to a photographed set', () => {
  for (const role of SETTLEMENT_SURFACE_ROLES) {
    assert.ok(SETTLEMENT_SURFACE_SETS[SETTLEMENT_ROLE_FALLBACK[role]]?.source, `${role} has no photographed fallback`);
  }
});

test('a town is dressed with loose stone the stone library can generate', () => {
  const cityPlan = plan(CITY);
  const stones = cityPlan.props.filter(({ kind }) => isStoneKind(kind));
  const kinds = new Set(stones.map(({ kind }) => kind));
  for (const kind of ['guardStone', 'boulder', 'fieldstone']) assert.ok(kinds.has(kind), `no ${kind} placed`);
  for (const stone of stones) {
    assert.ok(stone.variant < SETTLEMENT_STONES[stone.kind].variants);
    assert.ok(stone.scale > 0.2 && stone.scale < 2.5, `${stone.kind} scaled ${stone.scale}`);
  }
  const placements = settlementPlacements(CITY, cityPlan, 2, ground).filter(({ kind }) => isStoneKind(kind));
  assert.equal(placements.length, stones.length);
  assert.ok(placements.every(({ key, small, scale }) => key.startsWith(`${cityPlan.profile.style.key}|`) && small && scale !== 1));
});

test('every stone kind names an archetype that generates a grounded mesh', () => {
  for (const [kind, { archetype, variants }] of Object.entries(SETTLEMENT_STONES)) {
    assert.ok(STONE_ARCHETYPE_IDS.includes(archetype), `${kind} names unknown archetype ${archetype}`);
    for (let variant = 0; variant < variants; variant += 1) {
      const { mesh } = generateStone({ archetype, seed: stoneSeed(kind, variant) });
      assert.ok(mesh.indices.length >= 3 && mesh.positions.length === mesh.normals.length);
      assert.equal(mesh.tones.length, mesh.positions.length / 3);
      let lowest = Infinity;
      for (let index = 1; index < mesh.positions.length; index += 3) lowest = Math.min(lowest, mesh.positions[index]);
      assert.ok(Math.abs(lowest) < 0.05, `${kind} ${variant} floats or sinks by ${lowest}`);
    }
  }
});

test('a skyline is a few triangles a building, standing on its pad', () => {
  const cityPlan = plan(CITY);
  const colors = { stone: [0.5, 0.5, 0.5], roof: [0.2, 0.2, 0.25], walls: () => [0.8, 0.7, 0.5] };
  const { positions, colors: vertexColors, indices } = settlementSkylineArrays(cityPlan, colors);
  assert.equal(vertexColors.length, positions.length);
  assert.ok(indices.length / 3 <= cityPlan.buildings.length * 14);
  assert.ok(indices.length / 3 >= cityPlan.buildings.length * 10);
  assert.ok(indices.every((index) => index < positions.length / 3));
  const pads = cityPlan.buildings.map(({ pad }) => pad);
  for (let vertex = 1; vertex < positions.length; vertex += 3) {
    assert.ok(positions[vertex] >= Math.min(...pads) - 1 && positions[vertex] <= Math.max(...pads) + 30);
  }
});

test('a walled town is closed: its wall has no gap wider than a gate', () => {
  const walls = plan(CITY).buildings.filter(({ kind }) => ['wall', 'gatehouse'].includes(kind));
  const bearings = walls.map(({ x, z }) => Math.atan2(x, z)).sort((left, right) => left - right);
  const radii = walls.map(({ x, z }) => Math.hypot(x, z));
  assert.ok(Math.max(...radii) - Math.min(...radii) > 4, 'the wall is still a circle');
  let widest = bearings[0] + Math.PI * 2 - bearings.at(-1);
  for (let index = 1; index < bearings.length; index += 1) widest = Math.max(widest, bearings[index] - bearings[index - 1]);
  assert.ok(widest * Math.min(...radii) < 26, `the wall has a ${Math.round(widest * Math.min(...radii))} m gap`);
});

test('a port finds its water, and its quay becomes a district', () => {
  const profile = { radius: 100, rank: 2 };
  // Sea to the plan's +x side, beyond 80 m.
  const bearing = waterBearing(profile, (x) => x < 80);
  assert.ok(Math.abs(bearing - Math.PI / 2) < 0.3, `quay bearing ${bearing}`);
  assert.equal(waterBearing(profile, () => true), null);
  const districts = planDistricts({ profile, bearings: [bearing, bearing + 2, bearing + 4], quayBearing: bearing, keep: null, random: () => 0.5 });
  assert.deepEqual(districts.map(({ kind }) => kind), ['quay', 'craft']);
  assert.notEqual(districts[1].bearing, bearing);
  assert.deepEqual(planDistricts({ profile: { radius: 60, rank: 1 }, bearings: [0], quayBearing: null, keep: null, random: () => 0.5 }), []);
});

test('residents gather where the plan has stalls, benches and doors', () => {
  const cityPlan = plan(CITY);
  const spots = gatheringSpots(CITY, cityPlan, 2);
  assert.ok(spots.length >= 12);
  const centre = planToWorld(CITY, 2, 0, 0);
  // The first spots are the market's: inside the square.
  assert.ok(Math.hypot(spots[0].x - centre.x, spots[0].z - centre.z) < cityPlan.squareRadius);
  const settings = { maxPerSettlement: 14, wanderRadius: 18 };
  const manifest = residentManifest(CITY, { tileSize: 2, worldSeed: 7, settings, spots });
  // Capped by the settings: a city would field more.
  assert.equal(manifest.length, 14);
  assert.deepEqual(manifest, residentManifest(CITY, { tileSize: 2, worldSeed: 7, settings, spots }));
  manifest.forEach((resident, index) => {
    assert.ok(Math.hypot(resident.x - spots[index].x, resident.z - spots[index].z) < 1e-9);
  });
});

test('dusk follows a low sun or a dimmed key light', () => {
  assert.equal(duskFromSky(null), 0);
  assert.equal(duskFromSky({ sunDirectionValue: { y: 0.8 }, directional: { intensity: 2 } }), 0);
  assert.equal(duskFromSky({ sunDirectionValue: { y: 0.0 }, directional: { intensity: 2 } }), 1);
  assert.equal(duskFromSky({ sunDirectionValue: { y: 0.8 }, directional: { intensity: 0.08 } }), 1);
  const evening = duskFromSky({ sunDirectionValue: { y: 0.17 }, directional: { intensity: 2 } });
  assert.ok(evening > 0.2 && evening < 0.8);
});

test('a city is trimmed: signs, awnings, ivy, wall stairs and livestock', () => {
  const cityPlan = plan(CITY);
  const trim = cityPlan.props.filter(({ kind }) => isTrimKind(kind));
  // Shoring is a goblin and orc wall's, and this city is neither.
  for (const kind of Object.keys(SETTLEMENT_TRIM).filter((name) => name !== 'wallShoring')) assert.ok(trim.some((prop) => prop.kind === kind), `no ${kind} planned`);
  assert.ok(trim.every(({ kind, variant }) => variant < SETTLEMENT_TRIM[kind].variants));
  // A stair stands just inside the wall it climbs, and its flight reaches the wall-walk.
  const walls = cityPlan.buildings.filter(({ kind }) => kind === 'wall');
  const span = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  for (const stair of trim.filter(({ kind }) => kind === 'wallStair')) {
    const wall = walls.reduce((best, candidate) => (span(candidate, stair) < span(best, stair) ? candidate : best));
    assert.ok(Math.hypot(stair.x, stair.z) < Math.hypot(wall.x, wall.z), 'a stair is outside its wall');
    assert.ok(span(wall, stair) < 2.2);
  }
  assert.equal(Math.round(WALL_STAIR.height / WALL_STAIR.rise) * WALL_STAIR.rise, 6);
  assert.ok(walls.some(({ variant }) => variant === 1) && walls.some(({ variant }) => variant === 0), 'no overgrown wall lengths');
});

test('a town is heard in its streets and not from the next hill', () => {
  assert.equal(settlementPresence(0, 150), 1);
  assert.equal(settlementPresence(80, 150), 1);
  assert.equal(settlementPresence(400, 150), 0);
  const edge = settlementPresence(150, 150);
  assert.ok(edge > 0 && edge < 1);
  assert.equal(settlementPresence(10, 0), 0);
  assert.ok(murmurLevel(3, false) > murmurLevel(0, false));
  assert.ok(murmurLevel(3, true) < murmurLevel(3, false));
  assert.ok(murmurLevel(9, false) <= 1.01);
});

test('every fronted house of every style knows its door, and its recipe puts the leaf away', () => {
  let doors = 0;
  for (const style of SETTLEMENT_STYLES) {
    for (const [kind, variants] of Object.entries(SETTLEMENT_BUILDINGS)) {
      variants.forEach((entry, variant) => {
        const door = buildingDoor(style.key, kind, variant);
        if (entry.archetype !== 'house') return assert.equal(door, null);
        if (!door) return undefined;
        doors += 1;
        assert.ok(door.width >= 0.8 && door.height >= 1.8 && door.z > 0, `${style.key} ${kind} ${variant}`);
        assert.ok(Math.abs(door.x) < entry.footprint[0] / 2);
        // The door stands open as a clear void: the recipe names it, nothing is shrunk.
        assert.equal(buildingRecipe(style, kind, variant).openDoorId, door.id);
        assert.equal(buildingRecipe(style, kind, variant).componentTransforms, undefined);
        return assert.equal(buildingRecipe(style, kind, variant, { openDoor: false }).openDoorId, undefined);
      });
    }
  }
  assert.ok(doors >= 60);
});

test('a town has rooms behind its doors', () => {
  const cityPlan = plan(CITY);
  const enterable = cityPlan.buildings.filter((building) => houseShell(building));
  assert.ok(enterable.length > 100);
  for (const building of enterable) {
    const shell = houseShell(building);
    assert.ok(shell.doorRight - shell.doorLeft >= 0.9, 'a doorway too narrow to walk through');
    assert.ok(shell.doorLeft > shell.x0 && shell.doorRight < shell.x1, 'a doorway outside its room');
    assert.ok(shell.x1 - shell.x0 >= 2.2 && shell.inner - shell.back >= 2.2 && shell.front > shell.inner);
    // The room lies inside the plot the planner reserved for the house.
    assert.ok(shell.x0 > -building.width / 2 && shell.x1 < building.width / 2 && shell.back > -building.depth / 2);
  }
  assert.equal(houseShell(cityPlan.buildings.find(({ kind }) => kind === 'wall')), null);
  const groups = settlementInteriorArrays(cityPlan);
  const roles = new Set(groups.map(group => group.materialKey));
  for (const key of ['wood', 'plaster', 'stone', 'plain', 'glow', 'sky', 'exterior']) assert.ok(roles.has(key), `no ${key} in the rooms`);
  for (const group of groups) {
    const key = group.materialKey;
    const vertices = group.positions.length / 3;
    assert.ok(vertices > 0 && vertices <= INTERIOR_BATCH_MAX_VERTICES, key);
    assert.ok(group.indices instanceof Uint16Array && group.indices.length % 3 === 0);
    assert.ok(group.indices.every(index => index < vertices && index < 0xffff));
    assert.equal(group.normals.length, vertices * 3);
    assert.equal(group.colors.length, vertices * 3);
    assert.equal(group.fire.length, vertices * 3);
    assert.equal(group.uvs.length, vertices * 2);
    assert.equal(group.sky.length, vertices);
    for (const name of Object.keys(INTERIOR_VERTEX_ATTRIBUTES)) assert.ok(group[name].every(Number.isFinite), `${key} ${name} has a hole in it`);
    for (let index = 0; index < group.normals.length; index += 3) {
      assert.ok(Math.abs(Math.hypot(group.normals[index], group.normals[index + 1], group.normals[index + 2]) - 1) < 1e-6);
    }
  }
  // Every face is wound to look along its normal, as the renderer will cull it.
  for (const group of groups) {
    const { positions: p, normals: n, indices } = group;
    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index] * 3, b = indices[index + 1] * 3, c = indices[index + 2] * 3;
      const [ux, uy, uz] = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const [vx, vy, vz] = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const facing = (uy * vz - uz * vy) * n[a] + (uz * vx - ux * vz) * n[a + 1] + (ux * vy - uy * vx) * n[a + 2];
      assert.ok(facing > -1e-9, 'a face is wound against its normal');
    }
  }
  // Baked light: a room is brighter by its fire than in its far corners, and never unlit by it.
  let [dimmest, brightest] = [Infinity, 0];
  for (const group of groups.filter(group => group.materialKey === 'wood')) {
    for (let index = 0; index < group.fire.length; index += 3) {
      dimmest = Math.min(dimmest, group.fire[index]);
      brightest = Math.max(brightest, group.fire[index]);
    }
  }
  assert.ok(brightest > 0.8 && dimmest < brightest * 0.2, `fire ${dimmest}..${brightest}`);
  assert.equal(settlementInteriorArrays({ buildings: [] }), null);
});

test('rooms are dressed by trade, lit by their fires, and leave the way in clear', () => {
  const cityPlan = plan(CITY);
  const seen = new Set();
  for (const building of cityPlan.buildings) {
    const shell = houseShell(building);
    if (!shell) continue;
    const room = planRoom(building, shell);
    assert.deepEqual(room, planRoom(building, shell), 'a room is furnished differently on a second visit');
    for (const piece of room.pieces) {
      seen.add(piece.type);
      assert.ok(ROOM_PIECE_TYPES.includes(piece.type), `nothing draws a ${piece.type}`);
    }
    // Daylight at the door always; a hearth or a candle wherever one stands.
    assert.ok(room.lights.some(({ sky }) => sky));
    const fires = room.pieces.filter(({ type }) => ['hearth', 'candle', 'sconce', 'chandelier'].includes(type)).length;
    assert.equal(room.lights.filter(({ sky }) => !sky).length, fires);
    for (const [x0, x1, z0, z1, height] of roomSolids(building, shell)) {
      assert.ok(x0 >= shell.x0 - 0.02 && x1 <= shell.x1 + 0.02 && z0 >= shell.back - 0.02 && z1 <= shell.inner + 0.02, 'furniture through a wall');
      assert.ok(x1 > x0 && z1 > z0 && height > 0.3);
      const inDoorway = x1 > shell.doorLeft - 0.35 && x0 < shell.doorRight + 0.35 && z1 > shell.inner - 1.5;
      assert.ok(!inDoorway, 'furniture stands in the doorway');
    }
  }
  for (const type of ['hearth', 'pot', 'shield', 'sconce', 'bed', 'table', 'rug', 'banner', 'candle', 'cask', 'shelves', 'counter']) {
    assert.ok(seen.has(type), `no room has a ${type}`);
  }
  // Each trade its own room, whatever this particular plan happens to hold.
  const shell = { x0: -4, x1: 4, back: -3, inner: 3, front: 3.4, doorLeft: -0.6, doorRight: 0.6 };
  const dressed = (kind, ceiling = 3) => planRoom({ kind, x: 10, z: 20 }, shell, ceiling).pieces.map(({ type }) => type);
  assert.ok(dressed('tavern').includes('bench') && dressed('tavern').includes('counter') && dressed('tavern').includes('chandelier'));
  // Under a low ceiling a wheel of candles would hang at head height: sconces light it instead.
  assert.ok(!dressed('tavern', 2.4).includes('chandelier') && dressed('tavern', 2.4).includes('sconce'));
  assert.ok(dressed('house').includes('bed') && dressed('house').includes('hearth'));
  assert.ok(dressed('shop').includes('shelves') && !dressed('shop').includes('bed'));
  assert.ok(dressed('chapel').includes('altar') && dressed('smithy').includes('anvil'));
});
