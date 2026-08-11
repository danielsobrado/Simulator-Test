import { INFINITE_WORLD_FORMAT_VERSION } from './world/worldConstants.js';

export const WORLD_COLLISION_SCHEMA_VERSION = 1;

function resolveWorldModels(heightFieldOrObjectMap, objectMap, voxelStampStore) {
  if (objectMap) {
    return {
      heightField: heightFieldOrObjectMap,
      objectMap,
      voxelStampStore: voxelStampStore ?? null,
    };
  }
  return {
    heightField: null,
    objectMap: heightFieldOrObjectMap,
    voxelStampStore: null,
  };
}

function resolveWorldStore(tileMap, heightField) {
  return tileMap?.worldStore ?? heightField?.worldStore ?? null;
}

function assertInfiniteWorldDocument(document) {
  if (document?.version !== INFINITE_WORLD_FORMAT_VERSION) {
    throw new Error(
      'This file uses an older dense map format that is no longer supported. '
      + 'Use a current infinite-world save, or import Azgaar Full JSON.',
    );
  }
}

function assertCollisionSchema(document) {
  const version = document?.collisionSchema?.version;
  if (version == null) return;
  if (version !== WORLD_COLLISION_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported world collision schema ${version}; expected ${WORLD_COLLISION_SCHEMA_VERSION}.`,
    );
  }
}

function createLoadSnapshot(worldStore) {
  if (typeof worldStore.createTransactionSnapshot === 'function'
      && typeof worldStore.restoreTransactionSnapshot === 'function') {
    return Object.freeze({
      kind: 'transaction',
      value: worldStore.createTransactionSnapshot(),
    });
  }
  return Object.freeze({
    kind: 'snapshot',
    value: worldStore.createSnapshot(),
  });
}

function restoreLoadSnapshot(worldStore, snapshot) {
  if (snapshot.kind === 'transaction') {
    worldStore.restoreTransactionSnapshot(snapshot.value);
    return;
  }
  worldStore.restoreSnapshot(snapshot.value);
}

export function createWorldDocument(
  tileMap,
  heightFieldOrObjectMap,
  objectMap = null,
  voxelStampStore = null,
) {
  const models = resolveWorldModels(heightFieldOrObjectMap, objectMap, voxelStampStore);
  const worldStore = resolveWorldStore(tileMap, models.heightField);
  if (!worldStore) {
    throw new Error('World documents require an infinite world store.');
  }
  return {
    ...worldStore.toDocument(),
    collisionSchema: Object.freeze({ version: WORLD_COLLISION_SCHEMA_VERSION }),
    objects: models.objectMap.toDocument(),
    ...(models.voxelStampStore
      ? {
        voxelWorld: models.voxelStampStore.toMetadata(),
        voxelStamps: models.voxelStampStore.toDocument(),
      }
      : {}),
  };
}

export function loadWorldDocument(
  document,
  tileMap,
  heightFieldOrObjectMap,
  objectMap = null,
  voxelStampStore = null,
  validate = null,
) {
  assertInfiniteWorldDocument(document);
  assertCollisionSchema(document);
  const models = resolveWorldModels(heightFieldOrObjectMap, objectMap, voxelStampStore);
  const worldStore = resolveWorldStore(tileMap, models.heightField);
  if (!worldStore) {
    throw new Error('World documents require an infinite world store.');
  }
  const previousWorld = createLoadSnapshot(worldStore);
  const previousObjects = models.objectMap.toDocument();
  const previousVoxelStamps = models.voxelStampStore?.toDocument() ?? null;

  try {
    worldStore.loadDocument(document);
    models.objectMap.loadDocument(document.objects ?? []);
    models.voxelStampStore?.loadDocument(document.voxelStamps ?? [], {
      sourceCells: document.voxelWorld?.cells ?? null,
      sourceUnboundedXZ: Boolean(document.voxelWorld?.unboundedXZ),
    });
    validate?.();
  } catch (error) {
    restoreLoadSnapshot(worldStore, previousWorld);
    models.objectMap.replaceAll(previousObjects);
    if (models.voxelStampStore && previousVoxelStamps) {
      models.voxelStampStore.replaceAll(previousVoxelStamps);
    }
    throw error;
  }
}
