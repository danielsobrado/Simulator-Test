import { EditorController } from './EditorController.js';
import { evaluateObjectSurface } from './TerrainPlacement.js';
import { createWorldDocument, loadWorldDocument } from './WorldDocument.js';
import { worldToCell } from './world/WorldCoordinates.js';

function cloneCampaign(campaign) {
  return campaign ? structuredClone(campaign) : null;
}

export class TerrainAwareEditorController extends EditorController {
  constructor(options) {
    super(options);
    this.voxelStampStore = options.voxelStampStore ?? null;
    this.worldStore = options.worldStore ?? options.tileMap?.worldStore ?? null;
    this.campaign = null;
    this.importWarnings = [];
    this.focusProvider = null;
    this.proceduralAssetManager = options.proceduralAssetManager ?? null;
    this.biomeAssetPalette = options.biomeAssetPalette ?? null;
    this.sceneSettingsProvider = null;
    this.sceneSettingsConsumer = null;
    this.inventoryStore = options.inventoryStore ?? null;
  }

  getState() {
    return {
      ...super.getState(),
      voxelStampCount: this.voxelStampStore?.size ?? 0,
      worldStats: this.worldStore?.getStats() ?? null,
      campaignSource: this.campaign?.source ?? null,
    };
  }

  getFocusCell() {
    const canonical = this.focusProvider
      ? this.focusProvider()
      : (() => {
        const renderFocus = this.editorCamera.getFocusWorld();
        return this.terrainView.floatingOrigin
          ? this.terrainView.floatingOrigin.toCanonical(renderFocus.x, renderFocus.z)
          : renderFocus;
      })();
    return worldToCell(canonical.x, canonical.z, this.tileMap.tileSize);
  }

  validateObjectPlacement({ definitionKey, x, z, rotation, ignoreObjectId = null }) {
    const objectValidation = this.objectMap.validatePlacement({
      definitionKey,
      x,
      z,
      rotation,
      ignoreObjectId,
    });
    if (!objectValidation.valid) {
      return objectValidation;
    }

    const definition = this.objectMap.getDefinition(definitionKey);
    const bounds = this.objectMap.getBounds(x, z, definitionKey, rotation);
    return evaluateObjectSurface({
      definition,
      heightField: this.heightField,
      bounds,
      tileSize: this.tileMap.tileSize,
    });
  }

  rotateSelected() {
    const before = this.selectedObjectId
      ? this.objectMap.getById(this.selectedObjectId)
      : null;
    if (!before) {
      return;
    }

    const rotation = before.rotation + 1;
    const validation = this.validateObjectPlacement({
      definitionKey: before.definitionKey,
      x: before.x,
      z: before.z,
      rotation,
      ignoreObjectId: before.id,
    });
    if (!validation.valid) {
      this.emitNotice(validation.reason, true);
      return;
    }

    try {
      const after = this.objectMap.transform(before.id, {
        x: before.x,
        z: before.z,
        rotation,
      });
      this.commitHistory({ kind: 'object', before, after });
      this.refreshObjects();
      this.emitMap();
    } catch (error) {
      this.emitNotice(error.message, true);
    }
  }

  addVoxelStamp(input) {
    if (!this.voxelStampStore) {
      throw new Error('Voxel stamp storage is unavailable.');
    }
    const after = this.voxelStampStore.add(input);
    this.commitHistory({ kind: 'voxel-stamp', before: null, after });
    this.emitMap();
    return after;
  }

  clearVoxelStamps() {
    if (!this.voxelStampStore) {
      return;
    }
    const before = this.voxelStampStore.clear();
    if (before.length === 0) {
      return;
    }
    this.commitHistory({ kind: 'voxel-stamps', before, after: [] });
    this.emitMap();
  }

