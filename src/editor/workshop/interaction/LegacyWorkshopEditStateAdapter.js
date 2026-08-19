import { cloneWorkshopProperties } from '../kernel/WorkshopEntity.js';

const STRUCTURED_TYPES = Object.freeze({
  componentTransforms: Object.freeze({ prefix: 'component-transform:', type: 'component-transform', key: 'componentId', value: 'transform' }),
  openingAttachments: Object.freeze({ prefix: 'opening-attachment:', type: 'opening-attachment', key: 'componentId', value: 'attachment' }),
  openingAssemblies: Object.freeze({ prefix: 'opening-assembly:', type: 'opening-assembly', key: 'assemblyId', value: 'assembly' }),
});

function entries(input) {
  if (input === undefined) return [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Legacy workshop edit state sections must be objects.');
  }
  return Object.entries(input).sort(([left], [right]) => left.localeCompare(right));
}

function putCommand(definition, sourceId, value, desiredAttachments) {
  const storedValue = cloneWorkshopProperties(value, `Legacy workshop ${definition.type} ${sourceId}`);
  const dependsOn = definition.type === 'opening-assembly'
    ? (storedValue.memberIds ?? [])
      .filter((memberId) => desiredAttachments.has(memberId))
      .map((memberId) => `opening-attachment:${memberId}`)
      .sort()
    : [];
  return Object.freeze({
    type: 'entity.put',
    entity: Object.freeze({
      id: `${definition.prefix}${sourceId}`,
      type: definition.type,
      parentId: 'recipe',
      properties: Object.freeze({
        [definition.key]: sourceId,
        [definition.value]: storedValue,
      }),
      dependsOn: Object.freeze(dependsOn),
    }),
  });
}

export function legacyWorkshopEditStateCommand(document, state, { label = 'Legacy workshop edit' } = {}) {
  if (!document || typeof document.listEntities !== 'function') {
    throw new Error('Legacy workshop edit adapter requires a workshop document.');
  }
  const desired = Object.fromEntries(Object.keys(STRUCTURED_TYPES).map((section) => [
    section,
    new Map(entries(state?.[section])),
  ]));
  const existing = Object.fromEntries(Object.keys(STRUCTURED_TYPES).map((section) => [section, new Map()]));
  const sectionByType = new Map(Object.entries(STRUCTURED_TYPES).map(([section, value]) => [value.type, section]));
  for (const entity of document.listEntities()) {
    const section = sectionByType.get(entity.type);
    if (!section) continue;
    const definition = STRUCTURED_TYPES[section];
    existing[section].set(entity.properties[definition.key], entity);
  }

  const commands = [];
  const desiredAttachments = desired.openingAttachments;
  for (const section of ['componentTransforms', 'openingAttachments', 'openingAssemblies']) {
    const definition = STRUCTURED_TYPES[section];
    for (const [sourceId, value] of desired[section]) {
      commands.push(putCommand(definition, sourceId, value, desiredAttachments));
    }
  }
  for (const section of ['openingAssemblies', 'openingAttachments', 'componentTransforms']) {
    for (const [sourceId, entity] of existing[section]) {
      if (!desired[section].has(sourceId)) {
        commands.push(Object.freeze({ type: 'entity.remove', id: entity.id }));
      }
    }
  }
  return Object.freeze({ type: 'document.batch', label, commands: Object.freeze(commands) });
}
