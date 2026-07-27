import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  GRASS_BLADE_SEGMENTS,
  GRASS_FAR_BLADE_SEGMENTS,
  createClumpGeometry,
} from '../src/editor/stylized/StylizedGrassSlot.js';
import { trianglesPerBlade } from '../src/editor/stylized/grassLodMath.js';

const BLADES_PER_CLUMP = 8;
const INSTANCES = 16;

function sharedAttributes() {
  return {
    instanceBase: new THREE.InstancedBufferAttribute(new Float32Array(INSTANCES * 3), 3),
    instanceParams: new THREE.InstancedBufferAttribute(new Float32Array(INSTANCES * 4), 4),
  };
}

function build(segments, attributes) {
  return createClumpGeometry({
    bladesPerClump: BLADES_PER_CLUMP,
    segments,
    ...attributes,
  });
}

test('each band emits the triangle count its segment budget promises', () => {
  const attributes = sharedAttributes();
  for (const segments of [GRASS_BLADE_SEGMENTS, GRASS_FAR_BLADE_SEGMENTS, 2]) {
    const geometry = build(segments, attributes);
    assert.equal(
      geometry.index.count / 3,
      trianglesPerBlade(segments) * BLADES_PER_CLUMP,
      `segments=${segments} triangle count disagrees with trianglesPerBlade`,
    );
    assert.equal(geometry.attributes.position.count, (segments * 2 + 1) * BLADES_PER_CLUMP);
    for (const name of ['bladeAxis', 'bladeCenter', 'bladeShape', 'bladeWind']) {
      assert.equal(geometry.attributes[name].count, geometry.attributes.position.count);
    }
    // WebGPU allows eight vertex buffers per pipeline. Exceeding it does not
    // degrade — pipeline creation fails and the field disappears — so the packed
    // layout is a correctness constraint, not a memory optimisation.
    assert.ok(Object.keys(geometry.attributes).length <= 8, 'too many vertex buffers');
    // Indices must stay inside the vertex buffer, or the draw reads garbage.
    for (let i = 0; i < geometry.index.count; i += 1) {
      assert.ok(
        geometry.index.array[i] < geometry.attributes.position.count,
        `segments=${segments} index ${i} is out of range`,
      );
    }
  }
});

test('clump geometry preserves upstream per-blade tilt and facing variation', () => {
  const geometry = build(GRASS_BLADE_SEGMENTS, sharedAttributes());
  // bladeAxis packs lean into xy and facing into zw.
  const axis = geometry.getAttribute('bladeAxis');
  const distinctLeans = new Set();
  const distinctFacings = new Set();
  const verticesPerBlade = GRASS_BLADE_SEGMENTS * 2 + 1;
  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    const vertex = blade * verticesPerBlade;
    distinctLeans.add(`${axis.getX(vertex).toFixed(4)}:${axis.getY(vertex).toFixed(4)}`);
    distinctFacings.add(`${axis.getZ(vertex).toFixed(4)}:${axis.getW(vertex).toFixed(4)}`);
  }
  assert.equal(distinctLeans.size, BLADES_PER_CLUMP);
  assert.equal(distinctFacings.size, BLADES_PER_CLUMP);
});

test('every blade in a clump carries its own colour roll', () => {
  // A clump is one instance, so the patch noise the shader samples per clump is
  // constant across its blades. Without these rolls the whole clump is one
  // colour and raising bladesPerCell adds density without adding variety.
  const geometry = build(GRASS_BLADE_SEGMENTS, sharedAttributes());
  // bladeShape packs the two colour rolls into xy and the profile arc into zw.
  const tint = geometry.getAttribute('bladeShape');
  const verticesPerBlade = GRASS_BLADE_SEGMENTS * 2 + 1;
  const distinctTints = new Set();
  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    const vertex = blade * verticesPerBlade;
    distinctTints.add(`${tint.getX(vertex)}:${tint.getY(vertex)}`);
    // The roll is per blade, not per vertex: a blade shading from one colour at
    // its base to another at its tip would read as a gradient, not as a blade.
    for (let offset = 1; offset < verticesPerBlade; offset += 1) {
      assert.equal(tint.getX(vertex + offset), tint.getX(vertex));
      assert.equal(tint.getY(vertex + offset), tint.getY(vertex));
    }
  }
  assert.equal(distinctTints.size, BLADES_PER_CLUMP);
});