  applyHistory(entry, direction) {
    if (entry.kind === 'voxel-stamp') {
      this.voxelStampStore.applyChange(entry, direction);
      return;
    }
    if (entry.kind === 'voxel-stamps') {
      this.voxelStampStore.replaceAll(direction === 'undo' ? entry.before : entry.after);
      return;
    }
    if (entry.kind === 'infinite-world') {
      this.worldStore.restoreSnapshot(
        direction === 'undo' ? entry.beforeWorld : entry.afterWorld,
      );
      this.objectMap.replaceAll(
        direction === 'undo' ? entry.beforeObjects : entry.afterObjects,
      );
      this.voxelStampStore?.replaceAll(
        direction === 'undo' ? entry.beforeVoxelStamps : entry.afterVoxelStamps,
      );
      this.constructionStore?.replaceAll(
        direction === 'undo' ? entry.beforeConstructions : entry.afterConstructions,
      );
      this.campaign = cloneCampaign(
        direction === 'undo' ? entry.beforeCampaign : entry.afterCampaign,
      );
      this.importWarnings = direction === 'undo'
        ? [...(entry.beforeImportWarnings ?? [])]
        : [...(entry.afterImportWarnings ?? [])];
      this.setSelectedObject(null);
      this.setSelectedConstruction(null);
      this.terrainView.refreshAll();
      this.refreshObjects();
      return;
    }

    super.applyHistory(entry, direction);
    if (entry.kind === 'world' && this.voxelStampStore) {
      this.voxelStampStore.replaceAll(
        direction === 'undo' ? entry.beforeVoxelStamps : entry.afterVoxelStamps,
      );
    }
  }

  clearWorld() {
    if (!this.worldStore) {
      throw new Error('Clearing the world requires an infinite world store.');
    }
    const beforeWorld = this.worldStore.createSnapshot();
    const beforeObjects = this.objectMap.clear();
    const beforeVoxelStamps = this.voxelStampStore?.clear() ?? [];
    const beforeConstructions = this.constructionStore?.clear() ?? [];
    const beforeCampaign = cloneCampaign(this.campaign);
    const beforeImportWarnings = [...this.importWarnings];
    if (beforeWorld.tileOverrides.length === 0
        && beforeWorld.heightOverrides.length === 0
        && beforeObjects.length === 0
        && beforeVoxelStamps.length === 0
        && beforeConstructions.length === 0
        && !beforeCampaign) {
      return;
    }
    this.worldStore.clearOverrides();
    this.campaign = null;
    this.importWarnings = [];
    const afterWorld = this.worldStore.createSnapshot();
    this.commitHistory({
      kind: 'infinite-world',
      beforeWorld,
      afterWorld,
      beforeObjects,
      afterObjects: [],
      beforeVoxelStamps,
      afterVoxelStamps: [],
      beforeConstructions,
      afterConstructions: [],
      beforeCampaign,
      afterCampaign: null,
      beforeImportWarnings,
      afterImportWarnings: [],
    });
    this.setSelectedObject(null);
    this.setSelectedConstruction(null);
    this.terrainView.refreshAll();
    this.refreshObjects();
    this.emitMap();
  }

  toDocument() {
    return {
      ...createWorldDocument(
        this.tileMap,
        this.heightField,
        this.objectMap,
        this.voxelStampStore,
      ),
      ...(this.campaign ? { campaign: cloneCampaign(this.campaign) } : {}),
      ...(this.importWarnings.length > 0 ? { importWarnings: [...this.importWarnings] } : {}),
      ...(this.proceduralAssetManager
        ? { proceduralAssets: this.proceduralAssetManager.toDocument() }
        : {}),
      ...(this.constructionStore
        ? { constructions: this.constructionStore.toDocument() }
        : {}),
      ...(this.constructionMaterialStore
        ? {
          // GC before serializing: the material document's own normalizer
          // collects presets nothing in *that document* references, and a
          // preset used only by a wall record is invisible to it. Projecting
          // each record's choice into the overrides makes the reference visible
          // so an imported image survives the round trip.
          constructionMaterials: (() => {
            this.constructionMaterialStore.gc(this.constructionStore?.list() ?? []);
            return this.constructionMaterialStore.toDocument();
          })(),
        }
        : {}),
      ...(this.biomeAssetPalette
        ? {
          visualConfig: {
            biomeAssets: this.biomeAssetPalette.toDocument(),
            ...(this.sceneSettingsProvider
              ? { sceneSettings: this.sceneSettingsProvider() }
              : {}),
          },
        }
        : {}),
      ...(this.inventoryStore
        ? { playerState: { inventory: this.inventoryStore.toDocument() } }
        : {}),
    };
  }

