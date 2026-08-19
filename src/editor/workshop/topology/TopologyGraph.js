import { normalizeCurvePath } from '../curves/CurvePath.js';

export class TopologyGraph {
  #adjacency = new Map();
  #segmentsByPoint = new Map();

  constructor(pathInput, options) {
    this.path = normalizeCurvePath(pathInput, options);
    for (const point of this.path.listPoints()) {
      this.#adjacency.set(point.id, new Set());
      this.#segmentsByPoint.set(point.id, new Set());
    }
    for (const segment of this.path.listSegments()) {
      this.#adjacency.get(segment.startId).add(segment.endId);
      this.#adjacency.get(segment.endId).add(segment.startId);
      this.#segmentsByPoint.get(segment.startId).add(segment.id);
      this.#segmentsByPoint.get(segment.endId).add(segment.id);
    }
    Object.freeze(this);
  }

  neighbors(pointId) {
    return Object.freeze([...(this.#adjacency.get(pointId) ?? [])].sort());
  }

  segmentIdsAt(pointId) {
    return Object.freeze([...(this.#segmentsByPoint.get(pointId) ?? [])].sort());
  }

  degree(pointId) {
    return this.#segmentsByPoint.get(pointId)?.size ?? 0;
  }

  components() {
    const pending = new Set(this.path.listPoints().map(({ id }) => id));
    const components = [];
    while (pending.size > 0) {
      const first = [...pending].sort()[0];
      const queue = [first];
      const component = [];
      pending.delete(first);
      while (queue.length > 0) {
        const id = queue.shift();
        component.push(id);
        for (const neighbor of this.neighbors(id)) {
          if (!pending.has(neighbor)) continue;
          pending.delete(neighbor);
          queue.push(neighbor);
        }
      }
      components.push(Object.freeze(component.sort()));
    }
    return Object.freeze(components.sort((left, right) => left[0].localeCompare(right[0])));
  }
}
