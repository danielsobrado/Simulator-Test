import { createSampleLookup } from '../src/editor/world/PreparedSampleTable.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RockManifestStore } from '../src/editor/stylized/RockManifestStore.js';
import { StylizedBuildQueue } from '../src/editor/stylized/StylizedBuildQueue.js';
import { FrameSlack } from '../src/editor/performance/FrameSlack.js';
import { DeferredWorkBudget } from '../src/editor/performance/DeferredWorkBudget.js';
import { createIteratorBuilder } from '../src/editor/stylized/ResumableIterator.js';
import { buildCoastStones, iterateCoastStones } from '../src/editor/stylized/coastStones.js';
import { generatePreparedPlacementChunk } from '../src/editor/world/PreparedPlacementChunk.js';
import { PreparedPlacementStore } from '../src/editor/world/PreparedPlacementStore.js';
import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { StylizedChunkRevisionTracker } from '../src/editor/stylized/StylizedChunkRevisionTracker.js';
import { TileDistanceField } from '../src/editor/stylized/forest/TileDistanceField.js';
import { ForestHabitatField } from '../src/editor/stylized/forest/ForestHabitatField.js';
import { ScatterClusterField } from '../src/editor/stylized/forest/ScatterClusterField.js';
import { RegionalCharacterField } from '../src/editor/stylized/RegionalCharacterField.js';
import { ITERATOR_PENDING } from '../src/editor/stylized/ResumableIterator.js';
import { iterateTreeLod, rebuildTreeLod } from '../src/editor/stylized/TreeLodAssembler.js';
import { TreeManifestStore } from '../src/editor/stylized/TreeManifestStore.js';

test('retained manifests survive revisits and a planted tree only invalidates its dependencies', () => {
  const world = new InfiniteWorldStore({ generator: new ProceduralWorldGenerator(), chunkSize: 8, tileSize: 2 });
  const revisions = new StylizedChunkRevisionTracker({ worldStore: world });
  const terrain = { worldStore: world, chunkWorldSize: 16,
    tileMap: { get: (x, z) => world.getTile(x, z) },
    getCanonicalHeight: (x, z) => world.sampleHeight(x / 2, -z / 2) };
  const store = new TreeManifestStore({ terrainView: terrain, revisionTracker: revisions, prototypeCount: 1,
    config: { trees: { perChunk: 8, tileIds: Array.from({ length: 13 }, (_, i) => i),
      habitat: { enabled: false }, minScale: 1, maxScale: 1, clearRadius: 0 } } });
  const near = store.build(0, 0, []);
  const distant = store.build(20, 20, []);
  store.setActive(new Set(['20:20']));
  assert.strictEqual(store.get(0, 0, []), near);
  store.plant({ stableId: 'planted:test', x: 4, z: -4, speciesId: 'oak', ageClass: 'mature' });
  assert.equal(store.get(0, 0, []), null);
  assert.strictEqual(store.get(20, 20, []), distant);
  assert.ok(store.build(0, 0, []).some(placement => placement.stableId === 'planted:test'));
  revisions.dispose(); store.dispose();
});

test('local terrain revisions refresh habitat and slope while retaining distant samples', () => {
  let slope = 0.1, revision = 0;
  const heightAt = x => x < 128 ? x * slope : x * 0.1;
  const localRevision = x => x < 128 ? revision : 0;
  const forest = new ForestHabitatField({ tileSize: 2, tileAt: () => 6, heightAt });
  const rock = new ScatterClusterField({ kind: 'rock', heightAt });
  forest.localRevisionProvider = rock.localRevisionProvider = localRevision;
  const near = forest.sample(20, 20), distant = forest.sample(1020, 20);
  const nearNode = rock.nodeAt(3, 3), distantNode = rock.nodeAt(170, 3);
  slope = 0.5; revision++;
  assert.notEqual(forest.sample(20, 20).slope, near.slope);
  assert.strictEqual(forest.sample(1020, 20), distant);
  assert.notEqual(rock.nodeAt(3, 3).slope, nearNode.slope);
  assert.strictEqual(rock.nodeAt(170, 3), distantNode);
});

