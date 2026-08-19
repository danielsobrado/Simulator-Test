export const WORKSHOP_DOCUMENT_VERSION = 1;

export const WORKSHOP_ENTITY_ID_PATTERN = /^[a-z][a-z0-9:-]{0,127}$/;
export const WORKSHOP_ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const WORKSHOP_COMMAND_TYPE_PATTERN = /^[a-z][a-z0-9.-]{0,95}$/;

export const WORKSHOP_RECIPE_ENTITY_ID = 'recipe';
export const WORKSHOP_RECIPE_ENTITY_TYPE = 'workshop-recipe';

export const WORKSHOP_KERNEL_COMMANDS = Object.freeze([
  'document.batch',
  'entity.put',
  'entity.remove',
  'entity.reparent',
  'entity.set-dependencies',
  'entity.set-properties',
]);