  loadDocument(document, { preserveInventory = false } = {}) {
    const previousProceduralAssets = this.proceduralAssetManager?.toDocument() ?? null;
    const previousConstructions = this.constructionStore?.toDocument() ?? null;
    const previousConstructionMaterials = this.constructionMaterialStore?.toDocument() ?? null;
    const previousBiomeAssets = this.biomeAssetPalette?.toDocument() ?? null;
    const previousSceneSettings = this.sceneSettingsProvider?.() ?? null;
    const previousInventory = this.inventoryStore?.toDocument() ?? null;
    let inventoryCommitted = false;
    try {
      if (this.inventoryStore) {
        const incoming = document.playerState?.inventory;
        if (preserveInventory && incoming == null) {
          // Keep the live player inventory across Azgaar / terrain-only imports.
        } else if (incoming != null) {
          this.inventoryStore.replaceDocument(incoming, { emit: false });
          inventoryCommitted = true;
        } else {
          this.inventoryStore.replaceDocument(null, { emit: false });
          inventoryCommitted = true;
        }
      }
      this.proceduralAssetManager?.replaceAll(document.proceduralAssets ?? []);
      // Materials load before the records that reference them, so a record's
      // preset id resolves the moment its geometry is built.
      this.constructionMaterialStore?.loadDocument(document.constructionMaterials ?? null);
      this.constructionStore?.replaceAll(document.constructions ?? []);
      if (document.visualConfig?.sceneSettings && this.sceneSettingsConsumer) {
        this.sceneSettingsConsumer(document.visualConfig.sceneSettings);
      } else if (document.visualConfig?.biomeAssets) {
        this.biomeAssetPalette?.replaceDocument(document.visualConfig.biomeAssets);
      } else {
        this.biomeAssetPalette?.reset();
      }
      loadWorldDocument(
        document,
        this.tileMap,
        this.heightField,
        this.objectMap,
        this.voxelStampStore,
        () => this.validateLoadedObjectSurfaces(),
      );
      if (inventoryCommitted) {
        this.inventoryStore.emit({
          kind: 'replace',
          before: previousInventory,
          after: this.inventoryStore.toDocument(),
        });
      }
    } catch (error) {
      if (previousProceduralAssets) {
        this.proceduralAssetManager.replaceAll(previousProceduralAssets);
      }
      if (previousConstructions) {
        this.constructionStore.replaceAll(previousConstructions);
      }
      if (previousConstructionMaterials) {
        this.constructionMaterialStore.loadDocument(previousConstructionMaterials);
      }
      if (previousBiomeAssets) {
        this.biomeAssetPalette.replaceDocument(previousBiomeAssets);
      }
      if (previousSceneSettings && this.sceneSettingsConsumer) {
        this.sceneSettingsConsumer(previousSceneSettings);
      }
      if (inventoryCommitted && previousInventory && this.inventoryStore) {
        this.inventoryStore.replaceDocument(previousInventory, { emit: false });
      }
      throw error;
    }
    this.campaign = cloneCampaign(document.campaign);
    this.importWarnings = Array.isArray(document.importWarnings)
      ? [...document.importWarnings]
      : [];
    this.terrainView.refreshAll();
    this.refreshObjects();
    this.undoStack = [];
    this.redoStack = [];
    this.setSelectedObject(null);
    this.setSelectedConstruction(null);
    if (this.importWarnings.length > 0) {
      this.emitNotice(this.importWarnings.join(' '));
    }
    this.emitMap();
    this.emitState();
  }

  validateLoadedObjectSurfaces() {
    for (const object of this.objectMap.list()) {
      const validation = this.validateObjectPlacement({
        definitionKey: object.definitionKey,
        x: object.x,
        z: object.z,
        rotation: object.rotation,
        ignoreObjectId: object.id,
      });
      if (!validation.valid) {
        throw new Error(`Object ${object.id} has invalid terrain support: ${validation.reason}`);
      }
    }
  }
}
