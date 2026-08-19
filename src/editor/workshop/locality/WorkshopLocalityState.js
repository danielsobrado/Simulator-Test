import { WorkshopRelationshipGraph } from '../relationships/WorkshopRelationshipGraph.js';
import { WorkshopSpatialIndex } from '../spatial/WorkshopSpatialIndex.js';

export class WorkshopLocalityState {
  #unsubscribe = null;

  constructor(document, spatialOptions = {}) {
    this.document = document;
    this.relationships = new WorkshopRelationshipGraph(document);
    this.spatialIndex = new WorkshopSpatialIndex(document, spatialOptions);
  }

  applyEvent(event) {
    if (!event?.document) throw new Error('Workshop locality update requires a command event.');
    const spatialIds = (event.dirty?.byEntity ?? [])
      .filter(({ domains }) => domains.includes('SPATIAL_INDEX'))
      .map(({ entityId }) => entityId);
    this.spatialIndex.update(event.document, spatialIds);
    this.relationships = new WorkshopRelationshipGraph(event.document);
    this.document = event.document;
    return Object.freeze({
      spatialEntityIds: Object.freeze([...new Set(spatialIds)].sort()),
      revision: event.document.revision,
    });
  }

  connect(bus) {
    if (!bus || typeof bus.subscribe !== 'function') throw new Error('Workshop locality state requires a command bus.');
    this.disconnect();
    this.#unsubscribe = bus.subscribe((event) => this.applyEvent(event));
    return () => this.disconnect();
  }

  disconnect() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  queryNeighborhood(entityId, padding = 0) {
    return this.spatialIndex.neighborsOf(entityId, padding);
  }
}
