import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { LoadingTracker } from '../src/editor/ui/LoadingTracker.js';
import {
  assetFileName,
  bindAssetProgress,
  formatBytes,
  trackStreamingSettle,
  watchWalkModeEntry,
} from '../src/editor/ui/loadingSources.js';
import { PLAYER_MODE_EDIT, PLAYER_MODE_WALK } from '../src/editor/player/playerConstants.js';

function fakeViewMode() {
  const listeners = new Set();
  let mode = PLAYER_MODE_EDIT;
  return {
    subscribe(listener) {
      listeners.add(listener);
      listener({ mode });
      return () => listeners.delete(listener);
    },
    set(next) {
      mode = next;
      for (const listener of listeners) listener({ mode });
    },
    /** Re-emits without changing mode, as pointer-lock and spawn changes do. */
    touch() {
      for (const listener of listeners) listener({ mode });
    },
  };
}

function tracker() {
  let now = 0;
  const instance = new LoadingTracker({ clock: () => now });
  return { instance, tick: (ms) => { now += ms; } };
}

test('a closed tracker reports nothing open', () => {
  const { instance } = tracker();
  assert.deepEqual(instance.getState(), { open: false });
});

test('steps advance the bar and name the active phase', () => {
  const { instance } = tracker();
  const session = instance.begin({ title: 'Loading world', steps: ['Terrain', 'Assets', 'Map'] });
  assert.equal(instance.getState().ratio, 0);
  session.start('Terrain');
  assert.equal(instance.getState().activeLabel, 'Terrain');
  session.complete('Terrain');
  assert.ok(Math.abs(instance.getState().ratio - 1 / 3) < 1e-9);
});

test('starting a later step completes the ones skipped over', () => {
  // Flows legitimately skip work — a cached map, an import with no settings to
  // apply — and a stranded half-finished step behind the active one reads as a
  // hang that never resolves.
  const { instance } = tracker();
  const session = instance.begin({ title: 'Map', steps: ['Download', 'Import', 'Apply'] });
  session.start('Apply');
  const state = instance.getState();
  assert.deepEqual(state.steps.map((step) => step.state), ['done', 'done', 'active']);
  assert.ok(Math.abs(state.ratio - 2 / 3) < 1e-9);
});

test('units move the bar inside a long step', () => {
  const { instance } = tracker();
  const session = instance.begin({ title: 'Streaming', steps: ['Chunks', 'Vegetation'] });
  session.start('Chunks').units(5, 10);
  // Half of the first of two steps.
  assert.ok(Math.abs(instance.getState().ratio - 0.25) < 1e-9);
  session.units(0, 0);
  assert.equal(instance.getState().ratio, 0);
});

test('units clamp rather than overrunning the bar', () => {
  const { instance } = tracker();
  const session = instance.begin({ title: 'Assets', steps: ['Load'] });
  session.start('Load').units(40, 10);
  assert.equal(instance.getState().ratio, 1);
});

test('failure marks the step and keeps the panel open to say so', () => {
  const { instance } = tracker();
  const session = instance.begin({ title: 'Map', steps: ['Download', 'Import'] });
  session.start('Download').fail(new Error('404 Not Found'));
  const state = instance.getState();
  assert.equal(state.open, true);
  assert.equal(state.error, '404 Not Found');
  assert.equal(state.steps[0].state, 'failed');
});

test('finishing completes outstanding steps and closes', () => {
  const { instance, tick } = tracker();
  const session = instance.begin({ title: 'Boot', steps: ['A', 'B'] });
  session.start('A');
  tick(250);
  session.finish();
  assert.equal(instance.getState().open, false);
  assert.equal(session.getState().elapsedMs, 250);
  assert.equal(session.getState().ratio, 1);
});

test('a second begin replaces the first rather than queueing behind it', () => {
  // These flows are user-initiated. If someone loads a map while boot is still
  // finishing, the map is what they are waiting on — showing the stale phase
  // would be actively misleading.
  const { instance } = tracker();
  instance.begin({ title: 'Boot', steps: ['A'] });
  instance.begin({ title: 'Map', steps: ['B'] });
  assert.equal(instance.getState().title, 'Map');
});

test('subscribers receive the current state immediately and on change', () => {
  const { instance } = tracker();
  const seen = [];
  instance.subscribe((state) => seen.push(state.open));
  const session = instance.begin({ title: 'Boot', steps: ['A'] });
  session.finish();
  assert.deepEqual(seen, [false, true, false]);
});

test('unknown step ids fail loudly instead of silently doing nothing', () => {
  const { instance } = tracker();
  const session = instance.begin({ title: 'Boot', steps: ['A'] });
  assert.throws(() => session.start('typo'), /Unknown loading step: typo/);
});

test('asset file names are reduced to the basename', () => {
  assert.equal(assetFileName('/assets/ground/weeds/grass-blade-01.glb'), 'grass-blade-01.glb');
  assert.equal(assetFileName('/assets/trees/oak.glb?v=2'), 'oak.glb');
  assert.equal(assetFileName(undefined), '');
});

