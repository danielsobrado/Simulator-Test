import * as THREE from 'three/webgpu';
import { TILE_CATALOG } from '../tileCatalog.js';
import { disposeModelParts } from '../assets/modelParts.js';
import { unregisterProceduralDefinitions } from './ProceduralDefinitionLifecycle.js';
import { ProceduralAssetStore } from './ProceduralAssetStore.js';
import { createProceduralWorkshopComponentParts } from './ProceduralWorkshopComponentParts.js';
import { filterComponentTransforms } from './ProceduralWorkshopComponentTransforms.js';

const CASTLE_WALL_WIDTH_PADDING = 0.7;
const CASTLE_WALL_DEPTH_FACTOR = 2.3;

const TERRAIN_CLASSES = Object.freeze([
  'ocean', 'plains', 'forest', 'desert', 'wetland', 'tundra', 'ice',
  'road', 'stone', 'corruption',
]);

function authoredFootprint(parts, tileSize) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const geometryBounds = part.geometry.boundingBox?.clone();
    if (!geometryBounds || geometryBounds.isEmpty()) continue;
    geometryBounds.applyMatrix4(part.matrix ?? new THREE.Matrix4());
    bounds.union(geometryBounds);
  }
  if (bounds.isEmpty()) return Object.freeze({ width: 1, depth: 1 });

  const symmetricWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) * 2;
  const symmetricDepth = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) * 2;
  return Object.freeze({
    width: Math.max(1, Math.ceil(symmetricWidth / tileSize)),
    depth: Math.max(1, Math.ceil(symmetricDepth / tileSize)),
  });
}

function definitionFor(record, tileSize, parts) {
  const { recipe } = record;
  const manorLike = recipe.archetype === 'manor';
  const castleWallLike = recipe.archetype === 'wall' && recipe.shape !== 'classic';
  const manorTowerRadius = Math.max(1.25, Math.min(2.15, recipe.width * 0.22));
  const manorDepth = Math.max(3.2, Math.min(7.5, recipe.depth * 2.2));
  const manorHasTower = manorLike && recipe.towerSide !== 'none';
  const radiusWidth = recipe.archetype === 'gatehouse'
    ? recipe.width + recipe.depth * 1.4
    : manorHasTower
      ? recipe.width + manorTowerRadius * 0.62
      : castleWallLike ? recipe.width + CASTLE_WALL_WIDTH_PADDING : recipe.width;
  const formulaWidth = Math.max(1, Math.ceil(radiusWidth / tileSize));
  const towerLike = recipe.archetype === 'tower' || recipe.archetype === 'square-tower';
  const formulaDepth = Math.max(1, Math.ceil(
    (
      towerLike
        ? recipe.width
        : manorLike
          ? manorDepth + (manorHasTower ? manorTowerRadius * 0.82 : 0)
          : castleWallLike ? recipe.depth * CASTLE_WALL_DEPTH_FACTOR : recipe.depth
    ) / tileSize,
  ));
  const authored = authoredFootprint(parts, tileSize);
  const footprintWidth = Math.max(formulaWidth, authored.width);
  const footprintDepth = Math.max(formulaDepth, authored.depth);
  return Object.freeze({
    key: record.key,
    label: record.label,
    icon: manorLike
      ? '🏡'
      : towerLike
        ? '🗼'
        : recipe.archetype === 'gatehouse'
          ? '🏯'
          : castleWallLike ? '🏰' : '🧱',
    category: 'workshop',
    color: recipe.finish === 'ochre'
      ? '#d9a13b'
      : recipe.finish === 'limewash'
        ? '#d9d0ae'
        : recipe.finish === 'rose'
          ? '#bb7564'
          : recipe.style === 'sandstone'
            ? '#b7774f'
            : recipe.style === 'limestone' ? '#b9a983' : '#858b8e',
    model: 'workshop',
    footprint: Object.freeze({ width: footprintWidth, depth: footprintDepth }),
    foundation: Object.freeze({
      mode: 'terrace',
      maxSlopeDegrees: 18,
      maxDepth: 4,
      alignToNormal: false,
      color: '#615b50',
    }),
    allowedTileIds: Object.freeze(TILE_CATALOG.map((tile) => tile.id).filter((id) => id !== 0)),
    allowedTerrainClasses: TERRAIN_CLASSES,
    procedural: true,
    workshopSemantics: parts.semantics ?? null,
    workshopStatistics: parts.stats ?? null,
  });
}

