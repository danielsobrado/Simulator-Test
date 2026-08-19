import { cloneWorkshopProperties, normalizeWorkshopEntity } from '../kernel/WorkshopEntity.js';

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

function entityDefinition(definition, sourceId, value, desiredAttachments) {
  const storedValue = cloneWorkshopProperties(value, `Legacy workshop ${definition.type} ${sourceId}`);
  const dependsOn = definition.type === 'opening-assembly'
    ? (storedValue.memberIds ?? [])
      .filter((memberId) => desiredAttachments.has(memberId))
      .map((memberId) => `opening-attachment:${memberId}`)
      .sort()
    : [];
  return Object.freeze({
    id: `${definition.prefix}${sourceId}`,
    type: definition.type,
    parentId: 'recipe',
    properties: Object.freeze({
      [definition.key]: sourceId,
      [definition.value]: storedValue,
    }),
    dependsOn: Object.freeze(dependsOn),
  });
}

function sameEntity(existing, candidate) {
  return Boolean(existing)
    && JSON.stringify(existing.toJSON()) === JSON.stringify(normalizeWorkshopEntity(candidate).toJSON());
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
      const entity = entityDefinition(definition, sourceId, value, desiredAttachments);
      if (sameEntity(existing[section].get(sourceId), entity)) continue;
      commands.push(Object.freeze({ type: 'entity.put', entity }));
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

export function legacyWorkshopEditStateFromDocument(document) {
  if (!document || typeof document.listEntities !== 'function') {
    throw new Error('Legacy workshop edit state projection requires a workshop document.');
  }
  const state = Object.fromEntries(Object.keys(STRUCTURED_TYPES).map((section) => [section, {}]));
  const sectionByType = new Map(Object.entries(STRUCTURED_TYPES).map(([section, value]) => [value.type, section]));
  for (const entity of document.listEntities()) {
    const section = sectionByType.get(entity.type);
    if (!section) continue;
    const definition = STRUCTURED_TYPES[section];
    const sourceId = entity.properties[definition.key];
    if (typeof sourceId !== 'string' || sourceId.length === 0) {
      throw new Error(`Legacy workshop ${definition.type} entity is missing its source id.`);
    }
    state[section][sourceId] = entity.properties[definition.value];
  }
  return cloneWorkshopProperties(state, 'Legacy workshop edit state');
}
