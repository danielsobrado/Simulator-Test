import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createInstancedRenderers, writeInstances } from '../src/editor/stylized/lod/StylizedLodRuntime.js';

/**
 * WebGPU guarantees only 8 vertex buffers per pipeline, and three's WebGPU backend spends
 * one per non-interleaved attribute plus one for the instance matrix. Going over does not
 * degrade gracefully — CreateRenderPipeline fails and the mesh disappears entirely, which
 * is easy to miss because the console error looks like a warning.
 *
 * A tree leaf is the worst case: it carries morphology and a leaf tint on top of the base
 * mesh attributes, so it is the part that pins the budget.
 */
const WEBGPU_MAX_VERTEX_BUFFERS = 8;

function sourcePart(kind) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  geometry.setIndex([0, 1, 2]);
  return { kind, geometry, material: new THREE.MeshLambertNodeMaterial() };
}

function vertexBufferCount(mesh) {
  // One buffer per attribute, plus the instance matrix that InstancedMesh binds separately.
  return Object.keys(mesh.geometry.attributes).length + 1;
}

test('tree leaf instancing stays inside the WebGPU vertex buffer budget', () => {
  const root = new THREE.Group();
  const renderers = createInstancedRenderers({
    root,
    partsByPrototype: [[sourcePart('leaf'), sourcePart('trunk')]],
    capacity: 4,
    name: 'budget',
    castShadow: true,
    tintLeaves: true,
  });

  for (const parts of renderers) {
    for (const mesh of parts) {
      const count = vertexBufferCount(mesh);
      assert.ok(
        count <= WEBGPU_MAX_VERTEX_BUFFERS,
        `${mesh.name} binds ${count} vertex buffers (limit ${WEBGPU_MAX_VERTEX_BUFFERS}): `
        + `${Object.keys(mesh.geometry.attributes).join(', ')} + instanceMatrix. `
        + 'Pack per-instance scalars into an existing vector attribute instead of adding one.',
      );
    }
  }
});

test('packed dither attribute carries fade, seed and colour variation', () => {
  const root = new THREE.Group();
  const renderers = createInstancedRenderers({
    root,
    partsByPrototype: [[sourcePart('leaf')]],
    capacity: 4,
    name: 'dither',
    castShadow: false,
    tintLeaves: true,
  });
  const mesh = renderers[0][0];

  // Colour variation is a multiplier, so unwritten instances must default to 1 rather
  // than zeroing the albedo of anything that is allocated but not yet populated.
  const initial = mesh.geometry.getAttribute('instanceDither');
  assert.equal(initial.array[2], 1);
  assert.equal(initial.array[5], 1);

  writeInstances([[mesh]], [[{
    matrix: new THREE.Matrix4(),
    fade: 0.5,
    ditherDirection: -1,
    seed: 0.25,
    colorVariation: 0.75,
    leafTint: [1, 1, 1],
    morphology: [1, 1, 1],
  }]]);

  const dither = mesh.geometry.getAttribute('instanceDither');
  assert.equal(dither.itemSize, 3);
  assert.equal(dither.array[0], -0.5, 'x carries the signed LOD fade');
  assert.equal(dither.array[1], 0.25, 'y carries the stable dither seed');
  assert.equal(dither.array[2], 0.75, 'z carries the colour variation');
});
