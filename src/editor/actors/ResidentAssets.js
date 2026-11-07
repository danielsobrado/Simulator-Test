import { createStylizedSceneLoader } from '../stylized/StylizedSceneAssetCache.js';
import { disposeScene, resolveAssetUrl } from '../assets/assetUrl.js';
import { normalizeActorGeometry } from './actorGeometry.js';
import { loadScenePreprocessing, NPC_LOD_RATIOS, npcStageKey, resolveStages } from './scenePreprocessing.js';

/** Shared template, decoder and baked LODs for every streamed resident. */
export class ResidentAssets {
  constructor({ renderer, roster, baseUrl, loader = null }) {
    Object.assign(this, { roster, baseUrl });
    const context = loader ? { loader, release: null } : createStylizedSceneLoader({ renderer });
    this.loader = context.loader;
    this.releaseKtx2 = context.release;
    this.templates = new Map();
    this.disposed = false;
    this.preprocessing = null;
  }
  load(kind) {
    if (this.templates.has(kind)) return this.templates.get(kind);
    const definition = this.roster[kind];
    if (!definition) return Promise.reject(new Error(`No resident character ${kind}.`));
    this.preprocessing ??= loadScenePreprocessing();
    const task = this.loader.loadAsync(resolveAssetUrl(this.baseUrl, definition.scene)).then(async gltf => {
      if (this.disposed) { disposeScene(gltf.scene); throw new Error('Residents disposed.'); }
      try {
        const geometries = [];
        gltf.scene.traverse(object => {
          if (object.isMesh && !geometries.includes(object.geometry)) {
            normalizeActorGeometry(object.geometry);
            geometries.push(object.geometry);
          }
        });
        const stages = await resolveStages(await this.preprocessing, definition.scene, geometries,
          NPC_LOD_RATIOS.filter(ratio => ratio < 1).map(ratio => [npcStageKey(ratio), { ratio }]));
        const lods = new Map(geometries.map((geometry, index) => [geometry,
          [geometry, ...NPC_LOD_RATIOS.slice(1).map(ratio => stages[index][npcStageKey(ratio)])]]));
        const dispose = () => {
          for (const [source, levels] of lods) for (const stage of new Set(levels)) if (stage !== source) stage.dispose();
          disposeScene(gltf.scene);
        };
        if (this.disposed) { dispose(); throw new Error('Residents disposed.'); }
        return { gltf, definition, lods, dispose };
      } catch (error) { disposeScene(gltf.scene); throw error; }
    });
    task.catch(() => { if (!this.disposed) this.templates.delete(kind); });
    this.templates.set(kind, task);
    return task;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.templates.values()) task.then(template => template.dispose()).catch(() => {});
    this.templates.clear(); this.releaseKtx2?.();
  }
}
