import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { normalizeBaseUrl, resolveAssetUrl } from './assetUrl.js';
import { assetStartupTelemetry } from '../performance/AssetStartupTelemetry.js';

/** The Basis transcoder every KTX2 load in the app uses. */
export const BASIS_TRANSCODER_PATH = 'assets/gods-end/decoders/basis/';

// renderer -> transcoder URL -> { loader, refs }
const pools = new WeakMap();

function instrument(loader, telemetry) {
  const load = loader.load.bind(loader);
  loader.load = (url, onLoad, onProgress, onError) => {
    const startedAt = telemetry.clock();
    let finished = false;
    const finish = (texture, error = null) => {
      if (finished) return;
      finished = true;
      telemetry.recordKtx2({ durationMs: telemetry.clock() - startedAt, texture, error });
    };
    return load(
      url,
      (texture) => { finish(texture); onLoad?.(texture); },
      onProgress,
      (error) => { finish(null, error); onError?.(error); },
    );
  };
  telemetry.setKtx2Support(loader.workerConfig);
}

/**
 * One KTX2Loader (one transcoder worker pool, one WASM compile) per renderer.
 * Every owner gets its own `release`; the loader is disposed when the last
 * owner releases it. Owners must never call `loader.dispose()` themselves.
 *
 * An empty transcoder path makes three load its bundled transcoder relative to
 * KTX2Loader's own module, which Vite pre-bundles into node_modules/.vite/deps:
 * in dev that URL lands on the SPA fallback and every KTX2 texture is dropped.
 * The vendored copy is byte-identical to three r187's.
 *
 * @returns {{ loader: KTX2Loader, release: () => void }}
 */
export function acquireKtx2Loader(renderer, baseUrl = '/', telemetry = assetStartupTelemetry) {
  if (!renderer) throw new Error('A renderer is required to initialize KTX2 texture support.');
  const url = resolveAssetUrl(normalizeBaseUrl(baseUrl), BASIS_TRANSCODER_PATH);
  let byUrl = pools.get(renderer);
  if (!byUrl) pools.set(renderer, byUrl = new Map());
  let entry = byUrl.get(url);
  if (!entry) {
    const loader = new KTX2Loader().setTranscoderPath(url).detectSupport(renderer);
    instrument(loader, telemetry);
    byUrl.set(url, entry = { loader, refs: 0 });
  }
  entry.refs += 1;
  let released = false;
  return {
    loader: entry.loader,
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      byUrl.delete(url);
      entry.loader.dispose();
    },
  };
}
