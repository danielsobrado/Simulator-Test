import * as THREE from 'three/webgpu';
import { TILE_CATALOG } from '../tileCatalog.js';
import { disposeModelParts } from '../assets/modelParts.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
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

function partTriangleCount(parts) {
  return parts.reduce((total, part) => (
    total + (part.geometry.index?.count ?? part.geometry.getAttribute('position')?.count ?? 0) / 3
  ), 0);
}

const SHELL_SLOTS = Object.freeze(['mortar', 'roof', 'recess']);
/** The masonry envelope: what a viewer reads as the building's outer surface. */
const MASONRY_SLOTS = Object.freeze(['stone', 'mortar']);

function slotOf(part) {
  return part.material?.userData?.workshopSlot;
}

function partBounds(parts, { structuralOnly = false, slots = null } = {}) {
  const bounds = new THREE.Box3().makeEmpty();
  for (const part of parts) {
    const slot = slotOf(part);
    if (structuralOnly && slot === 'foliage') continue;
    if (slots && !slots.includes(slot)) continue;
    part.geometry.computeBoundingBox();
    if (!part.geometry.boundingBox) continue;
    bounds.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrix));
  }
  return bounds;
}

function envelopeDelta(left, right) {
  return Math.max(
    Math.abs(left.min.x - right.min.x),
    Math.abs(left.min.y - right.min.y),
    Math.abs(left.min.z - right.min.z),
    Math.abs(left.max.x - right.max.x),
    Math.abs(left.max.y - right.max.y),
    Math.abs(left.max.z - right.max.z),
  );
}

/**
 * Footprint-only envelope error.
 *
 * The shell tier is gated on this rather than the full envelope. Dropping
 * individual stones necessarily drops crenellations, merlons and finials with
 * them, so a shell is legitimately shorter than the near tier — a tower measures
 * 9.15 m to its battlements and 6.98 m to its wall head. Requiring height parity
 * would reject every masonry asset and delete the tier.
 *
 * A change of *footprint*, by contrast, reads as the building deflating, and
 * that is the defect this gate exists to catch.
 */
function footprintDelta(left, right) {
  return Math.max(
    Math.abs(left.min.x - right.min.x),
    Math.abs(left.min.z - right.min.z),
    Math.abs(left.max.x - right.max.x),
    Math.abs(left.max.z - right.max.z),
  );
}

/** Floor of the silhouette tolerance, for small assets. */
const ENVELOPE_TOLERANCE_FLOOR = 0.08;
/**
 * Silhouette tolerance also scales with the asset, because LOD error is judged
 * in screen space: a larger building is viewed from further away at the same
 * projected size, so the same absolute error subtends fewer pixels. A fixed
 * 0.08 m floor rejected the manor archetype over 0.13 m — about 1.6% of its
 * width, sub-pixel where the coarse tier actually runs — and cost a 19x
 * triangle reduction.
 */
const ENVELOPE_TOLERANCE_RATIO = 0.02;

function envelopeTolerance(bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  return Math.max(
    ENVELOPE_TOLERANCE_FLOOR,
    Math.max(size.x, size.y, size.z) * ENVELOPE_TOLERANCE_RATIO,
  );
}

/**
 * Build the shell tier from the coarse tier's structural families.
 *
 * The structural core is *inset* by construction — a tower's mortar cylinder
 * sits at `radius - depth * 0.46` — so taking it verbatim shrank a tower by
 * 2.16 m (about 22% of its width) the moment the shell band engaged, leaving the
 * roof overhanging a deflated core. The core is therefore expanded in X/Z to the
 * near tier's masonry envelope, which is what a viewer actually reads as the
 * building's outer surface.
 *
 * Geometry is cloned first: these parts alias the coarse tier, which must not be
 * transformed with them.
 */
function buildShellParts(coarse, nearParts) {
  const source = coarse.filter((part) => SHELL_SLOTS.includes(slotOf(part)));
  if (source.length === 0) return [];
  const shell = source.map((part) => ({ ...part, geometry: part.geometry.clone() }));

  const core = shell.filter((part) => slotOf(part) === 'mortar');
  const target = partBounds(nearParts, { slots: MASONRY_SLOTS });
  const current = partBounds(core);
  if (core.length === 0 || target.isEmpty() || current.isEmpty()) return shell;

  const targetSize = target.getSize(new THREE.Vector3());
  const currentSize = current.getSize(new THREE.Vector3());
  const scaleX = currentSize.x > 1e-4 ? targetSize.x / currentSize.x : 1;
  const scaleZ = currentSize.z > 1e-4 ? targetSize.z / currentSize.z : 1;
  // Only ever expand, and never wildly. A shrink or a large factor means the
  // inset-core assumption does not hold for this asset, so leave it alone and
  // let the envelope gate decide.
  if (!(scaleX >= 1 && scaleZ >= 1 && scaleX <= 2 && scaleZ <= 2)) return shell;

  const center = target.getCenter(new THREE.Vector3());
  const matrix = new THREE.Matrix4()
    .makeTranslation(center.x, 0, center.z)
    .multiply(new THREE.Matrix4().makeScale(scaleX, 1, scaleZ))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, 0, -center.z));
  for (const part of core) part.geometry.applyMatrix4(matrix);
  return shell;
}

