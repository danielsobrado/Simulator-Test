import { WorkshopRelationshipGraph } from '../relationships/WorkshopRelationshipGraph.js';
import {
  dirtyDomainOrder,
  domainsForWorkshopEntityChange,
  normalizeDirtyDomains,
} from './WorkshopDirtyDomains.js';

const PARENT_PROPAGATED_DOMAINS = new Set(['STYLE', 'MATERIAL', 'DECORATION']);

function normalizeDocument(document, field) {
  if (!document || typeof document.getEntity !== 'function' || typeof document.listEntities !== 'function') {
    throw new Error(`${field} must be a workshop document.`);
  }
  return document;
}

function propagatedDomains(edgeType, domains) {
  if (edgeType === 'PARENT') return domains.filter((domain) => PARENT_PROPAGATED_DOMAINS.has(domain));
  if (edgeType === 'DEPENDENCY') return domains;
  return [];
}

function addDomains(map, entityId, domains) {
  const current = map.get(entityId) ?? new Set();
  let changed = false;
  for (const domain of domains) {
    if (current.has(domain)) continue;
    current.add(domain);
    changed = true;
  }
  map.set(entityId, current);
  return changed;
}

function graphUnion(before, after) {
  return [new WorkshopRelationshipGraph(before), new WorkshopRelationshipGraph(after)];
}

function sortedEntries(map) {
  return [...map]
    .map(([entityId, domains]) => ({
      entityId,
      domains: Object.freeze([...domains].sort((left, right) => dirtyDomainOrder(left) - dirtyDomainOrder(right))),
    }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
}

export function planWorkshopInvalidation(beforeInput, afterInput, touchedIds = []) {
  const before = normalizeDocument(beforeInput, 'Workshop invalidation before document');
  const after = normalizeDocument(afterInput, 'Workshop invalidation after document');
  if (!Array.isArray(touchedIds)) throw new Error('Workshop touched ids must be an array.');

  const seeds = [...new Set(touchedIds)].sort();
  const dirty = new Map();
  const queue = [];
  for (const entityId of seeds) {
    const beforeEntity = before.getEntity(entityId);
    const afterEntity = after.getEntity(entityId);
    const domains = domainsForWorkshopEntityChange(beforeEntity, afterEntity);
    if (domains.length === 0) continue;
    addDomains(dirty, entityId, domains);
    queue.push(entityId);
  }

  const graphs = graphUnion(before, after);
  while (queue.length > 0) {
    const sourceId = queue.shift();
    const sourceDomains = normalizeDirtyDomains([...(dirty.get(sourceId) ?? [])]);
    const edgeKeys = new Set();
    const edges = [];
    for (const graph of graphs) {
      for (const edge of graph.outgoing(sourceId)) {
        const key = `${edge.type}:${edge.from}:${edge.to}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push(edge);
      }
    }
    edges.sort((left, right) => left.to.localeCompare(right.to) || left.type.localeCompare(right.type));
    for (const edge of edges) {
      const domains = propagatedDomains(edge.type, sourceDomains);
      if (domains.length === 0) continue;
      if (addDomains(dirty, edge.to, domains)) queue.push(edge.to);
    }
  }

  const byEntity = Object.freeze(sortedEntries(dirty).map((entry) => Object.freeze(entry)));
  const domains = normalizeDirtyDomains(byEntity.flatMap((entry) => entry.domains));
  return Object.freeze({
    entities: Object.freeze(byEntity.map(({ entityId }) => entityId)),
    domains,
    byEntity,
  });
}
