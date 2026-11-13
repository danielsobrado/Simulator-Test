import assert from 'node:assert/strict';
import test from 'node:test';

import { shapeCapability } from '../src/editor/workshop/shapes/ShapeRegistry.js';
import { resolveShapeChemistry } from '../src/editor/workshop/shapes/ShapeChemistry.js';
import { buildRegisteredShape } from '../src/editor/workshop/shapes/ShapeGeometryRegistry.js';
import { SHAPE_PRESETS, createShapePreset } from '../src/editor/workshop/shapes/ShapePresets.js';
import { SHAPE_CASTLE_PRESETS } from '../src/editor/workshop/shapes/config/ShapeCastleConfig.generated.js';
import { shapeProfileOut, shapeProfileBreaks } from '../src/editor/workshop/shapes/ShapeProfile.js';
import { shapeOpeningTop } from '../src/editor/workshop/shapes/ShapeOpenings.js';
import { createShapeWallSurface } from '../src/editor/workshop/shapes/ShapeWallSurface.js';
import { normalizeWorkshopComposition } from '../src/editor/workshop/ProceduralWorkshopComposition.js';

const materials = new Proxy({}, { get: (_, key) => key });
const plan = (source) => { const c = shapeCapability(source.kind); return c.plan(c.normalize(source)); };
const tower = (extra = {}) => ({ id: 'tower', kind: 'curved-volume', surface: 'masonry', shutters: false, craft: false,
  height: 10.2, thickness: 0.5, footprint: { family: 'oval', width: 6, depth: 6 }, roof: { family: 'flat' }, ...extra });
const radius = (surface, y, offset) => { const v = surface.point(0, y, offset); return Math.hypot(v[0], v[2]); };

test('castle presets are plain shape data that survive a composition round trip', () => {
  assert.equal(SHAPE_CASTLE_PRESETS.length, 7);
  for (const preset of SHAPE_CASTLE_PRESETS) {
    assert.ok(SHAPE_PRESETS.some((item) => item.id === preset.id));
    const composition = normalizeWorkshopComposition(createShapePreset(preset.id));
    const again = normalizeWorkshopComposition(JSON.parse(JSON.stringify(composition)));
    assert.deepEqual(again, composition);
  }
});

test('a vertical profile moves both wall faces and splits collision at its breaks', () => {
  const p = plan(tower({ base: { style: 'batter', height: 2.04, out: 0.6 }, stages: [{ at: 6.8, out: -0.1 }] }));
  assert.equal(shapeProfileOut(p.primitive, 0), 0.6);
  assert.ok(Math.abs(shapeProfileOut(p.primitive, 1.02) - 0.3) < 1e-9);
  assert.equal(shapeProfileOut(p.primitive, 3), 0);
  assert.equal(shapeProfileOut(p.primitive, 7), -0.1);
  assert.deepEqual(shapeProfileBreaks(p.primitive).map((y) => Math.round(y * 100)), [204, 680]);
  const surface = createShapeWallSurface(p);
  assert.ok(Math.abs(radius(surface, 0, 0.25) - radius(surface, 3, 0.25) - 0.6) < 1e-6);
  assert.ok(Math.abs(radius(surface, 0, -0.25) - radius(surface, 3, -0.25) - 0.6) < 1e-6, 'the hollow interior follows the batter');
  assert.equal(p.rpg.collisionSlabs.length, 3);
  assert.equal(plan(tower()).rpg.collisionSlabs.length, 1, 'a plain shaft keeps its single shell slab');
});

test('a corbelled crown lays out whole corbels, bays and merlons around a closed tower', () => {
  const p = plan(tower({ crown: { style: 'corbelled', projection: 0.5, machicolation: 'open' } }));
  const crown = p.crown;
  assert.equal(crown.base, 10.2);
  assert.equal(crown.corbels.length, crown.bays.length);
  assert.ok(crown.corbels.length >= 20 && crown.merlons.length >= 8);
  assert.equal(crown.drops.length, crown.bays.length, 'open machicolations are recorded as real drops');
  for (const bay of crown.bays) assert.ok(bay.u1 > bay.u0);
  assert.ok(p.rpg.collisionSlabs.some((slab) => slab.id === 'tower:crown'));
  assert.ok(p.rpg.walkableFloors.some((floor) => floor.id === 'tower:crown-deck'));
  assert.equal(plan(tower({ crown: { style: 'parapet' }, roof: { family: 'cone' } })).crown, undefined, 'a flush parapet needs a flat top');
  const roofed = plan(tower({ crown: { style: 'corbelled', height: 1.4 }, roof: { family: 'cone' } })).crown;
  assert.ok(roofed.roofed && roofed.merlons.length === 0 && Math.abs(roofed.wallTop - 10.2) < 1e-9);
});

test('pointed heads and arrow slits share one opening contour', () => {
  const pointed = { profile: 'pointed', bottom: 0, width: 1, height: 2.4 };
  assert.ok(Math.abs(shapeOpeningTop(pointed, 0) - 2.4) < 1e-9);
  assert.ok(Math.abs(shapeOpeningTop(pointed, 0.5) - (2.4 - 0.866)) < 1e-9);
  assert.ok(shapeOpeningTop(pointed, 0.25) > shapeOpeningTop({ ...pointed, profile: 'arched' }, 0.25) - 0.5);
  const p = plan(tower({ openings: [{ id: 'loop', role: 'slit', profile: 'square', at: 0.5, bottom: 3, width: 0.12, height: 1.3 }] }));
  assert.equal(p.rpg.portals.length, 0, 'an arrow slit is not a traversable portal');
});

test('turrets, crowns and joined walls build finite geometry through the shared builders', () => {
  const plans = [
    plan(tower({ base: { style: 'batter', height: 2, out: 0.5 }, crown: { style: 'corbelled' },
      features: [{ id: 'turret-a', kind: 'turret', roof: 'cone', at: 0.125, width: 2, height: 4, bottom: 9.2 },
        { id: 'turret-b', kind: 'turret', roof: 'flat', at: 0.625, width: 2, height: 3, bottom: 9.2 }] })),
    plan({ id: 'wall', kind: 'curved-wall', position: [7, 0], length: 9, bend: 0, height: 5.1, thickness: 1, crown: { style: 'parapet' } }),
  ];
  const { plans: resolved, contacts } = resolveShapeChemistry(plans);
  assert.ok(contacts.some((contact) => contact.ruleId === 'wall-tower-join'));
  const host = resolved[0], turrets = host.features.filter((f) => f.turret);
  assert.equal(turrets.length, 2);
  assert.ok(turrets[0].child.primitive.roof.family === 'cone' && turrets[1].child.crown, 'an open turret carries its own battlement');
  for (const detail of [2, 1]) for (const shape of resolved) {
    const parts = buildRegisteredShape(shape, materials, { seed: 11, detail, ivy: false });
    assert.ok(parts.length > 0);
    for (const part of parts) {
      assert.ok(part.geometry.attributes.position.array.every(Number.isFinite), `${shape.id} ${part.materialRegion.id}`);
      part.geometry.dispose();
    }
  }
});
