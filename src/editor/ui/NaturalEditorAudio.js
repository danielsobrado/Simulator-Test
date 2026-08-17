import { emitAudio } from '../audio/index.js';

const INTERACTIVE_SELECTOR = [
  '.natural-icon-button',
  '.natural-tool-button',
  '.natural-build-action',
  '.natural-context-action',
  '.natural-wall-context-action',
  '.natural-menu-action',
  '.natural-recommendations button',
  '.natural-quick-group button',
  '.natural-favorite-toggle',
].join(',');

function naturalControl(target) {
  return target instanceof Element ? target.closest(INTERACTIVE_SELECTOR) : null;
}

function installNaturalEditorAudio() {
  document.addEventListener('click', (event) => {
    if (naturalControl(event.target)) emitAudio('ui.click');
  });
  document.addEventListener('pointerover', (event) => {
    const control = naturalControl(event.target);
    if (!control) return;
    const previous = naturalControl(event.relatedTarget);
    if (previous === control) return;
    emitAudio('ui.hover');
  });
}

installNaturalEditorAudio();