test('asset progress names the file and counts completions', () => {
  const listeners = new Set();
  const telemetry = { onAsset: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const emit = (event) => { for (const fn of listeners) fn(event); };
  const { instance } = tracker();
  const session = instance.begin({ title: 'Boot', steps: ['Assets'] });
  session.start('Assets');
  const stop = bindAssetProgress(session, { telemetry });

  emit({ phase: 'begin', url: '/assets/trees/oak.glb' });
  assert.equal(instance.getState().detail, 'oak.glb');
  assert.ok(Math.abs(instance.getState().ratio - 0) < 1e-9);
  emit({ phase: 'end', url: '/assets/trees/oak.glb' });
  assert.equal(instance.getState().ratio, 1);

  // A newly discovered load reopens the denominator rather than pinning at 100%.
  emit({ phase: 'begin', url: '/assets/bushes/bush.glb' });
  assert.equal(instance.getState().ratio, 0.5);
  stop();
  emit({ phase: 'end', url: '/assets/bushes/bush.glb' });
  assert.equal(instance.getState().ratio, 0.5, 'unsubscribed listener still fired');
});

test('streaming settle waits for quiet to hold, not for the first zero', async () => {
  // `loading` dips to 0 between waves as the next ring is queued, so firing on the
  // first zero dismisses the overlay while the world is still assembling.
  const { instance } = tracker();
  const session = instance.begin({ title: 'Walk', steps: ['Streaming'] });
  session.start('Streaming');
  const queue = [
    { loading: 4, resident: 20, capacity: 49 },
    { loading: 0, resident: 30, capacity: 49 },
    { loading: 6, resident: 36, capacity: 49 },
    { loading: 0, resident: 49, capacity: 49 },
    { loading: 0, resident: 49, capacity: 49 },
    { loading: 0, resident: 49, capacity: 49 },
  ];
  let frame = null;
  let stopped = false;
  await Promise.all([
    trackStreamingSettle({
      session,
      getStatus: () => queue.shift() ?? { loading: 0, resident: 49, capacity: 49 },
      onFrame: (fn) => { frame = fn; return () => { stopped = true; }; },
      settleFrames: 3,
      clock: () => 0,
    }),
    (async () => {
      for (let index = 0; index < 8; index += 1) {
        frame();
        await Promise.resolve();
      }
    })(),
  ]);
  assert.equal(stopped, true);
  // Six frames consumed the queue; the second wave must not have ended it early.
  assert.equal(queue.length, 0);
});

test('streaming settle gives up rather than trapping the player', async () => {
  const { instance } = tracker();
  const session = instance.begin({ title: 'Walk', steps: ['Streaming'] });
  session.start('Streaming');
  let now = 0;
  let frame = null;
  await Promise.all([
    trackStreamingSettle({
      session,
      getStatus: () => ({ loading: 3, resident: 10, capacity: 49 }),
      onFrame: (fn) => { frame = fn; return () => {}; },
      timeoutMs: 100,
      clock: () => now,
    }),
    (async () => {
      frame();
      await Promise.resolve();
      now = 500;
      frame();
    })(),
  ]);
  assert.equal(instance.getState().open, true);
});

test('walk-mode entry opens the overlay, and only on entry', () => {
  // The mode constant is 'player', not 'walk'. A hard-coded guess here silently
  // never fires, which looks exactly like the feature not being wired at all.
  const viewModeController = fakeViewMode();
  const { instance } = tracker();
  let settles = 0;
  watchWalkModeEntry({
    viewModeController,
    loading: instance,
    walkMode: PLAYER_MODE_WALK,
    getStatus: () => ({ loading: 0, resident: 1, capacity: 1 }),
    onFrame: () => () => {},
    settle: () => { settles += 1; return new Promise(() => {}); },
  });

  assert.equal(instance.getState().open, false, 'attachment must not open it');
  viewModeController.set(PLAYER_MODE_WALK);
  assert.equal(instance.getState().open, true);
  assert.equal(instance.getState().title, 'Entering player mode');
  assert.equal(settles, 1);

  // Pointer lock and spawn selection re-emit while already in player mode. Keyed
  // on the mode alone, grabbing the mouse would reopen the panel over the game.
  viewModeController.touch();
  viewModeController.touch();
  assert.equal(settles, 1, 'a re-emit inside player mode must not restart it');

  viewModeController.set(PLAYER_MODE_EDIT);
  viewModeController.set(PLAYER_MODE_WALK);
  assert.equal(settles, 2, 'returning to player mode should track again');
});

test('walk-mode overlay closes once streaming settles', async () => {
  const viewModeController = fakeViewMode();
  const { instance } = tracker();
  let resolveSettle;
  watchWalkModeEntry({
    viewModeController,
    loading: instance,
    walkMode: PLAYER_MODE_WALK,
    getStatus: () => ({ loading: 0, resident: 1, capacity: 1 }),
    onFrame: () => () => {},
    settle: () => new Promise((resolve) => { resolveSettle = resolve; }),
  });
  viewModeController.set(PLAYER_MODE_WALK);
  assert.equal(instance.getState().open, true);
  resolveSettle();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(instance.getState().open, false);
});

test('byte sizes read as a rough scale, not a precise count', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(7_969_177), '7.6 MB');
  assert.equal(formatBytes(45 * 1024 * 1024), '45 MB');
  // A missing File.size must not put "NaN undefined" in front of the user.
  assert.equal(formatBytes(undefined), '');
  assert.equal(formatBytes(-1), '');
});

test('the overlay never puts a compositing filter over the live canvas', () => {
  // `backdrop-filter` on a full-viewport fixed layer makes the compositor re-blur
  // the whole framebuffer every frame, over a WebGPU canvas that is already the
  // most expensive thing on the page. It cost most of the frame rate for as long as
  // the overlay was up — and the overlay is shown exactly during the heaviest work,
  // so it taxed the very thing it was reporting on.
  const css = readFileSync(
    new URL('../src/editor/ui/loadingOverlay.css', import.meta.url),
    'utf8',
  );
  const declarations = css
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('/*'));
  assert.equal(
    declarations.some((line) => /backdrop-filter\s*:/.test(line)),
    false,
    'loadingOverlay.css declares backdrop-filter',
  );
});
