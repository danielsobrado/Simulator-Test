import './NaturalMultiSelectionUi.css';
import {
  OBJECT_SELECTION_ADDITIVE_MODE_EVENT,
  OBJECT_SELECTION_CHANGED_EVENT,
} from '../interaction/ObjectSelectionEvents.js';
import { naturalEditorIcon } from './NaturalEditorIcons.js';

function dispatchAdditiveMode(enabled) {
  window.dispatchEvent(new CustomEvent(OBJECT_SELECTION_ADDITIVE_MODE_EVENT, {
    detail: Object.freeze({ enabled }),
  }));
}

class NaturalMultiSelectionUi {
  constructor(root) {
    this.root = root;
    this.toolbar = root.querySelector('.natural-context-toolbar');
    this.additive = false;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'natural-context-action';
    this.button.dataset.naturalSelectMore = '';
    this.button.title = 'Select more';
    this.button.setAttribute('aria-pressed', 'false');
    this.button.innerHTML = `${naturalEditorIcon('select-add')}<span>Select more</span>`;
    this.toolbar.querySelector('[data-action="move-selected"]')?.before(this.button);
    this.bind();
  }

  bind() {
    this.button.addEventListener('click', () => this.setAdditive(!this.additive));
    window.addEventListener(
      OBJECT_SELECTION_CHANGED_EVENT,
      (event) => this.applySelectionState(event.detail),
    );
  }

  setAdditive(enabled) {
    this.additive = Boolean(enabled);
    this.button.classList.toggle('is-active', this.additive);
    this.button.setAttribute('aria-pressed', String(this.additive));
    this.button.title = this.additive ? 'Stop selecting more' : 'Select more';
    dispatchAdditiveMode(this.additive);
  }

  applySelectionState(detail) {
    const label = this.toolbar.querySelector('.natural-context-toolbar__label');
    if (label) label.textContent = detail.count > 1 ? `${detail.count} selected` : 'Selected';

    const duplicate = this.toolbar.querySelector('[data-natural-duplicate]');
    if (duplicate) duplicate.title = detail.count > 1 ? 'Duplicate selection' : 'Duplicate';
    const move = this.toolbar.querySelector('[data-action="move-selected"]');
    if (move) move.title = detail.count > 1 ? 'Move selection' : 'Move';
    const rotate = this.toolbar.querySelector('[data-action="rotate-selected"]');
    if (rotate) rotate.title = detail.count > 1 ? 'Rotate selection' : 'Rotate';
    const remove = this.toolbar.querySelector('[data-action="delete-selected"]');
    if (remove) remove.title = detail.count > 1 ? 'Delete selection' : 'Delete';

    if (detail.count === 0 && this.additive) this.setAdditive(false);
  }
}

function installWhenReady() {
  const root = document.querySelector('#app');
  if (!root?.querySelector('.natural-context-toolbar')) return false;
  if (root.dataset.naturalMultiSelectionUi === 'true') return true;
  root.dataset.naturalMultiSelectionUi = 'true';
  new NaturalMultiSelectionUi(root);
  return true;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
