import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { ProceduralAssetManager } from '../src/editor/workshop/ProceduralAssetManager.js';
import {
  createProceduralAssetRecord,
  normalizeProceduralRecipe,
} from '../src/editor/workshop/ProceduralAssetStore.js';
import { WORKSHOP_VARIANT_ARCHETYPES } from '../src/editor/workshop/ProceduralWorkshopArchetypeCatalog.js';
import { createProceduralMedievalParts } from '../src/editor/workshop/ProceduralMedievalGenerator.js';
import { createProceduralWorkshopComponentParts } from '../src/editor/workshop/ProceduralWorkshopComponentParts.js';
import { createRoofSurface } from '../src/editor/workshop/village/HouseRoofSurface.js';

function variants() {
  return Object.entries(WORKSHOP_VARIANT_ARCHETYPES).flatMap(([archetype, entry]) => (
    entry.variants.map((variant) => ({ archetype, variant }))
  ));
}

function recipeFor(archetype, variant, overrides = {}) {
  const { label: _label, ...defaults } = variant.defaults;
  return { archetype, variant: variant.id, ...defaults, detail: 1, ...overrides };
}

function slot(part) {
  return part.material.userData.workshopSlot;
}

function worldBounds(parts) {
  const bounds = new THREE.Box3().makeEmpty();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrix));
  }
  return bounds;
}

function semanticParts(parts, id) {
  return parts.filter((part) => part.geometry.userData.workshopSemantic?.id === id);
}

test('variant archetypes normalize a default design and reject unknown ones', () => {
  assert.equal(normalizeProceduralRecipe({ archetype: 'house' }).variant, 'cottage');
  assert.equal(normalizeProceduralRecipe({ archetype: 'prop' }).variant, 'lantern-post');
  assert.throws(() => normalizeProceduralRecipe({ archetype: 'house', variant: 'castle' }), /Unknown house variant/);
  assert.throws(() => normalizeProceduralRecipe({ archetype: 'manor', variant: 'cottage' }), /has no variants/);
});

test('original archetypes keep their canonical form without a variant field', () => {
  for (const archetype of ['wall', 'gatehouse', 'tower', 'square-tower', 'manor']) {
    assert.equal(Object.hasOwn(normalizeProceduralRecipe({ archetype }), 'variant'), false, archetype);
  }
});

test('every house and prop design generates finite, fully tagged geometry', () => {
  for (const { archetype, variant } of variants()) {
    const parts = createProceduralMedievalParts({ ...recipeFor(archetype, variant), remesh: false });
    try {
      assert.ok(parts.length > 0, `${variant.id} generated nothing`);
      for (const part of parts) {
        const position = part.geometry.getAttribute('position');
        assert.ok(position.array.every(Number.isFinite), `${variant.id} has a non-finite vertex`);
        assert.ok(part.geometry.getAttribute('normal') && part.geometry.getAttribute('uv'), `${variant.id} lacks normals or uvs`);
        // Untagged wood is inferred to be a door by shape, which misfires on framing.
        assert.ok(part.geometry.userData.workshopSemantic, `${variant.id} emitted an untagged ${slot(part)} part`);
      }
    } finally {
      disposeModelParts(parts);
    }
  }
});

test('every house and prop design survives the component pipeline at every detail', () => {
  for (const { archetype, variant } of variants()) {
    for (const detail of [1, 2, 3]) {
      const parts = createProceduralWorkshopComponentParts(recipeFor(archetype, variant, { detail }));
      try {
        assert.ok(parts.components.some(({ id }) => id === 'structure-main'), `${variant.id} has no main structure`);
      } finally {
        disposeModelParts(parts);
      }
    }
  }
});

test('house generation is deterministic per seed', () => {
  const signature = (seed) => {
    const parts = createProceduralMedievalParts({ archetype: 'house', variant: 'tavern', seed, detail: 2, remesh: true });
    try {
      return parts.map((part) => {
        const array = part.geometry.getAttribute('position').array;
        let sum = 0;
        for (let index = 0; index < array.length; index += 7) sum += array[index] * ((index % 13) + 1);
        return sum.toFixed(3);
      }).join('|');
    } finally {
      disposeModelParts(parts);
    }
  };
  assert.equal(signature(42), signature(42));
  assert.notEqual(signature(42), signature(43));
});

