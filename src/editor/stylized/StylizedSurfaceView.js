import { registerCollisionTreeSource } from '../collision/CollisionPlayerBridge.js';
import { StylizedSurfaceView as StylizedSurfaceViewBase } from './StylizedSurfaceViewBase.js';
import { loadOptionalTreeVariants } from './loadOptionalTreeVariants.js';
import { installTerrainWaterQueries } from '../water/TerrainWaterQueries.js';

export class StylizedSurfaceView extends StylizedSurfaceViewBase {
  constructor(options) {
    super(options);
    installTerrainWaterQueries(options.terrainView);
    this.releaseCollisionTreeSource = null;
    this.ready = this.ready.then((result) => {
      if (!this.impostorBakeMode && this.treeView?.manifestStore) {
        this.releaseCollisionTreeSource = registerCollisionTreeSource({
          treeView: this.treeView,
          rockSource: this.rockView,
        });
      }
      return result;
    });
  }

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
        ? await loadOptionalTreeVariants({
          definitions: this.config.assets.treeVariants ?? [],
          acquire: (scene) => this.sceneAssets.acquire(scene),
          onLoaded: (scene) => this.treeVariantPaths.push(scene),
        })
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

  dispose() {
    this.releaseCollisionTreeSource?.();
    this.releaseCollisionTreeSource = null;
    super.dispose();
  }
}
