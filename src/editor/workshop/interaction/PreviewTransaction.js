import { applyWorkshopPatch } from '../kernel/WorkshopPatch.js';

function cloneCommandValue(value, field = 'Workshop preview command') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} numbers must be finite.`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => cloneCommandValue(entry, `${field}[${index}]`)));
  }
  if (!value || typeof value !== 'object') throw new Error(`${field} must be JSON-compatible.`);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new Error(`${field}.${key} cannot be undefined.`);
    result[key] = cloneCommandValue(value[key], `${field}.${key}`);
  }
  return Object.freeze(result);
}

function normalizeCommands(input) {
  const commands = Array.isArray(input) ? input : [input];
  if (commands.some((command) => !command || typeof command !== 'object' || Array.isArray(command))) {
    throw new Error('Workshop preview commands must be command objects.');
  }
  return Object.freeze(commands.map((command) => cloneCommandValue(command)));
}

export class PreviewTransaction {
  #bus;
  #baseDocument;
  #previewDocument;
  #commands = Object.freeze([]);
  #dispatchCommit;
  #closed = false;

  constructor(bus, { label = 'Workshop gesture', dispatchCommit = null } = {}) {
    if (!bus || typeof bus.plan !== 'function' || typeof bus.dispatch !== 'function') {
      throw new Error('Workshop preview transaction requires a workshop command bus.');
    }
    this.#bus = bus;
    this.#baseDocument = bus.document;
    this.#previewDocument = bus.document;
    this.#dispatchCommit = dispatchCommit ?? ((command) => bus.dispatch(command));
    this.label = String(label).trim().slice(0, 96) || 'Workshop gesture';
  }

  get previewDocument() {
    return this.#previewDocument;
  }

  get baseDocument() {
    return this.#baseDocument;
  }

  get isClosed() {
    return this.#closed;
  }

  get commands() {
    return this.#commands;
  }

  #requireOpen() {
    if (this.#closed) throw new Error('Workshop preview transaction is already closed.');
  }

  replace(commandInput) {
    this.#requireOpen();
    const commands = normalizeCommands(commandInput);
    let working = this.#baseDocument;
    for (const command of commands) {
      working = applyWorkshopPatch(working, this.#bus.plan(command, working)).document;
    }
    this.#commands = commands;
    this.#previewDocument = working;
    return working;
  }

  cancel() {
    this.#requireOpen();
    this.#closed = true;
    this.#previewDocument = this.#baseDocument;
    this.#commands = Object.freeze([]);
    return this.#baseDocument;
  }

  commit() {
    this.#requireOpen();
    if (this.#bus.document !== this.#baseDocument) {
      throw new Error('Workshop preview transaction is stale because the committed document changed.');
    }
    if (this.#commands.length === 0) {
      this.#closed = true;
      return null;
    }
    const command = this.#commands.length === 1
      ? { ...this.#commands[0], label: this.#commands[0].label ?? this.label }
      : { type: 'document.batch', label: this.label, commands: this.#commands };
    const result = this.#dispatchCommit(command);
    this.#closed = true;
    return result;
  }
}