test('blades wear the authored silhouettes from the pool they are given', () => {
  const arched = { id: 'arched', halfWidth: [0.2, 1, 0.5, 0.1], curve: [0, -0.04, -0.08, -0.15] };
  const straight = { id: 'straight', halfWidth: [1, 0.6, 0.3, 0.1], curve: [0, 0, 0, 0] };
  const geometry = createClumpGeometry({
    bladesPerClump: BLADES_PER_CLUMP,
    segments: GRASS_BLADE_SEGMENTS,
    profiles: [arched, straight],
    ...sharedAttributes(),
  });
  const position = geometry.getAttribute('position');
  const shape = geometry.getAttribute('bladeShape');
  const verticesPerBlade = GRASS_BLADE_SEGMENTS * 2 + 1;
  const widths = [];
  let arcedBlades = 0;
  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    const vertex = blade * verticesPerBlade;
    // Half-width at the base row, in the blade's own frame.
    const dx = position.getX(vertex + 1) - position.getX(vertex);
    const dz = position.getZ(vertex + 1) - position.getZ(vertex);
    widths.push(Math.hypot(dx, dz) / 2);
    const tip = vertex + verticesPerBlade - 1;
    if (Math.hypot(shape.getZ(tip), shape.getW(tip)) > 1e-6) arcedBlades += 1;
  }
  // Two shapes in the pool means two distinct base widths across the clump. One
  // shape per clump would make the batching unit visible as patches of one outline.
  assert.equal(new Set(widths.map((w) => w.toFixed(4))).size, 2);
  assert.ok(arcedBlades > 0 && arcedBlades < BLADES_PER_CLUMP, 'only the arched profile should curve');
});

test('the arc is a per-vertex attribute, not baked into position', () => {
  // Local XZ is in blade widths and the shader scales it by the instance width,
  // but the arc is in blade lengths. Folding it into `position` would make a
  // blade's bend scale with how wide it is instead of how long.
  const arched = { id: 'arched', halfWidth: [1, 1, 1, 1], curve: [0, 0.05, 0.1, 0.2] };
  const geometry = createClumpGeometry({
    bladesPerClump: 1,
    segments: GRASS_BLADE_SEGMENTS,
    profiles: [arched],
    ...sharedAttributes(),
  });
  const position = geometry.getAttribute('position');
  const shape = geometry.getAttribute('bladeShape');
  const centreAtBase = [position.getX(0) + position.getX(1), position.getZ(0) + position.getZ(1)]
    .map((sum) => sum / 2);
  const tip = GRASS_BLADE_SEGMENTS * 2;
  assert.ok(Math.abs(position.getX(tip) - centreAtBase[0]) < 1e-6);
  assert.ok(Math.abs(position.getZ(tip) - centreAtBase[1]) < 1e-6);
  // ...and it is the attribute that carries the drift, growing toward the tip.
  assert.ok(
    Math.hypot(shape.getZ(tip), shape.getW(tip)) > Math.hypot(shape.getZ(0), shape.getW(0)),
  );
});

test('position carries only the blade half-width, not the clump layout', () => {
  // These are separate channels precisely so blade width and clump footprint can
  // be tuned apart: `position` is in blade-widths and the shader scales it by the
  // instance width, while `bladeCenter.xy` is in metres and is not scaled at all.
  // Baking the clump offset back into `position` would make narrowing the blades
  // shrink every clump and break the field into tufts.
  const clumpRadius = 0.75;
  const geometry = createClumpGeometry({
    bladesPerClump: BLADES_PER_CLUMP,
    segments: GRASS_BLADE_SEGMENTS,
    clumpRadius,
    ...sharedAttributes(),
  });
  const position = geometry.getAttribute('position');
  const centre = geometry.getAttribute('bladeCenter');
  const verticesPerBlade = GRASS_BLADE_SEGMENTS * 2 + 1;
  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    const vertex = blade * verticesPerBlade;
    // Every blade's own strip is centred on its origin — half-width either side.
    assert.ok(Math.abs(position.getX(vertex) + position.getX(vertex + 1)) < 1e-6);
    assert.ok(Math.abs(position.getZ(vertex) + position.getZ(vertex + 1)) < 1e-6);
    // Half-widths are in blade-widths, so they stay small regardless of the
    // clump radius the layout was built at.
    assert.ok(Math.hypot(position.getX(vertex), position.getZ(vertex)) <= 0.5 + 1e-6);
    // ...and the clump layout is in metres, bounded by the radius it was given.
    assert.ok(Math.hypot(centre.getX(vertex), centre.getY(vertex)) <= clumpRadius + 1e-6);
  }
  // A different radius moves the layout and leaves the silhouette untouched.
  const wide = createClumpGeometry({
    bladesPerClump: BLADES_PER_CLUMP,
    segments: GRASS_BLADE_SEGMENTS,
    clumpRadius: clumpRadius * 2,
    ...sharedAttributes(),
  });
  assert.deepEqual(
    Array.from(wide.getAttribute('position').array),
    Array.from(position.array),
  );
  assert.ok(
    Math.abs(wide.getAttribute('bladeCenter').getX(0) - centre.getX(0) * 2) < 1e-6,
  );
});

