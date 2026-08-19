import { normalizeWorkshopDocument } from './WorkshopDocument.js';

function sortedInsert(queue, value) {
  let index = 0;
  while (index < queue.length && queue[index].localeCompare(value) < 0) index += 1;
  queue.splice(index, 0, value);
}

export class WorkshopDependencyGraph {
  #outgoing = new Map();
  #incoming = new Map();
  #order;

  constructor(documentInput) {
    this.document = normalizeWorkshopDocument(documentInput);
    for (const { id } of this.document.listEntities()) {
      this.#outgoing.set(id, new Set());
      this.#incoming.set(id, new Set());
    }
    for (const entity of this.document.listEntities()) {
      const dependencies = new Set(entity.dependsOn);
      if (entity.parentId) dependencies.add(entity.parentId);
      for (const dependency of dependencies) {
        this.#outgoing.get(dependency).add(entity.id);
        this.#incoming.get(entity.id).add(dependency);
      }
    }
    this.#order = Object.freeze(this.#topologicalOrder());
    Object.freeze(this);
  }

  #topologicalOrder() {
    const indegree = new Map([...this.#incoming].map(([id, values]) => [id, values.size]));
    const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
    const result = [];
    while (ready.length > 0) {
      const id = ready.shift();
      result.push(id);
      for (const dependent of [...this.#outgoing.get(id)].sort()) {
        const next = indegree.get(dependent) - 1;
        indegree.set(dependent, next);
        if (next === 0) sortedInsert(ready, dependent);
      }
    }
    if (result.length !== indegree.size) {
      const cyclic = [...indegree].filter(([, degree]) => degree > 0).map(([id]) => id).sort();
      throw new Error(`Workshop dependency graph contains a cycle: ${cyclic.join(', ')}.`);
    }
    return result;
  }

  dependenciesOf(id) {
    return Object.freeze([...(this.#incoming.get(id) ?? [])].sort());
  }

  dependentsOf(id) {
    return Object.freeze([...(this.#outgoing.get(id) ?? [])].sort());
  }

  affected(ids) {
    const queue = [...new Set(ids)].filter((id) => this.#outgoing.has(id));
    const affected = new Set(queue);
    while (queue.length > 0) {
      const id = queue.shift();
      for (const dependent of this.#outgoing.get(id)) {
        if (affected.has(dependent)) continue;
        affected.add(dependent);
        queue.push(dependent);
      }
    }
    return Object.freeze(this.#order.filter((id) => affected.has(id)));
  }

  topologicalOrder(ids = null) {
    if (ids === null) return this.#order;
    const selected = new Set(ids);
    return Object.freeze(this.#order.filter((id) => selected.has(id)));
  }
}
