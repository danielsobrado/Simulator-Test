import { WorkshopCommandBus } from '../kernel/WorkshopCommandBus.js';
import { normalizeWorkshopDocument } from '../kernel/WorkshopDocument.js';
import { WORKSHOP_REPLAY_VERSION } from '../interaction/WorkshopInteractionConstants.js';

export { WORKSHOP_REPLAY_VERSION } from '../interaction/WorkshopInteractionConstants.js';

function cloneReplayValue(value, field = 'Workshop replay command') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} numbers must be finite.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => cloneReplayValue(entry, `${field}[${index}]`));
  if (!value || typeof value !== 'object') throw new Error(`${field} must be JSON-compatible.`);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new Error(`${field}.${key} cannot be undefined.`);
    result[key] = cloneReplayValue(value[key], `${field}.${key}`);
  }
  return result;
}

function normalizeReplayLog(input) {
  const source = Array.isArray(input) ? { version: WORKSHOP_REPLAY_VERSION, commands: input } : input;
  if (!source || typeof source !== 'object' || source.version !== WORKSHOP_REPLAY_VERSION) {
    throw new Error(`Workshop replay log must use version ${WORKSHOP_REPLAY_VERSION}.`);
  }
  if (!Array.isArray(source.commands)) throw new Error('Workshop replay commands must be an array.');
  return Object.freeze({
    version: WORKSHOP_REPLAY_VERSION,
    commands: Object.freeze(source.commands.map((command) => Object.freeze(cloneReplayValue(command)))),
  });
}

export class WorkshopReplayRecorder {
  #bus;
  #commands = [];

  constructor(bus) {
    if (!bus || typeof bus.dispatch !== 'function') {
      throw new Error('Workshop replay recorder requires a workshop command bus.');
    }
    this.#bus = bus;
  }

  dispatch(command) {
    const canonical = Object.freeze(cloneReplayValue(command));
    const result = this.#bus.dispatch(canonical);
    this.#commands.push(canonical);
    return result;
  }

  clear() {
    this.#commands = [];
  }

  toJSON() {
    return {
      version: WORKSHOP_REPLAY_VERSION,
      commands: this.#commands.map((command) => cloneReplayValue(command)),
    };
  }
}

export function replayWorkshopCommands(initialDocument, replayInput, { configureBus = null } = {}) {
  const replay = normalizeReplayLog(replayInput);
  const bus = new WorkshopCommandBus(normalizeWorkshopDocument(initialDocument));
  if (configureBus) configureBus(bus);
  for (const command of replay.commands) bus.dispatch(command);
  return bus.document;
}
