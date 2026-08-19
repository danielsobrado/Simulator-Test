export const WORKSHOP_RELATIONSHIP_TYPES = Object.freeze([
  'PARENT',
  'DEPENDENCY',
]);

const TYPE_ORDER = new Map(WORKSHOP_RELATIONSHIP_TYPES.map((type, index) => [type, index]));

function normalizeDocument(document) {
  if (!document || typeof document.listEntities !== 'function' || typeof document.hasEntity !== 'function') {
    throw new Error('Workshop relationship graph requires a workshop document.');
  }
  return document;
}

function compareEdges(left, right) {
  return left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || TYPE_ORDER.get(left.type) - TYPE_ORDER.get(right.type);
}

export class WorkshopRelationshipGraph {
  #outgoing = new Map();
  #incoming = new Map();
  #edges;

  constructor(documentInput) {
    this.document = normalizeDocument(documentInput);
    const edges = [];
    for (const entity of this.document.listEntities()) {
      this.#outgoing.set(entity.id, []);
      this.#incoming.set(entity.id, []);
    }
    for (const entity of this.document.listEntities()) {
      if (entity.parentId) edges.push({ type: 'PARENT', from: entity.parentId, to: entity.id });
      for (const dependency of entity.dependsOn) {
        edges.push({ type: 'DEPENDENCY', from: dependency, to: entity.id });
      }
    }
    edges.sort(compareEdges);
    for (const edge of edges) {
      const frozen = Object.freeze(edge);
      this.#outgoing.get(edge.from)?.push(frozen);
      this.#incoming.get(edge.to)?.push(frozen);
    }
    this.#edges = Object.freeze(edges.map((edge) => Object.freeze({ ...edge })));
    Object.freeze(this);
  }

  edges(type = null) {
    if (type === null) return this.#edges;
    if (!TYPE_ORDER.has(type)) throw new Error(`Unknown workshop relationship type: ${type}.`);
    return Object.freeze(this.#edges.filter((edge) => edge.type === type));
  }

  outgoing(entityId, type = null) {
    const edges = this.#outgoing.get(entityId) ?? [];
    return Object.freeze(type === null ? [...edges] : edges.filter((edge) => edge.type === type));
  }

  incoming(entityId, type = null) {
    const edges = this.#incoming.get(entityId) ?? [];
    return Object.freeze(type === null ? [...edges] : edges.filter((edge) => edge.type === type));
  }

  related(entityId, { direction = 'outgoing', type = null } = {}) {
    const edges = direction === 'incoming'
      ? this.incoming(entityId, type)
      : this.outgoing(entityId, type);
    const ids = edges.map((edge) => direction === 'incoming' ? edge.from : edge.to);
    return Object.freeze([...new Set(ids)].sort());
  }
}