test('tree instance assembly resumes without publishing partial records and preserves its output', () => {
  const placements = Array.from({ length: 20 }, (_, index) => ({
    x: index, z: -index, height: 1, scale: 1, prototypeIndex: 0, rotationY: 0,
    priority: index / 20, stableId: `tree:0:0:${index}`,
  }));
  const create = () => {
    const publications = [];
    return { publications, options: {
      plan: { entries: [{ chunkX: 0, chunkZ: 0, chunkDistance: 2,
        representations: [{ band: 'impostor', fade: 1 }] }] },
      manifestStore: { getOrSchedule: () => placements, setActive() {} },
      prototypeCount: 1, prototypeHeight: 10, prototypeWidth: 8,
      impostorAtlases: [{ height: 10, radius: 4 }],
      impostorBatches: [{ setRecords(records) {
        publications.push(records);
        return { mode: 'gpu', requested: records.length, accepted: records.length, dropped: 0 };
      } }],
      renderers: [], proxyRenderers: [], fallbackImpostorRenderers: [], clusterRenderers: [],
    } };
  };
  const expected = create();
  rebuildTreeLod(expected.options);
  const actual = create();
  const builder = createIteratorBuilder(() => iterateTreeLod(actual.options));
  let result = null, slices = 0;
  while (result === null && slices++ < 50) {
    let checks = 0;
    result = builder.step({ shouldYield: () => ++checks > 5 });
    if (result === null) assert.equal(actual.publications.length, 0);
  }
  assert.ok(slices > 2);
  assert.equal(result, true);
  assert.deepEqual(actual.publications, expected.publications);
});

test('a pending dependency stops a slice without busy polling or spending its allowance', () => {
  let attempts = 0;
  let ready = false;
  const builder = createIteratorBuilder(function* () {
    while (!ready) { attempts++; yield ITERATOR_PENDING; }
    return [];
  });
  assert.equal(builder.step(), null);
  assert.equal(attempts, 1);
  assert.equal(builder.step(), null);
  assert.equal(attempts, 2);
  ready = true;
  assert.deepEqual(builder.step(), []);
});

test('prepared ecology matches exact habitat and rock nodes with overrides and fractional tile size', () => {
  const generator = new ProceduralWorldGenerator({ seed: 1337 });
  const tileSize = 1.25;
  const world = new InfiniteWorldStore({ generator, chunkSize: 8, tileSize });
  world.setTile(-3, -2, 0);
  world.setHeight(-3, -2, 9);
  const trees = { perChunk: 12, tileIds: Array.from({ length: 13 }, (_, i) => i), habitat: { waterRangeMeters: 5 } };
  const rocks = {};
  const config = { targets: [{ label: 'water', targetTileId: 0, maxCells: 4 }],
    tileOverrides: [...world.tileOverrides], heightOverrides: [...world.heightOverrides],
    ecology: { trees, rocks, seed: 1337, tileSize } };
  const page = generatePreparedPlacementChunk({ chunkX: -1, chunkZ: -1, chunkSize: 8,
    placementSamplingConfig: config }, generator);
  const heightAt = (x, z) => world.sampleHeight(x / tileSize, -z / tileSize);
  const water = new TileDistanceField({ tileAt: (x, z) => world.getTile(x, z), tileSize,
    chunkSize: 8, targetTileId: 0, maxCells: 4, maxCachedChunks: 9 });
  const forest = new ForestHabitatField({ seed: 1337, tileSize, tileAt: (x, z) => world.getTile(x, z),
    heightAt, waterDistanceAt: (x, z) => water.worldDistanceAt(x, z), config: trees.habitat,
    regionalCharacterField: new RegionalCharacterField({ seed: 1337 }) });
  assert.ok(page.forestSamples.size > 256);
  const forestLookup = createSampleLookup(page.forestSamples);
  for (let index = 0; index < page.forestSamples.size; index++) {
    const x = page.forestSamples.coordinates[index * 2], z = page.forestSamples.coordinates[index * 2 + 1];
    const key = `${x}:${z}`;
    const sample = forestLookup.get(key);
    assert.deepEqual(sample, forest.sample(x, z), `habitat ${key}`);
  }
  const cluster = new ScatterClusterField({ kind: 'rock', seed: 1337, seedOffset: 0xa7, heightAt, config: rocks });
  const rockLookup = createSampleLookup(page.rockNodes);
  for (let index = 0; index < page.rockNodes.size; index++) {
    const x = page.rockNodes.coordinates[index * 2], z = page.rockNodes.coordinates[index * 2 + 1];
    const key = `${x}:${z}`;
    const sample = rockLookup.get(key);
    assert.deepEqual(sample, cluster.nodeAt(x, z), `rock node ${key}`);
  }
});