test('every blade carries its own width and wind rolls', () => {
  // Same reason as the colour rolls: a clump is one instance, so without per-blade
  // values all 96 of its blades are one gauge moving on one phase, and the hidden
  // batching unit becomes visible.
  const geometry = build(GRASS_BLADE_SEGMENTS, sharedAttributes());
  const centre = geometry.getAttribute('bladeCenter');
  const wind = geometry.getAttribute('bladeWind');
  const verticesPerBlade = GRASS_BLADE_SEGMENTS * 2 + 1;
  const widths = new Set();
  const winds = new Set();
  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    const vertex = blade * verticesPerBlade;
    widths.add(centre.getW(vertex));
    winds.add(`${wind.getX(vertex)}:${wind.getY(vertex)}:${wind.getZ(vertex)}`);
    // Per blade, not per vertex — a blade whose width roll changed up its length
    // would taper for the wrong reason.
    for (let offset = 1; offset < verticesPerBlade; offset += 1) {
      assert.equal(centre.getW(vertex + offset), centre.getW(vertex));
      assert.equal(wind.getX(vertex + offset), wind.getX(vertex));
    }
  }
  assert.equal(widths.size, BLADES_PER_CLUMP);
  assert.equal(winds.size, BLADES_PER_CLUMP);
});

test('the far band is a fifth of the near band per clump', () => {
  const attributes = sharedAttributes();
  const near = build(GRASS_BLADE_SEGMENTS, attributes);
  const far = build(GRASS_FAR_BLADE_SEGMENTS, attributes);
  assert.equal(near.index.count / far.index.count, 5);
});

test('both bands share one set of instance buffers', () => {
  // This is what makes a second band affordable: at ~24k instances per chunk the
  // instance data dwarfs the blade mesh, so duplicating it would cost more than
  // the cheaper blades save.
  const attributes = sharedAttributes();
  const near = build(GRASS_BLADE_SEGMENTS, attributes);
  const far = build(GRASS_FAR_BLADE_SEGMENTS, attributes);
  for (const name of ['instanceBase', 'instanceParams']) {
    assert.equal(near.getAttribute(name), far.getAttribute(name), `${name} is not shared`);
    assert.equal(near.getAttribute(name).array, far.getAttribute(name).array);
  }
  // Writing scatter through one band is visible from the other, so a band switch
  // never needs a rebuild.
  near.getAttribute('instanceBase').array[0] = 42;
  assert.equal(far.getAttribute('instanceBase').array[0], 42);
  // Vertex data, by contrast, must differ — that is the whole point.
  assert.notEqual(near.getAttribute('position'), far.getAttribute('position'));
});

test('a single-segment blade is one upright triangle rooted on the ground', () => {
  const geometry = build(1, sharedAttributes());
  const position = geometry.getAttribute('position');
  const tips = [];
  let bases = 0;
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    if (y === 0) bases += 1;
    else tips.push(y);
  }
  assert.equal(tips.length, BLADES_PER_CLUMP, 'every blade needs exactly one tip vertex');
  assert.equal(bases, BLADES_PER_CLUMP * 2, 'every blade needs a two-vertex base');
  // Geometry stays normalized so every blade reaches the full colour/wind mask.
  // Independent physical lengths come from the separate random-phase attribute.
  assert.deepEqual(new Set(tips), new Set([1]));
  // bladeCenter packs the clump offset into xy and the length phase into z.
  const centre = geometry.getAttribute('bladeCenter');
  const distinctLengths = new Set();
  const verticesPerBlade = 3;
  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    distinctLengths.add(centre.getZ(blade * verticesPerBlade));
  }
  assert.equal(distinctLengths.size, BLADES_PER_CLUMP);
});

test('clump blades fill the disc evenly instead of forming rings', () => {
  // The old layout put every blade on one of three radii, which reads as
  // concentric rings once a clump carries a few dozen blades. The layout lives in
  // `bladeCenter` now — `position` holds only each blade's own half-width.
  const geometry = build(1, sharedAttributes());
  const centre = geometry.getAttribute('bladeCenter');
  const verticesPerBlade = 3;
  const radii = new Set();
  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    const vertex = blade * verticesPerBlade;
    radii.add(Math.hypot(centre.getX(vertex), centre.getY(vertex)).toFixed(3));
  }
  assert.equal(radii.size, BLADES_PER_CLUMP, 'every blade should sit at its own radius');
});
