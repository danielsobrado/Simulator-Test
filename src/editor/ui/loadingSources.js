import { assetStartupTelemetry } from '../performance/AssetStartupTelemetry.js';

/** `/assets/ground/weeds/grass-blade-01.glb` → `grass-blade-01.glb`. */
export function assetFileName(url) {
  if (typeof url !== 'string') return '';
  const withoutQuery = url.split(/[?#]/, 1)[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1) || withoutQuery;
}

/**
 * Byte count for the detail line. Whole numbers past KB, because a size is here to
 * say "this will take a while", not to be precise.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Feeds a session's detail line from asset loads, and its unit counter from how
 * many have finished.
 *
 * The total is not known ahead of time — variants stream in per biome and the
 * manifest decides how many there are — so it grows as loads are discovered. That
 * makes the bar sag backwards slightly when a new batch appears, which is honest:
 * pretending to a fixed denominator would make it stall at 99% instead.
 */
export function bindAssetProgress(session, { telemetry = assetStartupTelemetry } = {}) {
  let started = 0;
  let finished = 0;
  return telemetry.onAsset(({ phase, url }) => {
    if (phase === 'begin') {
      started += 1;
      session.detail(assetFileName(url));
    } else {
      finished += 1;
    }
    session.units(finished, Math.max(started, finished));
  });
}

/**
 * Resolves once streamed chunks have settled, reporting progress meanwhile.
 *
 * Walk mode is not an async call that can be awaited — the world fills in over
 * many frames as residency catches up with the new focus — so readiness has to be
 * observed. `settleFrames` requires the quiet state to hold rather than firing on
 * the first zero, because `loading` dips to 0 between waves as chunks are queued.
 *
 * `timeoutMs` is a floor on being wrong: if streaming never settles the overlay
 * must still go away, since it is reporting on the world the player is already
 * standing in.
 */
/**
 * Opens a loading session each time the view mode enters walk mode, and closes it
 * once streaming settles.
 *
 * This lives here rather than inline in the boot sequence because the transition
 * rule is easy to get wrong in ways nothing else catches. `subscribe` also emits
 * for pointer-lock and spawn-selection changes, which arrive while already in walk
 * mode — keying on the current mode alone reopens the overlay every time the mouse
 * is grabbed. And the mode constant is `'player'`, not `'walk'`, so a hard-coded
 * guess silently never fires at all.
 */
export function watchWalkModeEntry({
  viewModeController,
  loading,
  walkMode,
  getStatus,
  onFrame,
  settle = trackStreamingSettle,
}) {
  let previousMode = null;
  return viewModeController.subscribe((state) => {
    const previous = previousMode;
    previousMode = state.mode;
    // `previous === null` is the immediate replay `subscribe` performs on
    // attachment; booting straight into walk mode is not an entry event.
    if (state.mode !== walkMode || previous === walkMode || previous === null) return;
    const session = loading.begin({
      title: 'Entering player mode',
      steps: [
        { id: 'spawn', label: 'Placing the camera' },
        { id: 'stream', label: 'Streaming chunks around the spawn' },
      ],
    });
    session.start('stream');
    settle({ session, getStatus, onFrame }).then(() => session.finish());
  });
}

export function trackStreamingSettle({
  session,
  getStatus,
  onFrame,
  settleFrames = 12,
  timeoutMs = 20000,
  clock = () => performance.now(),
}) {
  return new Promise((resolve) => {
    const startedAt = clock();
    let quiet = 0;
    let peakLoading = 0;
    const stop = onFrame(() => {
      const status = getStatus();
      if (!status) {
        finish();
        return;
      }
      const loading = Number(status.loading) || 0;
      peakLoading = Math.max(peakLoading, loading);
      // Measure against the deepest backlog seen, not the capacity: only a
      // fraction of resident chunks are ever in flight, so `resident/capacity`
      // would read as complete while the world was still visibly assembling.
      const done = peakLoading - loading;
      session.units(done, Math.max(1, peakLoading));
      session.detail(loading > 0
        ? `${loading} chunk${loading === 1 ? '' : 's'} streaming · ${status.resident}/${status.capacity} resident`
        : `${status.resident}/${status.capacity} chunks resident`);
      quiet = loading === 0 ? quiet + 1 : 0;
      if (quiet >= settleFrames || clock() - startedAt > timeoutMs) finish();
    });

    function finish() {
      stop?.();
      resolve();
    }
  });
}