function rockStore() {
  const view = {
    prototypes: [{}], terrainView: { focusChunk: { chunkX: 0, chunkZ: 0 } },
    manifestBuildBudgetMs: 100, placementsByChunk: new Map(),
    manifestKey: (x, z) => `revision:${x}:${z}`,
    manifestOptions: (chunkX, chunkZ) => ({ kind: 'rock', chunkX, chunkZ, chunkSize: 1,
      tileSize: 1, perChunk: 1, tileIds: [1], tileAt: () => 1, heightAt: () => 0,
      prototypeCount: 1, minScale: 1, maxScale: 1, radiusForScale: () => 0 }),
    *riverbankRocksForChunk() { yield; return []; },
    *coastStonesForChunk() { yield; return []; },
    *seabedRocksForChunk() { yield; return []; },
    *formationRocksForChunk() { yield; return []; },
    *resolveGroundPlacements(placements) { yield; return placements; },
  };
  return { view, store: new RockManifestStore(view) };
}

test('rock/blocker lookups only request, coalesce halos, and reuse complete snapshots', () => {
  const { store } = rockStore();
  assert.equal(store.blockerSnapshot(0, 0), null);
  assert.equal(store.blockerSnapshot(0, 0), null);
  assert.equal(store.queue.size, 9);
  assert.equal(store.pending.size, 0, 'getters must not start builders');
  store.flush();
  const snapshot = store.blockerSnapshot(0, 0);
  assert.equal(snapshot.placements.length, 9);
  assert.strictEqual(store.blockerSnapshot(0, 0), snapshot);
  assert.equal(store.queue.size, 0);
  const { view } = { view: store.view };
  view.prototypeRevision = 1;
  view.manifestKey = (x, z) => `edited:${x}:${z}`;
  assert.equal(store.blockerSnapshot(0, 0), null);
});

test('nested rock work cannot start under an exhausted parent and finalization remains resumable', () => {
  const { view, store } = rockStore();
  view.shouldYieldWork = () => true;
  store.request(0, 0);
  assert.equal(store.flush().built, 0);
  assert.equal(store.pending.size, 0);
  view.shouldYieldWork = () => false;
  let checks = 0;
  let complete = false;
  for (let slice = 0; slice < 100 && !complete; slice++) {
    checks = 0;
    store.step({ key: '0:0', chunkX: 0, chunkZ: 0 }, () => ++checks > 5);
    complete = store.get(0, 0) !== null;
  }
  assert.equal(complete, true);
  assert.equal(store.get(0, 0).length, 1);
});

test('real shoreline generation has identical output across deadline slices', () => {
  const options = { chunkX: 0, chunkZ: 0, chunkSize: 32, tileSize: 2,
    seaLevel: 0, heightAt: () => 0.3, prototypeIndexForRoll: () => 0,
    radiusForScale: scale => scale };
  const expected = buildCoastStones(options);
  assert.ok(expected.length > 0);
  const builder = createIteratorBuilder(() => iterateCoastStones(options));
  let actual = null;
  let slices = 0;
  while (actual === null && slices++ < 1000) {
    let units = 0;
    actual = builder.step({ shouldYield: () => ++units > 4 });
  }
  assert.ok(slices > 10);
  assert.deepEqual(actual, expected);
});

