import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import {
  authoredCollisionProxyForGeometry,
  extractAuthoredMeshPrototypes,
  releaseAuthoredCollisionProxy,
} from '../src/editor/stylized/StylizedPrototypeBake.js';

test('reserved collider nodes stay out of rendering and share visual grounding', () => {
  const scene = new Group();
  const visual = new Mesh(new BoxGeometry(4, 2, 3), new MeshBasicMaterial());
  visual.name = 'RockHero';
  visual.position.set(10, 3, -7);
  const proxy = new Mesh(new BoxGeometry(3.5, 1.8, 2.5), new MeshBasicMaterial());
  proxy.name = 'COLLIDER_WALKABLE_RockHero';
  proxy.position.copy(visual.position);
  scene.add(visual, proxy);

  const prototypes = extractAuthoredMeshPrototypes(scene, { scale: 2 });
  assert.equal(prototypes.length, 1);
  const authored = authoredCollisionProxyForGeometry(prototypes[0].geometry);
  assert.ok(authored);
  assert.equal(authored.name, proxy.name);

  prototypes[0].geometry.computeBoundingBox();
  authored.geometry.computeBoundingBox();
  assert.ok(Math.abs(prototypes[0].geometry.boundingBox.min.y) < 1e-6);
  assert.ok(Math.abs(authored.geometry.boundingBox.min.y - 0.2) < 1e-6);
  assert.ok(authored.geometry.boundingBox.max.x <= prototypes[0].geometry.boundingBox.max.x);

  assert.equal(releaseAuthoredCollisionProxy(prototypes[0].geometry), true);
  assert.equal(authoredCollisionProxyForGeometry(prototypes[0].geometry), null);
  prototypes[0].geometry.dispose();
  prototypes[0].source.geometry.dispose();
  prototypes[0].source.material.dispose();
  proxy.geometry.dispose();
  proxy.material.dispose();
});
