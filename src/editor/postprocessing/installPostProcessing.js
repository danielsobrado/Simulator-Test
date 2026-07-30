import { EditorUi } from '../EditorUi.js';
import { InfiniteTerrainView } from '../InfiniteTerrainView.js';
import { PostProcessingController } from './PostProcessingController.js';
import { mountPostProcessingSettings } from './PostProcessingSettingsPanel.js';

const INSTALL_KEY = Symbol.for('drusniel.postProcessing.installed');

function wrapMethod(prototype, name, wrapper) {
  const original = prototype[name];
  if (typeof original !== 'function') return;
  prototype[name] = wrapper(original);
}

export function installPostProcessingRuntime() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  wrapMethod(InfiniteTerrainView.prototype, 'initialize', (original) => async function initialize(...args) {
    const result = await original.apply(this, args);
    const postConfig = this.stylizedConfig?.postProcessing;
    if (postConfig && !this.postProcessing) {
      this.postProcessing = new PostProcessingController({
        renderer: this.renderer,
        scene: this.scene,
        godRays: this.godRays,
        config: postConfig,
      });
      this.godRays.postProcessing = this.postProcessing;
    }
    return result;
  });

  wrapMethod(InfiniteTerrainView.prototype, 'render', (original) => function render(camera) {
    if (this.postProcessing?.render(camera)) return;
    original.call(this, camera);
  });

  wrapMethod(InfiniteTerrainView.prototype, 'prewarmPostProcessing', (original) => function prewarm(camera) {
    if (this.postProcessing?.getSettings().enabled) {
      return this.postProcessing.prewarm(camera);
    }
    return original.call(this, camera);
  });

  wrapMethod(InfiniteTerrainView.prototype, 'resize', (original) => function resize(...args) {
    const result = original.apply(this, args);
    this.postProcessing?.resize();
    return result;
  });

  wrapMethod(InfiniteTerrainView.prototype, 'updateFloatingOrigin', (original) => function updateOrigin(...args) {
    const rebase = original.apply(this, args);
    if (rebase) this.postProcessing?.invalidate('floating-origin');
    return rebase;
  });

  wrapMethod(InfiniteTerrainView.prototype, 'dispose', (original) => function dispose(...args) {
    this.postProcessing?.dispose();
    this.postProcessing = null;
    return original.apply(this, args);
  });

  wrapMethod(EditorUi.prototype, 'attachGodRays', (original) => function attachGodRays(effect) {
    original.call(this, effect);
    this.detachPostProcessingSettings?.();
    this.detachPostProcessingSettings = mountPostProcessingSettings(
      this.godRaysPanel,
      effect?.postProcessing,
    );
  });
}
