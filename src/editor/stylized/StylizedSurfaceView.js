import { StylizedSurfaceView as StylizedSurfaceViewBase } from './StylizedSurfaceViewBase.js';

async function loadOptionalTreeVariants(view) {
  const definitions = view.config.assets.treeVariants ?? [];
  const settled = await Promise.allSettled(definitions.map(async (definition) => ({
    definition,
    scene: await view.sceneAssets.acquire(definition.scene),
  })));
  const variants = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const definition = definitions[index];
    if (result.status === 'fulfilled') {
      view.treeVariantPaths.push(definition.scene);
      variants.push(result.value);
      continue;
    }
    console.warn(`Optional tree variant ${definition.scene} failed to load.`, result.reason);
  }
  return variants;
}

export class StylizedSurfaceView extends StylizedSurfaceViewBase {
  async bootstrapLayers() {
    if (!this.enabled) return null;
    const needsScene = this.config.trees.enabled;
    try {
      let sharedScene = null;
      if (needsScene) {
        this.sharedScenePath = this.config.assets.scene;
        sharedScene = await this.sceneAssets.acquire(this.sharedScenePath);
      }
      const treeVariants = this.config.trees.enabled
        ? await loadOptionalTreeVariants(this)
        : [];
      await Promise.all([
        this.treeView?.buildFromScene(sharedScene, treeVariants),
        this.flowerView?.ready,
      ].filter(Boolean));
      return null;
    } catch (error) {
      console.warn('Some stylized assets failed to load; remaining layers stay active.', error);
      return null;
    }
  }
}
