import assert from 'node:assert/strict';
import test from 'node:test';

import { createRig } from '../src/editor/character/characterBones.js';
import { createAnatomy } from '../src/editor/character/geometry/drowAnatomy.js';
import { buildDrowBody } from '../src/editor/character/geometry/buildDrowBody.js';
import { buildDrowFur } from '../src/editor/character/geometry/buildDrowFur.js';
import { buildClothGeometry } from '../src/editor/character/geometry/buildClothGeometry.js';
import { makeDrowPanels } from '../src/editor/character/cloth/drowGarments.js';
import { CharacterTransformTexture } from '../src/editor/character/CharacterTransformTexture.js';
import { M_EYE, M_SKIN, MATERIAL_SLOT_COUNT } from '../src/editor/character/materialSlots.js';

/**
 * WebGPU allows eight vertex attributes per pipeline and does not degrade past
 * it — the mesh silently fails to draw. See the note in `GeometryBuilder`.
 */
const ATTRIBUTE_CEILING = 8;

/** What the perf budget was measured against; a regression guard, not a law. */
const TRIANGLE_BUDGET = 30000;

function buildAll() {
  const rig = createRig();
  const anatomy = createAnatomy(rig);
  const panels = makeDrowPanels(rig, anatomy);
  const transforms = new CharacterTransformTexture(panels);
  return {
    rig,
    anatomy,
    panels,
    transforms,
    body: buildDrowBody(rig, anatomy),
    fur: buildDrowFur(rig, anatomy),
    cloth: buildClothGeometry(panels),
  };
}

test('no mesh exceeds the WebGPU vertex attribute ceiling', () => {
  const { body, fur, cloth } = buildAll();
  for (const [name, geometry] of [['body', body], ['fur', fur], ['cloth', cloth]]) {
    const count = Object.keys(geometry.attributes).length;
    assert.ok(
      count <= ATTRIBUTE_CEILING,
      `${name} uses ${count} attributes; past ${ATTRIBUTE_CEILING} the mesh vanishes`,
    );
  }
});

test('the character stays inside its triangle budget', () => {
  const { body, fur, cloth } = buildAll();
  const total = [body, fur, cloth]
    .reduce((sum, g) => sum + g.userData.characterStats.triangles, 0);
  assert.ok(total > 0);
  assert.ok(total < TRIANGLE_BUDGET, `character is ${total} triangles`);
});

test('nothing in any mesh is non-finite', () => {
  const { body, fur, cloth } = buildAll();
  for (const [name, geometry] of [['body', body], ['fur', fur], ['cloth', cloth]]) {
    for (const [attribute, buffer] of Object.entries(geometry.attributes)) {
      for (const value of buffer.array) {
        assert.ok(
          Number.isFinite(value),
          `${name}.${attribute} contains a non-finite value`,
        );
      }
    }
  }
});

test('every index addresses a real vertex', () => {
  const { body, fur, cloth } = buildAll();
  for (const [name, geometry] of [['body', body], ['fur', fur], ['cloth', cloth]]) {
    const vertices = geometry.attributes.position.count;
    for (const index of geometry.index.array) {
      assert.ok(index < vertices, `${name} index ${index} is past ${vertices} vertices`);
    }
  }
});

test('the boot sole sits at y = 0 in the bind pose', () => {
  // `CharacterFigure.SOLE_SINK` is a plain offset from the ground rather than a
  // fudge factor precisely because of this. If the boot moves, the drow either
  // hovers or sinks.
  const { body } = buildAll();
  const position = body.attributes.position.array;
  let lowest = Infinity;
  for (let i = 1; i < position.length; i += 3) lowest = Math.min(lowest, position[i]);
  assert.ok(Math.abs(lowest) < 0.02, `lowest bind-pose point was ${lowest}`);
});

