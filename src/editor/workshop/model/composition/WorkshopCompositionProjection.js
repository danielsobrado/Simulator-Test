import { planWorkshopComposition } from '../../ProceduralWorkshopComposition.js';
import { planWallEntity } from '../../geometry/wall/WallPlanner.js';
import { resolveWorkshopRecipe } from '../../kernel/WorkshopRecipeBridge.js';
import {
  isWorkshopCompositionEntity,
  workshopCompositionEntityId,
  workshopCompositionPrimitiveId,
} from './WorkshopCompositionEntities.js';

function freezeItems(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function rpgForPrimitive(rpg, primitiveId) {
  return Object.freeze({
    collisionSlabs: freezeItems(rpg.collisionSlabs.filter((item) => item.primitiveId === primitiveId)),
    walkableFloors: freezeItems(rpg.walkableFloors.filter((item) => item.primitiveId === primitiveId)),
    roomBoundaries: freezeItems(rpg.roomBoundaries.filter((item) => item.primitiveId === primitiveId)),
    portals: freezeItems(rpg.portals.filter((item) => item.primitiveId === primitiveId)),
    stairSockets: freezeItems(rpg.stairSockets.filter((item) => item.primitiveId === primitiveId)),
    foundationContacts: freezeItems(rpg.foundationContacts.filter((item) => item.primitiveId === primitiveId)),
    coverSurfaces: freezeItems(rpg.coverSurfaces.filter((item) => item.primitiveId === primitiveId)),
  });
}

export function projectWorkshopComposition(document, dirtyEntityIds = []) {
  if (!document || typeof document.listEntities !== 'function') {
    throw new Error('Workshop composition projection requires a workshop document.');
  }
  if (!Array.isArray(dirtyEntityIds)) throw new Error('Workshop dirty entity ids must be an array.');
  const entities = document.listEntities().filter(isWorkshopCompositionEntity);
  const currentIds = new Set(entities.map(({ id }) => id));
  const dirtyPrimitiveIds = [...new Set(dirtyEntityIds)]
    .filter((entityId) => currentIds.has(entityId))
    .map(workshopCompositionPrimitiveId)
    .sort();
  const recipe = resolveWorkshopRecipe(document);
  const plan = planWorkshopComposition(recipe, dirtyPrimitiveIds);
  const wallPlans = entities
    .filter(({ type, properties }) => type === 'composition-wall' && properties?.wall)
    .map((entity) => planWallEntity(entity));
  const wallPlanByEntity = new Map(wallPlans.map((wallPlan) => [
    workshopCompositionEntityId(wallPlan.wallId),
    wallPlan,
  ]));
  const byEntity = entities.map((entity) => {
    const primitiveId = workshopCompositionPrimitiveId(entity.id);
    return Object.freeze({
      entityId: entity.id,
      primitiveId,
      primitive: entity.properties.primitive,
      wallPlan: wallPlanByEntity.get(entity.id) ?? null,
      materialRegions: freezeItems(plan.materialRegions.filter((region) => region.primitiveId === primitiveId)),
      rpg: rpgForPrimitive(plan.rpg, primitiveId),
    });
  });

  return Object.freeze({
    version: plan.version,
    revisionKey: plan.revisionKey,
    dirtyEntityIds: Object.freeze(dirtyPrimitiveIds.map(workshopCompositionEntityId)),
    entityIds: Object.freeze(entities.map(({ id }) => id).sort()),
    materialRegions: plan.materialRegions,
    structural: plan.structural,
    attachments: plan.attachments,
    rpg: plan.rpg,
    wallPlans: Object.freeze(wallPlans.sort((left, right) => left.wallId.localeCompare(right.wallId))),
    byEntity: Object.freeze(byEntity.sort((left, right) => left.entityId.localeCompare(right.entityId))),
  });
}
