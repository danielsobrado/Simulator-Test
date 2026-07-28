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

function rect(halfW, halfH) {
  return [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
}

function bounds(corners) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { width: maxX - minX, height: maxY - minY };
}

test('split leaves merge into one coarse block with outer mortar footprint', () => {
  // Leaf-local mortar rings: at s=±0.25 they cover world [-0.5,0] and [0,0.5].
  const leafMortar = rect(0.25, 0.25);
  const leafStone = rect(0.23, 0.23);
  const near = [
    {
      category: 'field',
      cellIndex: 7,
      courseIndex: 0,
      s: -0.25,
      y: 0.5,
      width: 0.46,
      height: 0.46,
      corners: leafStone,
      mortarCorners: leafMortar,
      jointWidths: { head: 0.04, bed: 0.04 },
      packedWidth: 0.5,
    },
    {
      category: 'field',
      cellIndex: 7,
      courseIndex: 0,
      s: 0.25,
      y: 0.5,
      width: 0.46,
      height: 0.46,
      corners: leafStone,
      mortarCorners: leafMortar,
      jointWidths: { head: 0.04, bed: 0.04 },
      packedWidth: 0.5,
    },
  ];

  const coarse = coarsePlacements(near, { styleKey: 'coursed-rubble' });
  const field = coarse.filter((stone) => stone.category === 'field');
  assert.equal(field.length, 1);
  const stone = field[0];
  assert.ok(stone.mortarCorners);
  const mortarW = bounds(stone.mortarCorners).width;
  assert.ok(Math.abs(mortarW - 1) < 1e-6, `merged mortar width ${mortarW}`);
  assert.ok(bounds(stone.corners).width < mortarW - 0.01);
});

test('soft limestone coarse joints amplify once from near placements', () => {
  const mortarCorners = rect(0.55, 0.28);
  const nearHead = 0.032;
  const nearBed = 0.024;
  const placement = {
    category: 'field',
    cellIndex: 1,
    courseIndex: 0,
    s: 1,
    y: 0.5,
    width: 1.1 - nearHead,
    height: 0.56 - nearBed,
    corners: scaleCornersForTest(mortarCorners, 1 - nearHead / 1.1, 1 - nearBed / 0.56),
    mortarCorners,
    jointWidths: { head: nearHead, bed: nearBed },
    packedWidth: 1.1,
  };
  // Second course so stretch runs; use identical horizontal footprint.
  const above = {
    ...placement,
    courseIndex: 1,
    y: 1.1,
    cellIndex: 2,
  };
  const near = [placement, above];
  const snapshot = structuredClone(near);
  const coarse = coarsePlacements(near, { styleKey: 'soft-limestone-rubble' });
  assert.deepEqual(near, snapshot, 'near placements stay immutable');

  const field = coarse.filter((stone) => stone.category === 'field');
  assert.equal(field.length, 1);
  const stone = field[0];
  assert.ok(Math.abs(stone.jointWidths.head - nearHead * 1.2) < 1e-9);
  assert.ok(Math.abs(stone.jointWidths.bed - nearBed * 1.2) < 1e-9);

  const again = coarsePlacements(near, { styleKey: 'soft-limestone-rubble' });
  assert.deepEqual(again, coarse);

  const mortar = bounds(stone.mortarCorners);
  const visible = bounds(stone.corners);
  assert.ok(Math.abs((mortar.width - visible.width) - stone.jointWidths.head) < 0.02);
  assert.ok(visible.width + 1e-9 >= 0.12);
  assert.ok(visible.height + 1e-9 >= 0.08);
});

function scaleCornersForTest(corners, scaleX, scaleY) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return corners.map(([x, y]) => [cx + (x - cx) * scaleX, cy + (y - cy) * scaleY]);
}