test('a stone storey leaves a real void behind its door', () => {
  const parts = createProceduralMedievalParts({ archetype: 'house', variant: 'tavern', detail: 2, remesh: false });
  try {
    const door = worldBounds(semanticParts(parts, 'door-1').filter((part) => slot(part) === 'wood'));
    assert.ok(!door.isEmpty(), 'tavern has no main door');
    const blocking = parts.filter((part) => {
      if (slot(part) !== 'stone') return false;
      const centre = worldBounds([part]).getCenter(new THREE.Vector3());
      return centre.x > door.min.x + 0.12 && centre.x < door.max.x - 0.12
        && centre.y > 0.3 && centre.y < door.max.y - 0.35
        && Math.abs(centre.z - (door.min.z + door.max.z) / 2) < 0.5;
    });
    assert.equal(blocking.length, 0, 'masonry obstructs the door opening');
  } finally {
    disposeModelParts(parts);
  }
});

test('an edited house window regenerates at its new facade position', () => {
  const windowCentre = (componentTransforms) => {
    const parts = createProceduralMedievalParts({
      archetype: 'house',
      variant: 'tavern',
      detail: 1,
      remesh: false,
      componentTransforms,
    });
    try {
      const glass = semanticParts(parts, 'window-1').filter((part) => slot(part) === 'recess');
      assert.ok(glass.length > 0, 'window-1 has no glazing');
      return worldBounds(glass).getCenter(new THREE.Vector3());
    } finally {
      disposeModelParts(parts);
    }
  };
  const before = windowCentre({});
  const after = windowCentre({ 'window-1': { position: [0.5, 0.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  assert.ok(Math.abs(after.x - before.x - 0.5) < 0.02, `moved ${after.x - before.x} along the facade`);
  assert.ok(Math.abs(after.y - before.y - 0.2) < 0.02, `moved ${after.y - before.y} up the facade`);
});

test('every wall of a house storey is an editable host with its own openings', () => {
  const parts = createProceduralWorkshopComponentParts({ archetype: 'house', variant: 'tavern', detail: 1 });
  try {
    const components = new Map(parts.components.map((component) => [component.id, component]));
    for (const side of ['back', 'left', 'right']) {
      const wall = components.get(`structure-main-${side}`);
      assert.ok(wall, `ground storey has no ${side} wall host`);
      assert.equal(wall.parentId, 'structure-main');
      assert.equal(wall.attachmentSurface.type, 'planar');
      assert.ok(
        parts.components.some((component) => component.kind === 'window' && component.parentId === wall.id),
        `${side} wall has no window of its own`,
      );
    }
  } finally {
    disposeModelParts(parts);
  }
});

test('a side-wall window moves along its own wall', () => {
  const rightWindow = () => {
    const parts = createProceduralMedievalParts({ archetype: 'house', variant: 'tavern', detail: 1, remesh: false });
    try {
      const hint = parts.map((part) => part.geometry.userData.workshopSemantic)
        .find((semantic) => semantic?.kind === 'window' && semantic.hostId === 'structure-main-right');
      assert.ok(hint, 'the right wall has no window');
      return hint.id;
    } finally {
      disposeModelParts(parts);
    }
  };
  const id = rightWindow();
  const centre = (componentTransforms) => {
    const parts = createProceduralMedievalParts({ archetype: 'house', variant: 'tavern', detail: 1, remesh: false, componentTransforms });
    try {
      return worldBounds(semanticParts(parts, id).filter((part) => slot(part) === 'recess')).getCenter(new THREE.Vector3());
    } finally {
      disposeModelParts(parts);
    }
  };
  const before = centre({});
  const after = centre({ [id]: { position: [0.4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  // The right facade runs from +z toward −z, so "along the wall" is world −z.
  assert.ok(Math.abs(after.z - before.z + 0.4) < 0.02, `moved ${after.z - before.z} in z`);
  assert.ok(Math.abs(after.x - before.x) < 0.02, `drifted ${after.x - before.x} out of the wall`);
});

test('facade frames do not displace geometry at rest', () => {
  const recipe = { archetype: 'house', variant: 'tavern', detail: 1 };
  const raw = createProceduralMedievalParts({ ...recipe, remesh: true });
  const baked = createProceduralWorkshopComponentParts(recipe);
  try {
    const a = worldBounds(raw);
    const b = worldBounds(baked);
    for (const key of ['min', 'max']) {
      assert.ok(a[key].distanceTo(b[key]) < 1e-3, `${key} moved by ${a[key].distanceTo(b[key])}`);
    }
  } finally {
    disposeModelParts(raw);
    disposeModelParts(baked);
  }
});

test('lanterns glaze with the emissive glow family', () => {
  const parts = createProceduralMedievalParts({ archetype: 'prop', variant: 'lantern-post', detail: 1 });
  try {
    const glow = parts.find((part) => slot(part) === 'glow');
    assert.ok(glow, 'lantern has no glow part');
    assert.ok(glow.material.emissiveIntensity > 1);
  } finally {
    disposeModelParts(parts);
  }
});

test('prop footprints come from their geometry, not the recipe width', () => {
  const objectMap = { definitionByKey: new Map(), registerDefinition(definition) { this.definitionByKey.set(definition.key, definition); } };
  const objectView = {
    definitionByKey: new Map(),
    renderers: new Map(),
    parts: null,
    registerDefinition(definition, parts) {
      this.definitionByKey.set(definition.key, definition);
      this.parts = parts;
    },
  };
  const manager = new ProceduralAssetManager({ tileSize: 2, objectMap, objectView, ui: { setProceduralObjectDefinitions() {} } });
  const record = createProceduralAssetRecord({
    label: 'Barrels',
    recipe: { archetype: 'prop', variant: 'barrels', width: 12, depth: 6, detail: 1 },
  });
  try {
    const definition = manager.install(record);
    assert.ok(definition.footprint.width <= 2, `footprint width ${definition.footprint.width}`);
    assert.ok(definition.footprint.depth <= 2, `footprint depth ${definition.footprint.depth}`);
    assert.equal(definition.icon, '🛢️');
  } finally {
    disposeModelParts(objectView.parts ?? []);
  }
});

test('roof surface meets the wall top at the wall line and the ridge at its crown', () => {
  const surface = createRoofSurface({ x0: -4, x1: 4, z0: -3, z1: 3, wallTop: 5, rise: 2.5, overhang: 0.4, sweep: 0.6 });
  assert.ok(Math.abs(surface.height(surface.wallRatio) - 5) < 1e-9);
  assert.ok(Math.abs(surface.height(0) - 7.5) < 1e-9);
  // Bell-cast: steeper than a straight pitch under the ridge, so it runs below
  // the straight chord there, and kicks out flatter past the wall at the eaves.
  const straight = createRoofSurface({ x0: -4, x1: 4, z0: -3, z1: 3, wallTop: 5, rise: 2.5, overhang: 0.4 });
  assert.ok(surface.height(1) > straight.height(1));
  assert.ok(surface.height(0.3) < straight.height(0.3));
});

test('roof surface sags toward the middle and hips toward its ends', () => {
  const sagging = createRoofSurface({ x0: -5, x1: 5, z0: -3, z1: 3, wallTop: 4, rise: 3, sag: 0.4 });
  assert.ok(sagging.ridgeHeight(0) < sagging.ridgeHeight(sagging.halfLength) - 0.35);
  const hipped = createRoofSurface({ x0: -5, x1: 5, z0: -3, z1: 3, wallTop: 4, rise: 3, overhang: 0.3, hip: 1 });
  assert.ok(hipped.ridgeHalf < hipped.halfLength);
  assert.ok(hipped.heightAt(hipped.halfLength - 0.05, 0) < hipped.heightAt(0, 0) - 2);
  assert.equal(hipped.heightAt(0, 10), null);
});

test('a log-built house raises its timber storeys in logs and boards its gables', () => {
  const variant = WORKSHOP_VARIANT_ARCHETYPES.house.variants.find((entry) => entry.id === 'cottage');
  const slotTriangles = (name, overrides) => {
    const parts = createProceduralMedievalParts(recipeFor('house', variant, overrides));
    try {
      return parts.filter((part) => slot(part) === name)
        .reduce((sum, part) => sum + (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3, 0);
    } finally {
      disposeModelParts(parts);
    }
  };
  assert.equal(normalizeProceduralRecipe({ archetype: 'house', walls: 'logs' }).walls, 'logs');
  assert.throws(() => normalizeProceduralRecipe({ archetype: 'house', walls: 'wattle' }), /wall build/);
  // The plastered upper storeys and gables are gone; logs and boards stand in their place.
  assert.ok(slotTriangles('mortar', { walls: 'logs' }) < slotTriangles('mortar', {}) * 0.5, 'plaster replaced');
  assert.ok(slotTriangles('wood', { walls: 'logs' }) >= slotTriangles('wood', {}), 'logs at least replace the framing');
});