test('global progress floor cannot be re-granted to another nested consumer', () => {
  let clock = 0;
  const frame = new FrameSlack({ targetMs: 7, reserveMs: 0.5, now: () => clock });
  frame.beginFrame(); clock = 8; frame.endFrame(); frame.beginFrame();
  assert.equal(frame.available(0.25, 3), 0.25);
  frame.defer(() => { clock += 0.3; assert.equal(frame.available(0.25, 3), 0); });
  assert.equal(frame.available(0.25, 3), 0);
});

test('empty queues do not start the shared deadline before later work becomes eligible', () => {
  let clock = 0;
  const frame = new FrameSlack({ targetMs: 7, now: () => clock });
  const queue = new StylizedBuildQueue({ now: () => clock,
    budgetProvider: max => frame.available(0.25, max) });
  frame.beginFrame(); clock = 8; frame.endFrame(); frame.beginFrame();
  assert.deepEqual(queue.flush(() => assert.fail('empty queue ran')), { built: 0, remaining: 0 });
  assert.equal(frame.deadline, null);
  clock += 10;
  queue.enqueue({ key: 'later' });
  assert.equal(queue.flush(() => { frame.defer(() => { clock += 0.3; }); return true; }).built, 1);
  assert.equal(frame.available(0.25, 3), 0);
});

test('attached scenery queues honor the shared late floor instead of the legacy wall-clock gate', () => {
  let clock = 0;
  const settings = { enabled: true, targetFps: 144, reserveMs: 0.5, minimumMs: 0.25, maximumMs: 1.2 };
  const budget = new DeferredWorkBudget(settings);
  budget.slack = new FrameSlack({ targetMs: 7, maximumMs: 1.2, now: () => clock });
  budget.slack.fixedMs = 10;
  const queue = new StylizedBuildQueue({ now: () => clock, shouldYield: () => true });
  budget.attachSurface({ bushBuildQueue: queue });
  budget.beginFrame();
  clock = 10; // Mandatory scenery has exceeded the old wall-clock deadline.
  queue.enqueue({ key: 'bush:first' });
  assert.equal(queue.flush(() => { clock += 0.3; return true; }).built, 1);
  queue.enqueue({ key: 'bush:second' });
  assert.equal(queue.flush(() => assert.fail('floor granted twice')).built, 0);
  budget.beginFrame();
  clock += 10;
  assert.equal(queue.flush(() => { clock += 0.3; return true; }).built, 1);
  settings.enabled = false;
  budget.beginFrame();
  queue.enqueue({ key: 'legacy' });
  assert.equal(queue.flush(() => assert.fail('disabled adaptive mode bypassed its legacy gate')).built, 0);
});

test('attaching the same scenery queue twice keeps one stable yield gate', () => {
  let legacyCalls = 0;
  const budget = new DeferredWorkBudget({
    enabled: false,
    targetFps: 144,
    reserveMs: 0.5,
    minimumMs: 0.25,
    maximumMs: 1.2,
  });
  const queue = new StylizedBuildQueue({
    shouldYield: () => {
      legacyCalls += 1;
      return true;
    },
  });
  const surface = { bushBuildQueue: queue };
  budget.attachSurface(surface);
  const firstGate = queue.shouldYield;
  budget.attachSurface(surface);
  assert.equal(queue.shouldYield, firstGate);
  assert.equal(queue.shouldYield(), true);
  assert.equal(legacyCalls, 1);
});

test('readiness checks preserve the progress floor across mandatory work', () => {
  let clock = 0;
  const frame = new FrameSlack({ targetMs: 7, now: () => clock });
  frame.fixedMs = 10;
  frame.beginFrame();
  assert.equal(frame.peek(0.25, 3), 0.25);
  clock += 10;
  assert.equal(frame.available(0.25, 3), 0.25);
  frame.defer(() => { clock += 0.3; });
  assert.equal(frame.peek(0.25, 3), 0);
});

