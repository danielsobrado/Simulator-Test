import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { prototypeRootSeat } from '../src/editor/stylized/forest/treeRootSeat.js';
import { TreeRootFitter } from '../src/editor/stylized/forest/TreeRootFitter.js';
import { fitRootGround, resolveRootSettings } from '../src/editor/stylized/forest/treeRootFit.js';

function prototype({ plate = .3, flare = true, branch = false } = {}) {
  const values = [0, 0, 0, 0, 10, 0];
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    for (const [y, r] of [[plate, flare ? 1.5 : .2], [.9, .2], [1.1, .2]]) {
      values.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  if (branch) for (let i = 0; i < 10; i++) values.push(2 + i * .01, .3, .2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  return [{ kind: 'trunk', geometry }];
}

test('a surrounding root plate is grounded independently of an isolated downward tip', () => {
  const parts = prototype(), foot = prototypeRootSeat(parts);
  assert.ok(Math.abs(foot.seat - .3) < 1e-6); assert.ok(Math.abs(foot.reach - 1.5) < 1e-6);
  const fitter = new TreeRootFitter({ parts: [parts], sampleHeight: () => 10, settings: { bury: .12 } });
  for (const scale of [.25, 1, 2]) {
    const result = fitter.fit({ x: 0, z: 0, height: 10, scale, prototypeIndex: 0 });
    const visibleFoot = result.height + result.rootFit.sink + foot.seat * scale;
    assert.ok(Math.abs(visibleFoot - 9.88) < 1e-6, `visible foot at scale ${scale}`);
  }
  parts[0].geometry.dispose();
});

test('a narrow trunk or a one-sided low branch cannot invent a root seating offset', () => {
  for (const options of [{ flare: false }, { flare: false, branch: true }]) {
    const parts = prototype(options);
    assert.equal(prototypeRootSeat(parts).seat, 0); parts[0].geometry.dispose();
  }
  const parts = prototype({ plate: 0 });
  assert.equal(prototypeRootSeat(parts).seat, 0); parts[0].geometry.dispose();
});

test('root seating retains the slope plane, sink bound and true overhang failure', () => {
  const settings = resolveRootSettings({ bury: .12, maxSink: .4 });
  const plane = fitRootGround((x, z) => .2 * x - .3 * z, 0, 0, 2, settings, .2);
  assert.ok(Math.abs(plane.slopeX - .2) < 1e-10); assert.ok(Math.abs(plane.slopeZ + .3) < 1e-10);
  assert.ok(Math.abs(plane.sink + .32) < 1e-10); assert.equal(plane.overhang, 0);
  const clipped = fitRootGround(() => 0, 0, 0, 2, settings, .6);
  assert.equal(clipped.sink, -.4); assert.ok(Math.abs(clipped.overhang - .2) < 1e-10);
});

test('a trunk grown roots is seated at its bole, not raised on its diving tips', () => {
  const parts = prototype();
  parts[0].bole = { x: 0, z: 0, radius: 0.2 };
  assert.deepEqual(prototypeRootSeat(parts), { seat: 0, reach: 0 });
});