function validComponentIds(parts) {
  return new Set((parts.components ?? []).map(({ id }) => id));
}

export class ProceduralAssetManager {
  constructor({ tileSize, objectMap, objectView, ui }) {
    this.tileSize = tileSize;
    this.objectMap = objectMap;
    this.objectView = objectView;
    this.ui = ui;
    this.store = new ProceduralAssetStore();
    this.definitions = new Map();
  }

  prepareCreate(input) {
    const source = input ?? {};
    const sourceRecipe = source.recipe ?? {};
    const parts = createProceduralWorkshopComponentParts(sourceRecipe);
    try {
      return {
        input: {
          ...source,
          recipe: {
            ...sourceRecipe,
            componentTransforms: filterComponentTransforms(
              sourceRecipe.componentTransforms,
              validComponentIds(parts),
            ),
          },
        },
        parts,
      };
    } catch (error) {
      disposeModelParts(parts);
      throw error;
    }
  }

  create(input) {
    const previous = this.store.toDocument();
    const prepared = this.prepareCreate(input);
    let record = null;
    let unownedParts = prepared.parts;
    try {
      record = this.store.add(prepared.input);
      const ownedParts = unownedParts;
      unownedParts = null;
      this.install(record, ownedParts);
      this.syncUi();
      return record;
    } catch (error) {
      if (unownedParts) disposeModelParts(unownedParts);
      if (record) this.restore(previous, error);
      throw error;
    }
  }

  createPreviewParts(recipe) {
    return createProceduralWorkshopComponentParts(recipe, { preserveComponents: true });
  }

  cleanupFailedInstall(definition, parts) {
    const renderer = this.objectView.renderers.get(definition.key);
    if (renderer?.parts === parts) {
      unregisterProceduralDefinitions({
        objectMap: this.objectMap,
        objectView: this.objectView,
        definitionKeys: [definition.key],
      });
      return;
    }
    const viewDefinition = this.objectView.definitionByKey.get(definition.key);
    if (viewDefinition?.procedural === true) {
      this.objectView.definitionByKey.delete(definition.key);
    }
    const mapDefinition = this.objectMap.definitionByKey.get(definition.key);
    if (mapDefinition?.procedural === true) {
      this.objectMap.definitionByKey.delete(definition.key);
    }
    disposeModelParts(parts);
  }

  install(record, preparedParts = null) {
    const parts = preparedParts ?? createProceduralWorkshopComponentParts(record.recipe);
    let definition;
    try {
      definition = definitionFor(record, this.tileSize, parts);
      this.objectMap.registerDefinition(definition);
      this.objectView.registerDefinition(definition, parts);
    } catch (error) {
      try {
        if (definition) this.cleanupFailedInstall(definition, parts);
        else disposeModelParts(parts);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to install or clean up procedural object ${record.key}.`,
        );
      }
      throw error;
    }
    this.definitions.set(definition.key, definition);
    return definition;
  }

  clearInstalled() {
    unregisterProceduralDefinitions({
      objectMap: this.objectMap,
      objectView: this.objectView,
      definitionKeys: this.definitions.keys(),
    });
    this.definitions.clear();
  }

  rebuild(records) {
    this.clearInstalled();
    this.store.replaceAll(records ?? []);
    for (const record of this.store.list()) {
      this.install(record);
    }
    this.syncUi();
  }

  restore(previous, originalError) {
    try {
      this.rebuild(previous);
    } catch (rollbackError) {
      throw new AggregateError(
        [originalError, rollbackError],
        'The workshop asset change failed and could not be rolled back.',
      );
    }
    throw originalError;
  }

  replaceAll(records) {
    const previous = this.store.toDocument();
    try {
      this.rebuild(records ?? []);
    } catch (error) {
      this.restore(previous, error);
    }
  }

  syncUi() {
    this.ui.setProceduralObjectDefinitions(
      this.store.list().map((record) => this.definitions.get(record.key)).filter(Boolean),
    );
  }

  toDocument() {
    return this.store.toDocument();
  }
}
