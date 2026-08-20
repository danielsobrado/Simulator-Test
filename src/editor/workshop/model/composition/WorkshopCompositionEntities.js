import { serializeWorkshopComposition } from '../../ProceduralWorkshopComposition.js';
import {
  createWallDefinitionFromLegacyPrimitive,
  resolveWallDefinitionRecords,
  serializeWallDefinition,
  wallDefinitionToLegacyPrimitive,
} from '../../geometry/wall/WallPath.js';
import { WORKSHOP_RECIPE_ENTITY_ID } from '../../kernel/WorkshopKernelConstants.js';

export const WORKSHOP_COMPOSITION_ENTITY_PREFIX = 'composition:';

export function workshopCompositionEntityId(primitiveId) {
  if (typeof primitiveId !== 'string' || primitiveId.length === 0) {
    throw new Error('Workshop composition primitive id is required.');
  }
  return `${WORKSHOP_COMPOSITION_ENTITY_PREFIX}${primitiveId}`;
}

export function workshopCompositionPrimitiveId(entityId) {
  if (typeof entityId !== 'string' || !entityId.startsWith(WORKSHOP_COMPOSITION_ENTITY_PREFIX)) return null;
  const primitiveId = entityId.slice(WORKSHOP_COMPOSITION_ENTITY_PREFIX.length);
  return primitiveId.length > 0 ? primitiveId : null;
}

export function isWorkshopCompositionEntity(entity) {
  return Boolean(
    entity
    && typeof entity.type === 'string'
    && entity.type.startsWith('composition-')
    && workshopCompositionPrimitiveId(entity.id),
  );
}

function compositionProperties(primitive) {
  const properties = { primitive: Object.freeze(primitive) };
  if (primitive.kind === 'wall') {
    properties.wall = Object.freeze(serializeWallDefinition(createWallDefinitionFromLegacyPrimitive(primitive)));
  }
  return Object.freeze(properties);
}

export function createWorkshopCompositionEntities(input, parentId = WORKSHOP_RECIPE_ENTITY_ID) {
  const composition = serializeWorkshopComposition(input);
  return Object.freeze(composition.primitives.map((primitive) => Object.freeze({
    id: workshopCompositionEntityId(primitive.id),
    type: `composition-${primitive.kind}`,
    parentId,
    properties: compositionProperties(primitive),
    dependsOn: Object.freeze([]),
  })));
}

function primitiveForEntity(entity) {
  if (entity.type === 'composition-wall') {
    const wall = resolveWallDefinitionRecords(entity.properties?.wall, entity.properties?.primitive);
    return wallDefinitionToLegacyPrimitive(wall);
  }
  return entity.properties.primitive;
}

export function readWorkshopComposition(document, parentId = WORKSHOP_RECIPE_ENTITY_ID) {
  if (!document || typeof document.listEntities !== 'function') {
    throw new Error('Workshop composition projection requires a workshop document.');
  }
  const primitives = document.listEntities()
    .filter((entity) => entity.parentId === parentId && isWorkshopCompositionEntity(entity))
    .map(primitiveForEntity);
  return serializeWorkshopComposition({ version: 1, primitives });
}