test('a small consumer limit does not shorten the shared frame allowance', () => {
  let clock = 0;
  const frame = new FrameSlack({ targetMs: 7, maximumMs: 1.2, now: () => clock });
  frame.fixedMs = 1;
  frame.beginFrame();
  assert.equal(frame.available(0.25, 0.25), 0.25);
  frame.defer(() => { clock += 0.15; });
  assert.equal(frame.available(0.25, 3), 1.05);
});

test('mandatory work between early placement and grass does not spend the deferred allowance twice', () => {
  let clock = 0;
  const frame = new FrameSlack({ targetMs: 7, reserveMs: 0.5, maximumMs: 1.2, now: () => clock });
  frame.fixedMs = 4;
  frame.beginFrame();
  assert.equal(frame.available(0.25, 3), 1.2);
  const deadline = frame.deadline;
  frame.defer(() => { clock += 0.2; });
  clock += 2; // Physics and mandatory scenery, already predicted by fixedMs.
  assert.equal(frame.available(0.25, 3), 1);
  assert.equal(frame.deadline, deadline, 'later queues inherit the same frame cutoff');
  frame.defer(() => { clock += 1.1; });
  assert.equal(frame.available(0.25, 3), 0, 'later queues cannot grant another floor');
});

test('the shared frame cutoff bounds unspent deferred allowance', () => {
  let clock = 0;
  const frame = new FrameSlack({ targetMs: 7, reserveMs: 0.5, maximumMs: 1.2, now: () => clock });
  frame.fixedMs = 4;
  frame.beginFrame();
  assert.equal(frame.available(0.25, 3), 1.2);
  clock = 6.6;
  assert.equal(frame.available(0.25, 3), 0);
  assert.equal(frame.deadline, 6.5, 'a later consumer cannot extend the cutoff');
});

test('worker CPU arrays preserve canonical precision and canonical edits including negative chunks', () => {
  const generator = new ProceduralWorldGenerator();
  const world = new InfiniteWorldStore({ generator, chunkSize: 8, tileSize: 2 });
  const page = generatePreparedPlacementChunk({ chunkX: -1, chunkZ: -1, chunkSize: 8,
    placementSamplingConfig: { targets: [{ label: 'water', targetTileId: 0, maxCells: 2 }],
      tileOverrides: [['-3:-2', 0]], heightOverrides: [['-3:-2', 9]] } }, generator);
  world.installPreparedSamples(page);
  assert.ok(page.canonicalHeights instanceof Float64Array);
  for (let z = -8; z < 0; z++) for (let x = -8; x < 0; x++) {
    assert.equal(world.getHeight(x, z), generator.sampleHeight(x, z));
  }
  world.setHeight(-3, -2, 9);
  assert.equal(world.getHeight(-3, -2), 9);
  const exactField = new TileDistanceField({ tileAt: (x, z) => x === -3 && z === -2 ? 0 : generator.sampleTile(x, z),
    tileSize: 2, chunkSize: 8, maxCells: 2, targetTileId: 0 });
  assert.deepEqual(page.fields.water.distances, exactField.chunkField(-1, -1).distances);
});

test('local revision rejects a late prepared response without invalidating distant chunks', async () => {
  const generator = new ProceduralWorldGenerator();
  const world = new InfiniteWorldStore({ generator, chunkSize: 8, tileSize: 2 });
  const responses = [];
  world.chunkWorker = { request(x, z, options) { return new Promise(resolve => responses.push({ x, z, options, resolve })); } };
  const revisions = new StylizedChunkRevisionTracker({ worldStore: world });
  const store = new PreparedPlacementStore({ worldStore: world, revisionTracker: revisions,
    config: { trees: { habitat: {} }, water: {}, path: {} } });
  store.request(0, 0, 0); store.request(10, 10, 0);
  world.setTile(0, 0, 7);
  for (const r of responses) r.resolve(generatePreparedPlacementChunk({ chunkX: r.x, chunkZ: r.z,
    chunkSize: 8, placementSamplingConfig: r.options.placementSamplingConfig }, generator));
  await Promise.resolve(); store.flush();
  assert.equal(store.get(0, 0), null);
  assert.ok(store.get(10, 10));
  store.dispose(); revisions.dispose();
});
