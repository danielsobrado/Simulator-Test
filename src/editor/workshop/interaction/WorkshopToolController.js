import { PreviewTransaction } from './PreviewTransaction.js';
import { HandleController } from './HandleController.js';
import { SelectionController } from './SelectionController.js';
import { WORKSHOP_TOOL_ID_PATTERN } from './WorkshopInteractionConstants.js';

function requireToolId(value) {
  if (typeof value !== 'string' || !WORKSHOP_TOOL_ID_PATTERN.test(value)) {
    throw new Error('Workshop tool id is invalid.');
  }
  return value;
}

export class WorkshopToolController {
  #bus;
  #dispatchCommit;
  #transaction = null;
  #toolId = null;
  #previewListeners = new Set();

  constructor({ bus, replayRecorder = null, selection = null, handles = null } = {}) {
    if (!bus || typeof bus.dispatch !== 'function') {
      throw new Error('Workshop tool controller requires a workshop command bus.');
    }
    this.#bus = bus;
    this.#dispatchCommit = replayRecorder
      ? (command) => replayRecorder.dispatch(command)
      : (command) => bus.dispatch(command);
    this.selection = selection ?? new SelectionController();
    this.handles = handles ?? new HandleController();
  }

  get activeToolId() {
    return this.#toolId;
  }

  get previewDocument() {
    return this.#transaction?.previewDocument ?? this.#bus.document;
  }

  get isGestureActive() {
    return this.#transaction !== null;
  }

  subscribePreview(listener) {
    if (typeof listener !== 'function') throw new Error('Preview listener must be a function.');
    this.#previewListeners.add(listener);
    return () => this.#previewListeners.delete(listener);
  }

  #publishPreview(reason) {
    const snapshot = Object.freeze({
      reason,
      toolId: this.#toolId,
      document: this.previewDocument,
      committedDocument: this.#bus.document,
    });
    for (const listener of this.#previewListeners) listener(snapshot);
    return snapshot;
  }

  beginGesture(toolId, { label = null } = {}) {
    if (this.#transaction) throw new Error('A workshop gesture is already active.');
    this.#toolId = requireToolId(toolId);
    this.#transaction = new PreviewTransaction(this.#bus, {
      label: label ?? `Workshop ${this.#toolId} gesture`,
      dispatchCommit: this.#dispatchCommit,
    });
    return this.#publishPreview('begin');
  }

  updateGesture(commandInput) {
    if (!this.#transaction) throw new Error('No workshop gesture is active.');
    this.#transaction.replace(commandInput);
    return this.#publishPreview('update');
  }

  commitGesture() {
    if (!this.#transaction) return null;
    const transaction = this.#transaction;
    this.#transaction = null;
    const toolId = this.#toolId;
    this.#toolId = null;
    try {
      const result = transaction.commit();
      this.#publishPreview('commit');
      return result;
    } catch (error) {
      this.#toolId = toolId;
      this.#transaction = transaction;
      throw error;
    }
  }

  cancelGesture() {
    if (!this.#transaction) return false;
    this.#transaction.cancel();
    this.#transaction = null;
    this.#toolId = null;
    this.#publishPreview('cancel');
    return true;
  }

  execute(command) {
    if (this.#transaction) throw new Error('Finish or cancel the active workshop gesture first.');
    return this.#dispatchCommit(command);
  }
}