test('the drow is taller than the human figure it was ported from', () => {
  const { body } = buildAll();
  const position = body.attributes.position.array;
  let highest = -Infinity;
  for (let i = 1; i < position.length; i += 3) highest = Math.max(highest, position[i]);
  assert.ok(highest > 1.79, `the drow tops out at ${highest.toFixed(3)} m`);
  assert.ok(highest < 2.0, `the drow tops out at ${highest.toFixed(3)} m, which is a giant`);
});

test('every material slot on the body is a real slot', () => {
  const { body } = buildAll();
  const aux = body.attributes.aux.array;
  const seen = new Set();
  for (let i = 0; i < aux.length; i += 2) {
    const slot = aux[i];
    assert.ok(Number.isInteger(slot), `slot ${slot} is not an integer`);
    assert.ok(slot >= 0 && slot < MATERIAL_SLOT_COUNT, `slot ${slot} is out of range`);
    seen.add(slot);
  }
  assert.ok(seen.has(M_SKIN), 'the drow needs skin');
  assert.ok(seen.has(M_EYE), 'the drow needs eyes — they are the whole read in the cowl');
});

test('the eyes sit above the scarf and in front of the skull', () => {
  const { body, anatomy } = buildAll();
  const position = body.attributes.position.array;
  const aux = body.attributes.aux.array;
  const scarfTop = anatomy.scarf.ys[2];
  let count = 0;
  let leftmost = Infinity;
  let rightmost = -Infinity;
  for (let v = 0; v < aux.length / 2; v++) {
    if (aux[v * 2] !== M_EYE) continue;
    count += 1;
    const y = position[v * 3 + 1];
    const z = position[v * 3 + 2];
    assert.ok(y > scarfTop, `an eye vertex at y=${y} is behind the scarf (${scarfTop})`);
    assert.ok(z > anatomy.head.centre[2], 'an eye vertex is on the back of the head');
    leftmost = Math.min(leftmost, position[v * 3]);
    rightmost = Math.max(rightmost, position[v * 3]);
  }
  assert.equal(count, 18, 'two eyes, nine vertices each');
  // Symmetric about the centre line.
  assert.ok(Math.abs(leftmost + rightmost) < 1e-6, 'the eyes are not symmetric');
});

test('the ears rise above the skull and stand clear of it', () => {
  const { body, anatomy } = buildAll();
  const position = body.attributes.position.array;
  const aux = body.attributes.aux.array;
  const { centre, radii } = anatomy.head;
  let widest = 0;
  let highestSkinY = -Infinity;
  for (let v = 0; v < aux.length / 2; v++) {
    if (aux[v * 2] !== M_SKIN) continue;
    widest = Math.max(widest, Math.abs(position[v * 3]));
    highestSkinY = Math.max(highestSkinY, position[v * 3 + 1]);
  }
  // Ears reach well outside the skull's own half-width and above its crown.
  assert.ok(widest > radii[0] * 1.5, `skin only reaches ${widest} across`);
  assert.ok(highestSkinY > centre[1] + radii[1], 'nothing rises above the crown');
});

test('the transform texture has room for every panel', () => {
  const { transforms, panels } = buildAll();
  assert.ok(transforms.usedRows <= 64);
  const rows = panels.map((p) => p.nodeRow);
  // Bone matrices own rows 0-3; no panel may start inside them or overlap another.
  for (let i = 0; i < panels.length; i++) {
    assert.ok(rows[i] >= 4, `${panels[i].name} would overwrite the bone matrices`);
    if (i > 0) {
      assert.equal(rows[i], rows[i - 1] + panels[i - 1].rows, 'panel rows must be packed');
    }
  }
});

test('the cloth mesh refuses to build before the texture rows are assigned', () => {
  const rig = createRig();
  const anatomy = createAnatomy(rig);
  const panels = makeDrowPanels(rig, anatomy);
  // No CharacterTransformTexture, so nodeRow is still 0 — which is the bone
  // matrices, and would render every garment as a smear of skinning data.
  assert.throws(() => buildClothGeometry(panels), /transform-texture row/);
});
