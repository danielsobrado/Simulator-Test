import { normalizeWorkshopDocument } from './WorkshopDocument.js';
import { WorkshopDependencyGraph } from './WorkshopDependencyGraph.js';
import { normalizeWorkshopEntity } from './WorkshopEntity.js';
import {
  applyWorkshopPatch,
  diffWorkshopDocuments,
  WorkshopPatch,
} from './WorkshopPatch.js';
import { WORKSHOP_COMMAND_TYPE_PATTERN } from './WorkshopKernelConstants.js';

function commandType(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('Workshop command must be an object.');
  }
  if (typeof command.type !== 'string' || !WORKSHOP_COMMAND_TYPE_PATTERN.test(command.type)) {
    throw new Error('Workshop command type is invalid.');
  }
  return command.type;
}

function updatedEntity(document, id, changes) {
  const current = document.getEntity(id);
  if (!current) throw new Error(`Unknown workshop entity: ${id}.`);
  return normalizeWorkshopEntity({ ...current.toJSON(), ...changes });
}

function defaultHandlers() {
  return new Map([
    ['entity.put', ({ command }) => new WorkshopPatch({
      label: command.label ?? 'Put entity',
      operations: [{ op: 'put', entity: command.entity }],
    })],
    ['entity.remove', ({ command, document }) => {
      if (!document.hasEntity(command.id)) throw new Error(`Unknown workshop entity: ${command.id}.`);
      return new WorkshopPatch({
        label: command.label ?? 'Remove entity',
        operations: [{ op: 'remove', id: command.id }],
      });
    }],
    ['entity.set-properties', ({ command, document }) => {
      const current = document.getEntity(command.id);
      if (!current) throw new Error(`Unknown workshop entity: ${command.id}.`);
      if (!command.properties || typeof command.properties !== 'object' || Array.isArray(command.properties)) {
        throw new Error('Workshop property update requires an object.');
      }
      return new WorkshopPatch({
        label: command.label ?? 'Set entity properties',
        operations: [{
          op: 'put',
          entity: updatedEntity(document, command.id, {
            properties: { ...current.properties, ...command.properties },
          }),
        }],
      });
    }],
    ['entity.reparent', ({ command, document }) => new WorkshopPatch({
      label: command.label ?? 'Reparent entity',
      operations: [{
        op: 'put',
        entity: updatedEntity(document, command.id, { parentId: command.parentId ?? null }),
      }],
    })],
    ['entity.set-dependencies', ({ command, document }) => new WorkshopPatch({
      label: command.label ?? 'Set entity dependencies',
      operations: [{
        op: 'put',
        entity: updatedEntity(document, command.id, { dependsOn: command.dependsOn ?? [] }),
      }],
    })],
  ]);
}

function impactedIds(beforeGraph, afterGraph, touchedIds) {
  const impacted = new Set(touchedIds);
  beforeGraph.affected(touchedIds).forEach((id) => impacted.add(id));
  afterGraph.affected(touchedIds).forEach((id) => impacted.add(id));
  return Object.freeze([...impacted].sort());
}

export class WorkshopCommandBus {
  #document;
  #handlers;
  #listeners = new Set();

  constructor(documentInput = {}, handlers = null) {
    this.#document = normalizeWorkshopDocument(documentInput);
    this.#handlers = handlers ? new Map(handlers) : defaultHandlers();
    this.#handlers.set('document.batch', ({ command, document, bus }) => {
      if (!Array.isArray(command.commands)) throw new Error('Workshop batch command requires commands.');
      let working = document;
      for (const child of command.commands) {
        const patch = bus.plan(child, working);
        working = applyWorkshopPatch(working, patch).document;
      }
      return diffWorkshopDocuments(document, working, command.label ?? 'Batch edit');
    });
  }

  get document() {
    return this.#document;
  }

  register(type, handler) {
    if (typeof type !== 'string' || !WORKSHOP_COMMAND_TYPE_PATTERN.test(type)) {
      throw new Error('Workshop command type is invalid.');
    }
    if (typeof handler !== 'function') throw new Error('Workshop command handler must be a function.');
    this.#handlers.set(type, handler);
    return () => this.#handlers.delete(type);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('Workshop command listener must be a function.');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  plan(command, documentInput = this.#document) {
    const type = commandType(command);
    const handler = this.#handlers.get(type);
    if (!handler) throw new Error(`Unknown workshop command: ${type}.`);
    const document = normalizeWorkshopDocument(documentInput);
    const patch = handler({ command, document, bus: this });
    return patch instanceof WorkshopPatch ? patch : new WorkshopPatch(patch);
  }

  applyPatch(patch, metadata = {}) {
    const before = this.#document;
    const result = applyWorkshopPatch(before, patch);
    if (result.document === before) {
      return Object.freeze({ ...result, impactedIds: Object.freeze([]), metadata: Object.freeze(metadata) });
    }
    const beforeGraph = new WorkshopDependencyGraph(before);
    const afterGraph = new WorkshopDependencyGraph(result.document);
    const event = Object.freeze({
      ...result,
      impactedIds: impactedIds(beforeGraph, afterGraph, result.touchedIds),
      metadata: Object.freeze({ ...metadata }),
    });
    this.#document = result.document;
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  dispatch(command) {
    return this.applyPatch(this.plan(command), { commandType: command.type });
  }
}
