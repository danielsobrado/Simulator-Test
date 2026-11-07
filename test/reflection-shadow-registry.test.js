import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectionalLight, Group, PointLight, Scene } from 'three/webgpu';
import { ReflectionShadowRegistry } from '../src/render/reflections/ReflectionShadowRegistry.js';
import { withReflectionCapture } from '../src/render/reflections/ReflectionCapture.js';

test('reflection shadow discovery follows nested additions, reparenting and shadow replacement', () => {
  const scene = new Scene(), group = new Group(), other = new Group(), sun = new DirectionalLight();
  group.add(sun); scene.add(group, other);
  const registry = new ReflectionShadowRegistry(scene);
  try {
    assert.ok(registry.owners.has(sun));
    const subtree = new Group(), lantern = new PointLight(); subtree.add(lantern); group.add(subtree);
    assert.ok(registry.owners.has(lantern), 'existing group discovers newly attached lights');
    other.add(subtree);
    assert.ok(registry.owners.has(lantern), 'reparented attached subtree remains tracked');
    subtree.removeFromParent();
    assert.ok(!registry.owners.has(lantern));
    assert.ok(!registry.objects.has(lantern));
    group.add(subtree);
    const previous = sun.shadow;
    sun.shadow = { autoUpdate: true, needsUpdate: false };
    let target = null, mrt = 'main';
    const renderer = { autoClear: false, getRenderTarget: () => target, setRenderTarget: value => { target = value; },
      getMRT: () => mrt, setMRT: value => { mrt = value; } };
    const scratch = { states: [], shadows: [], shadowOwners: registry.owners };
    const traverse = scene.traverse;
    scene.traverse = () => assert.fail('warm capture must not search the scene');
    try {
      for (let face = 0; face < 7; face++) withReflectionCapture(renderer, scene, [], () => {
        assert.equal(sun.shadow.autoUpdate, false);
        assert.equal(lantern.shadow.autoUpdate, false);
      }, scratch);
    } finally { scene.traverse = traverse; }
    assert.deepEqual(sun.shadow, { autoUpdate: true, needsUpdate: false });
    assert.equal(previous.autoUpdate, true, 'replaced shadow is untouched');
    assert.equal(scratch.shadows.length, 0);
    registry.dispose();
    for (const object of [scene, group, other, subtree, sun, lantern]) {
      assert.ok(!object.hasEventListener('childadded', registry.added));
      assert.ok(!object.hasEventListener('childremoved', registry.removed));
    }
    group.add(new PointLight());
    assert.equal(registry.objects.size, 0);
    assert.equal(registry.owners.size, 0);
  } finally { registry.dispose(); }
});

test('reflection failure restores current shadows and renderer state even if target restoration throws', () => {
  const scene = new Scene(), sun = new DirectionalLight(), hidden = new Group(); scene.add(sun, hidden);
  sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
  const registry = new ReflectionShadowRegistry(scene);
  let target = 'main', mrt = 'gbuffer', failRestore = false;
  const renderer = { autoClear: false, getRenderTarget: () => target,
    getActiveCubeFace: () => 3, getActiveMipmapLevel: () => 2,
    setRenderTarget(value, face, mip) {
      assert.deepEqual([value, face, mip], ['main', 3, 2]);
      target = value;
      if (failRestore) throw new Error('target restore');
    },
    getMRT: () => mrt, setMRT: value => { mrt = value; } };
  const scratch = { states: [], shadows: [], shadowOwners: registry.owners };
  try {
    assert.throws(() => withReflectionCapture(renderer, scene, [hidden], () => {
      assert.equal(sun.shadow.needsUpdate, false);
      assert.equal(hidden.visible, false); target = 'capture'; throw new Error('render');
    }, scratch), /render/);
    assert.equal(mrt, 'gbuffer'); assert.equal(target, 'main');
    failRestore = true;
    assert.throws(() => withReflectionCapture(renderer, scene, [hidden], () => {}, scratch), /target restore/);
    assert.equal(mrt, 'gbuffer'); assert.equal(renderer.autoClear, false);
    assert.equal(hidden.visible, true);
    assert.equal(sun.shadow.autoUpdate, false); assert.equal(sun.shadow.needsUpdate, true);
    assert.deepEqual(scratch.states, []); assert.deepEqual(scratch.shadows, []);
  } finally { registry.dispose(); }
});
