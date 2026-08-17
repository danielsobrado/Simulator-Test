import { OBJECT_SELECTION_CHANGED_EVENT } from '../interaction/ObjectSelectionEvents.js';

function applySelectionState(root, detail) {
  const toolbar = root.querySelector('.natural-context-toolbar');
  if (!toolbar) return;
  const label = toolbar.querySelector('.natural-context-toolbar__label');
  if (label) {
    label.textContent = detail.count > 1 ? `${detail.count} selected` : 'Selected';
  }
  const duplicate = toolbar.querySelector('[data-natural-duplicate]');
  if (duplicate) {
    duplicate.title = detail.count > 1 ? 'Duplicate selection' : 'Duplicate';
  }
  const move = toolbar.querySelector('[data-action="move-selected"]');
  if (move) move.title = detail.count > 1 ? 'Move selection' : 'Move';
  const rotate = toolbar.querySelector('[data-action="rotate-selected"]');
  if (rotate) rotate.title = detail.count > 1 ? 'Rotate selection' : 'Rotate';
  const remove = toolbar.querySelector('[data-action="delete-selected"]');
  if (remove) remove.title = detail.count > 1 ? 'Delete selection' : 'Delete';
}

function installWhenReady() {
  const root = document.querySelector('#app');
  if (!root?.querySelector('.natural-context-toolbar')) return false;
  window.addEventListener(
    OBJECT_SELECTION_CHANGED_EVENT,
    (event) => applySelectionState(root, event.detail),
  );
  return true;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
