import { WORKSHOP_DOCUMENT_VERSION } from './WorkshopKernelConstants.js';
import { normalizeWorkshopEntity } from './WorkshopEntity.js';

function requireRevision(value) {
  const revision = value ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Workshop document revision must be a non-negative safe integer.');
  }
  return revision;
}

function entityInputs(input) {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') return Object.values(input);
  throw new Error('Workshop document entities must be an array or object.');
}

function assertReferences(entities) {
  for (const entity of entities.values()) {
    if (entity.parentId && !entities.has(entity.parentId)) {
      throw new Error(`Workshop entity ${entity.id} has missing parent ${entity.parentId}.`);
    }
    for (const dependency of entity.dependsOn) {
      if (!entities.has(dependency)) {
        throw new Error(`Workshop entity ${entity.id} has missing dependency ${dependency}.`);
      }
    }
  }
}

function assertParentAcyclic(entities) {
  const visited = new Set();
  const visiting = new Set();

  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Workshop parent hierarchy contains a cycle at ${id}.`);
    visiting.add(id);
    const parentId = entities.get(id)?.parentId;
    if (parentId) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of entities.keys()) visit(id);
}

export class WorkshopDocument {
  #entities;

  constructor(input = {}) {
    if (input instanceof WorkshopDocument) return input;
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Workshop document must be an object.');
    }
    const version = input.version ?? WORKSHOP_DOCUMENT_VERSION;
    if (version !== WORKSHOP_DOCUMENT_VERSION) {
      throw new Error(`Unsupported workshop document version: ${version}.`);
    }

    const entities = new Map();
    for (const source of entityInputs(input.entities)) {
      const entity = normalizeWorkshopEntity(source);
      if (entities.has(entity.id)) throw new Error(`Duplicate workshop entity id: ${entity.id}.`);
      entities.set(entity.id, entity);
    }
    assertReferences(entities);
    assertParentAcyclic(entities);

    this.version = version;
    this.revision = requireRevision(input.revision);
    this.#entities = entities;
    Object.freeze(this);
  }

  get size() {
    return this.#entities.size;
  }

  hasEntity(id) {
    return this.#entities.has(id);
  }

  getEntity(id) {
    return this.#entities.get(id) ?? null;
  }

  listEntities() {
    return [...this.#entities.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  rootIds() {
    return this.listEntities().filter(({ parentId }) => parentId === null).map(({ id }) => id);
  }

  toJSON() {
    return {
      version: this.version,
      revision: this.revision,
      entities: this.listEntities().map((entity) => entity.toJSON()),
    };
  }
}

export function normalizeWorkshopDocument(input) {
  return input instanceof WorkshopDocument ? input : new WorkshopDocument(input);
}
