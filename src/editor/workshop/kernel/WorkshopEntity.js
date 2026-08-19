import {
  WORKSHOP_ENTITY_ID_PATTERN,
  WORKSHOP_ENTITY_TYPE_PATTERN,
} from './WorkshopKernelConstants.js';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue(value, field) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} numbers must be finite.`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => cloneJsonValue(entry, `${field}[${index}]`)));
  }
  if (!isPlainObject(value)) throw new Error(`${field} must contain JSON-compatible values.`);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new Error(`${field}.${key} cannot be undefined.`);
    result[key] = cloneJsonValue(value[key], `${field}.${key}`);
  }
  return Object.freeze(result);
}

function requireId(value, field) {
  if (typeof value !== 'string' || !WORKSHOP_ENTITY_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be a stable workshop entity id.`);
  }
  return value;
}

function requireType(value) {
  if (typeof value !== 'string' || !WORKSHOP_ENTITY_TYPE_PATTERN.test(value)) {
    throw new Error('Workshop entity type is invalid.');
  }
  return value;
}

function normalizeDependencies(input, entityId) {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) throw new Error('Workshop entity dependencies must be an array.');
  const dependencies = [...new Set(input.map((value) => requireId(value, 'Workshop dependency id')))]
    .sort();
  if (dependencies.includes(entityId)) throw new Error(`Workshop entity ${entityId} cannot depend on itself.`);
  return Object.freeze(dependencies);
}

export class WorkshopEntity {
  constructor(input) {
    if (!isPlainObject(input)) throw new Error('Workshop entity must be an object.');
    const id = requireId(input.id, 'Workshop entity id');
    const parentId = input.parentId == null ? null : requireId(input.parentId, 'Workshop parent id');
    if (parentId === id) throw new Error(`Workshop entity ${id} cannot parent itself.`);

    this.id = id;
    this.type = requireType(input.type);
    this.parentId = parentId;
    this.properties = cloneJsonValue(input.properties ?? {}, `Workshop entity ${id} properties`);
    this.dependsOn = normalizeDependencies(input.dependsOn, id);
    Object.freeze(this);
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      parentId: this.parentId,
      properties: this.properties,
      dependsOn: [...this.dependsOn],
    };
  }
}

export function normalizeWorkshopEntity(input) {
  return input instanceof WorkshopEntity ? input : new WorkshopEntity(input);
}

export function cloneWorkshopProperties(input, field = 'Workshop properties') {
  return cloneJsonValue(input, field);
}
