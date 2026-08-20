import { planWorkshopComposition } from '../../ProceduralWorkshopComposition.js';
import { planWallEntity } from '../../geometry/wall/WallPlanner.js';
import { resolveWorkshopRecipe } from '../../kernel/WorkshopRecipeBridge.js';
import {
  isWorkshopCompositionEntity,
  workshopCompositionEntityId,
  workshopCompositionPrimitiveId,
} from './WorkshopCompositionEntities.js';

const RPG_FIELDS = Object.freeze([
  'collisionSlabs',
  'walkableFloors',
  'roomBoundaries',
  'portals',
  'stairSockets',
  'foundationContacts',
  'coverSurfaces',
]);

function freezeItems(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function projectionRpgItem(item, wallId) {
  const { wallId: _wallId, segmentId: _segmentId, ...projected } = item;
  return { ...projected, primitiveId: projected.primitiveId ?? wallId };
}

function mergeWallRpg(legacyRpg, wallPlans) {
  const semanticWallIds = new Set(wallPlans.map(({ wallId }) => wallId));
  return Object.freeze(Object.fromEntries(RPG_FIELDS.map((field) => {
    const retained = (legacyRpg[field] ?? []).filter(({ primitiveId }) => !semanticWallIds.has(primitiveId));
    const semantic = wallPlans.flatMap((wallPlan) => (
      (wallPlan.rpg[field] ?? []).map((item) => projectionRpgItem(item, wallPlan.wallId))
    ));
    return [field, freezeItems([...retained, ...semantic].sort((left, right) => left.id.localeCompare(right.id)))];
  })));
}

function rpgForPrimitive(rpg, primitiveId) {
  return Object.freeze(Object.fromEntries(RPG_FIELDS.map((field) => [
    field,
    freezeItems((rpg[field] ?? []).filter((item) => item.primitiveId === primitiveId)),
  ])));
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
    .map((entity) => planWallEntity(entity))
    .sort((left, right) => left.wallId.localeCompare(right.wallId));
  const rpg = mergeWallRpg(plan.rpg, wallPlans);
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
      rpg: rpgForPrimitive(rpg, primitiveId),
    });
  });
  const revisionKey = JSON.stringify([
    plan.revisionKey,
    wallPlans.map(({ wallId, revisionKey: wallRevisionKey }) => [wallId, wallRevisionKey]),
  ]);

  return Object.freeze({
    version: plan.version,
    recipe: plan.recipe,
    revisionKey,
    dirtyEntityIds: Object.freeze(dirtyPrimitiveIds.map(workshopCompositionEntityId)),
    entityIds: Object.freeze(entities.map(({ id }) => id).sort()),
    materialRegions: plan.materialRegions,
    structural: plan.structural,
    attachments: plan.attachments,
    rpg,
    wallPlans: Object.freeze(wallPlans),
    byEntity: Object.freeze(byEntity.sort((left, right) => left.entityId.localeCompare(right.entityId))),
  });
}