export function createProceduralObjectLodParts(record, nearParts, config = {}) {
  if (config.enabled === false || record.recipe.detail <= 1) return null;
  const coarse = createProceduralWorkshopComponentParts({
    ...record.recipe,
    detail: 1,
    ivy: false,
  });
  const nearTriangles = partTriangleCount(nearParts);
  const coarseTriangles = partTriangleCount(coarse);
  const shell = buildShellParts(coarse, nearParts);

  const nearBounds = partBounds(nearParts, { structuralOnly: true });
  const tolerance = envelopeTolerance(nearBounds);
  const delta = envelopeDelta(nearBounds, partBounds(coarse, { structuralOnly: true }));
  // The shell is validated too. Previously only `coarse` was, so the tier with
  // by far the largest silhouette error was the one nothing checked — a tower
  // shrank by 2.16 m, about 22% of its width, with nothing to catch it.
  const nearMasonry = partBounds(nearParts, { slots: MASONRY_SLOTS });
  const shellCore = partBounds(shell.filter((part) => slotOf(part) === 'mortar'));
  const shellDelta = shell.length > 0 && !shellCore.isEmpty()
    ? footprintDelta(nearMasonry, shellCore)
    : Infinity;
  // Recorded, not gated: see `footprintDelta`.
  const shellHeightDelta = shell.length > 0
    ? Math.abs(nearBounds.max.y - partBounds(shell, { structuralOnly: true }).max.y)
    : 0;

  const reject = (counter) => {
    PerfCounters.inc(counter);
    disposeModelParts(coarse);
    for (const part of shell) part.geometry.dispose();
    return null;
  };
  if (delta > tolerance) return reject('objectLodRefusedCoarseEnvelope');
  if (coarseTriangles >= nearTriangles * 0.95) return reject('objectLodRefusedSaving');

  // The shell is an extra tier, not a precondition. A composite archetype whose
  // masonry envelope is driven by parts the core does not contain — a gatehouse,
  // where flanking towers are `stone` while the core is only the central wall —
  // cannot be represented by a scaled core, and no single factor reconciles the
  // two. Falling back to the coarse tier for the shell band keeps the silhouette
  // honest and still banks the coarse saving, which is the larger win.
  let shellParts = shell;
  if (shell.length === 0 || shellDelta > tolerance) {
    PerfCounters.inc(shell.length === 0
      ? 'objectLodShellEmptyUsedCoarse'
      : 'objectLodShellFootprintUsedCoarse');
    for (const part of shell) part.geometry.dispose();
    shellParts = coarse;
  }

  const shellTriangles = partTriangleCount(shellParts);
  return Object.freeze({
    coarse,
    shell: Object.freeze(shellParts),
    config: Object.freeze({
      nearPixels: config.nearPixels ?? 140,
      coarsePixels: config.coarsePixels ?? 35,
      hysteresisRatio: config.hysteresisRatio ?? 0.15,
      transitionMs: config.transitionMs ?? 240,
      fadeSteps: config.fadeSteps ?? 16,
    }),
    shadows: Object.freeze({
      near: config.near?.castShadow ?? true,
      coarse: config.coarse?.castShadow ?? true,
      shell: config.shell?.castShadow ?? false,
    }),
    statistics: Object.freeze({
      nearTriangles,
      coarseTriangles,
      shellTriangles,
      coarseRatio: coarseTriangles / nearTriangles,
      shellRatio: shellTriangles / nearTriangles,
      envelopeDelta: delta,
      shellFootprintDelta: shellDelta,
      shellHeightDelta,
      envelopeTolerance: tolerance,
    }),
  });
}

/**
 * Every part a LOD bundle owns, each listed once.
 *
 * The shell tier can legitimately *be* the coarse tier (see the fallback in
 * `createProceduralObjectLodParts`), so the two arrays must be deduplicated
 * before disposal rather than concatenated.
 */
function lodOwnedParts(lodParts) {
  if (!lodParts) return [];
  return [...new Set([...(lodParts.coarse ?? []), ...(lodParts.shell ?? [])])];
}

export class ProceduralAssetManager {
  constructor({ tileSize, objectMap, objectView, ui, lodConfig = null }) {
    this.tileSize = tileSize;
    this.objectMap = objectMap;
    this.objectView = objectView;
    this.ui = ui;
    this.lodConfig = lodConfig;
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

  cleanupFailedInstall(definition, parts, lodParts = null) {
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
    disposeModelParts([...parts, ...lodOwnedParts(lodParts)]);
  }

  install(record, preparedParts = null) {
    const parts = preparedParts ?? createProceduralWorkshopComponentParts(record.recipe);
    let lodParts = null;
    let definition;
    try {
      lodParts = createProceduralObjectLodParts(record, parts, this.lodConfig ?? {});
      definition = definitionFor(record, this.tileSize, parts);
      this.objectMap.registerDefinition(definition);
      this.objectView.registerDefinition(definition, parts, lodParts);
    } catch (error) {
      try {
        if (definition) this.cleanupFailedInstall(definition, parts, lodParts);
        else {
          disposeModelParts([...parts, ...lodOwnedParts(lodParts)]);
        }
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
