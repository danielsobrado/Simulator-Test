import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSTRUCTION_LOD_BANDS,
  DEFAULT_CONSTRUCTION_LOD,
  coarsePlacements,
  moduleProjectedPixels,
  selectConstructionLod,
} from '../src/editor/construction/render/ConstructionLod.js';

const T = DEFAULT_CONSTRUCTION_LOD;

test('bands are selected by projected size', () => {
  assert.equal(selectConstructionLod({ pixels: 400 }), 'near');
  assert.equal(selectConstructionLod({ pixels: T.nearPixels }), 'near');
  assert.equal(selectConstructionLod({ pixels: T.nearPixels - 1 }), 'coarse');
  assert.equal(selectConstructionLod({ pixels: T.coarsePixels }), 'coarse');
  assert.equal(selectConstructionLod({ pixels: T.coarsePixels - 1 }), 'shell');
  assert.equal(selectConstructionLod({ pixels: 0 }), 'shell');
});

test('every band is one this renderer knows how to build', () => {
  for (const pixels of [0, 10, 34, 36, 139, 141, 5000]) {
    assert.ok(CONSTRUCTION_LOD_BANDS.includes(selectConstructionLod({ pixels })));
  }
});

test('hysteresis holds a band across a jittering threshold', () => {
  // Sitting exactly on a threshold and wobbling must not flip the band every
  // frame — that is the popping the hysteresis exists to prevent.
  let band = selectConstructionLod({ pixels: T.nearPixels + 2 });
  assert.equal(band, 'near');
  for (const pixels of [139, 141, 138, 142, 137]) {
    band = selectConstructionLod({ pixels, previous: band });
    assert.equal(band, 'near', `dropped out at ${pixels}`);
  }
  // A decisive move past the hysteresis window does switch.
  band = selectConstructionLod({ pixels: T.nearPixels * (1 - T.hysteresisRatio) - 1, previous: band });
  assert.equal(band, 'coarse');
});

test('an edited or selected module is pinned to full detail', () => {
  assert.equal(selectConstructionLod({ pixels: 0, pinned: true }), 'near');
  assert.equal(selectConstructionLod({ pixels: 1, previous: 'shell', pinned: true }), 'near');
});

test('canonical bounds are converted before being compared to the camera', () => {
  // The camera lives in render space and module bounds are canonical, so
  // without `toRender` every module reads as its distance from the floating
  // origin — which puts an entire wall in one band regardless of the camera.
  const camera = { fov: 60, position: { x: 0, y: 0, z: 0 } };
  const module = { bounds: { minX: 4999, maxX: 5001, minZ: -1, maxZ: 1 } };
  const options = { camera, module, height: 3.5, viewportHeight: 1080 };

  const unconverted = moduleProjectedPixels(options);
  const converted = moduleProjectedPixels({
    ...options,
    toRender: (x, z) => ({ x: x - 5000, z }),
  });
  assert.ok(converted > unconverted * 100, 'the origin offset must be removed');
  assert.equal(selectConstructionLod({ pixels: unconverted }), 'shell');
  assert.equal(selectConstructionLod({ pixels: converted }), 'near');
});

test('projected size falls off with distance and rises with wall height', () => {
  const camera = { fov: 60, position: { x: 0, y: 0, z: 0 } };
  const module = { bounds: { minX: 9, maxX: 11, minZ: -1, maxZ: 1 } };
  const near = moduleProjectedPixels({ camera, module, height: 3.5, viewportHeight: 1080 });
  const far = moduleProjectedPixels({
    camera: { ...camera, position: { x: 0, y: 0, z: 200 } },
    module,
    height: 3.5,
    viewportHeight: 1080,
  });
  assert.ok(near > far, 'a distant module projects smaller');

  const tall = moduleProjectedPixels({ camera, module, height: 12, viewportHeight: 1080 });
  assert.ok(tall > near, 'a taller wall projects larger');
});

test('a module far enough away lands in the shell band', () => {
  const camera = { fov: 60, position: { x: 0, y: 0, z: 0 } };
  const module = { bounds: { minX: -1, maxX: 1, minZ: 899, maxZ: 901 } };
  const pixels = moduleProjectedPixels({ camera, module, height: 3.5, viewportHeight: 1080 });
  assert.equal(selectConstructionLod({ pixels }), 'shell');
});

test('coarse placements keep dressings and merge every other field course', () => {
  const placements = [
    { category: 'voussoir', y: 2.2, height: 0.22, s: 5 },
    { category: 'field', y: 0.23, height: 0.44, s: 1 },
    { category: 'field', y: 0.69, height: 0.44, s: 1 },
    { category: 'field', y: 1.15, height: 0.44, s: 1 },
    { category: 'field', y: 1.61, height: 0.44, s: 1 },
    { category: 'ashlar', y: 1.0, height: 0.3, s: 5 },
  ];
  const coarse = coarsePlacements(placements);
  assert.equal(coarse.filter(({ category }) => category === 'voussoir').length, 1);
  assert.equal(coarse.filter(({ category }) => category === 'ashlar').length, 1);
  const field = coarse.filter(({ category }) => category === 'field');
  assert.equal(field.length, 2, 'four field courses collapse to two');
  assert.ok(field.every((stone) => stone.height > 0.44), 'survivors stretch to cover the gap');
});

test('an orthographic camera still yields a usable size', () => {
  const camera = {
    isOrthographicCamera: true,
    top: 40,
    bottom: -40,
    zoom: 1,
    position: { x: 0, y: 50, z: 0 },
  };
  const module = { bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } };
  // 80 world units of vertical span across 1080 px puts a 3.5 m wall at ~47 px,
  // which is the coarse band — the orthographic editor camera is zoomed out.
  const pixels = moduleProjectedPixels({ camera, module, height: 3.5, viewportHeight: 1080 });
  assert.ok(Math.abs(pixels - 47.25) < 0.01, `got ${pixels}`);
  assert.equal(selectConstructionLod({ pixels }), 'coarse');

  // Zooming in reaches full detail without any change to the thresholds.
  const zoomed = moduleProjectedPixels({
    camera: { ...camera, zoom: 4 },
    module,
    height: 3.5,
    viewportHeight: 1080,
  });
  assert.equal(selectConstructionLod({ pixels: zoomed }), 'near');
});
