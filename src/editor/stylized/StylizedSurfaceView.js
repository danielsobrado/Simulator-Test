import { registerCollisionNaturalSource } from '../collision/CollisionPlayerBridge.js';
import { TerrainMaterialBakeRuntime } from '../materials/TerrainMaterialBakeRuntime.js';
import { StylizedSurfaceView as StylizedSurfaceViewBase } from './StylizedSurfaceViewBase.js';
import { loadOptionalTreeVariants } from './loadOptionalTreeVariants.js';
import { installTerrainWaterQueries } from '../water/TerrainWaterQueries.js';

export class StylizedSurfaceView extends StylizedSurfaceViewBase {
  constructor(options) {
    super(options);
    installTerrainWaterQueries(options.terrainView);
    this.materialBakeRuntime = this.enabled && !this.impostorBakeMode && this.config.materialBake?.enabled
      ? new TerrainMaterialBakeRuntime({
        terrainView: options.terrainView,
        revisionTracker: this.revisionTracker,
        config: this.config.materialBake,
      })
      : null;
    this.collisionSourceDisposed = false;
    this.releaseCollisionNaturalSource = null;
    this.ready = this.ready.then((result) => {
      if (!this.collisionSourceDisposed
          && !this.impostorBakeMode
          && (this.treeView?.manifestStore || this.rockView)) {
        this.releaseCollisionNaturalSource = registerCollisionNaturalSource({
          treeView: this.treeView?.manifestStore ? this.treeView : null,
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

  update(timestamp, camera) {
    super.update(timestamp, camera);
    this.materialBakeRuntime?.update();
  }

  dispose() {
    this.materialBakeRuntime?.dispose();
    this.materialBakeRuntime = null;
    this.collisionSourceDisposed = true;
    this.releaseCollisionNaturalSource?.();
    this.releaseCollisionNaturalSource = null;
    super.dispose();
  }
}
