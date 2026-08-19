import { applyWorkshopPatch, diffWorkshopDocuments } from './WorkshopPatch.js';

export class WorkshopPreviewTransaction {
  #bus;
  #baseDocument;
  #previewDocument;
  #closed = false;

  constructor(bus, label = 'Workshop edit') {
    if (!bus || typeof bus.plan !== 'function' || typeof bus.applyPatch !== 'function') {
      throw new Error('Preview transaction requires a workshop command bus.');
    }
    this.#bus = bus;
    this.#baseDocument = bus.document;
    this.#previewDocument = bus.document;
    this.label = String(label).trim().slice(0, 96) || 'Workshop edit';
  }

  get previewDocument() {
    return this.#previewDocument;
  }

  get isClosed() {
    return this.#closed;
  }

  #requireOpen() {
    if (this.#closed) throw new Error('Workshop preview transaction is already closed.');
  }

  dispatch(command) {
    this.#requireOpen();
    const patch = this.#bus.plan(command, this.#previewDocument);
    this.#previewDocument = applyWorkshopPatch(this.#previewDocument, patch).document;
    return this.#previewDocument;
  }

  applyPatch(patch) {
    this.#requireOpen();
    this.#previewDocument = applyWorkshopPatch(this.#previewDocument, patch).document;
    return this.#previewDocument;
  }

  commit() {
    this.#requireOpen();
    if (this.#bus.document !== this.#baseDocument) {
      throw new Error('Workshop preview transaction is stale because the document changed.');
    }
    const patch = diffWorkshopDocuments(this.#baseDocument, this.#previewDocument, this.label);
    const result = this.#bus.applyPatch(patch, { previewTransaction: true });
    this.#closed = true;
    return result;
  }

  cancel() {
    this.#requireOpen();
    this.#closed = true;
    return this.#baseDocument;
  }
}
