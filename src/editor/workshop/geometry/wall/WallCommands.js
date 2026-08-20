import { WorkshopPatch } from '../../kernel/WorkshopPatch.js';
import {
  normalizeWallDefinition,
  serializeWallDefinition,
  wallDefinitionToLegacyPrimitive,
} from './WallPath.js';

export const WALL_SET_DEFINITION_COMMAND = 'wall.set-definition';

export function registerWallCommands(bus) {
  if (!bus || typeof bus.register !== 'function') throw new Error('Wall commands require a workshop command bus.');
  return bus.register(WALL_SET_DEFINITION_COMMAND, ({ command, document }) => {
    const entity = document.getEntity(command.entityId);
    if (!entity || entity.type !== 'composition-wall') {
      throw new Error(`Unknown semantic wall entity: ${command.entityId}.`);
    }
    const wall = normalizeWallDefinition(command.wall);
    if (entity.id !== `composition:${wall.id}`) {
      throw new Error('Wall command identity does not match the target entity.');
    }
    const serializedWall = serializeWallDefinition(wall);
    const primitive = wallDefinitionToLegacyPrimitive(wall);
    return new WorkshopPatch({
      label: command.label ?? 'Update wall',
      operations: [{
        op: 'put',
        entity: {
          ...entity.toJSON(),
          properties: {
            ...entity.properties,
            primitive,
            wall: serializedWall,
          },
        },
      }],
    });
  });
}
