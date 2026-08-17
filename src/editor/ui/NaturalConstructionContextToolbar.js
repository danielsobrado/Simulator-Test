import './NaturalConstructionContextToolbar.css';
import { naturalEditorIcon } from './NaturalEditorIcons.js';

const OPEN_STYLE_EVENT = 'drusniel:natural-construction-style';
const OPEN_DETAILS_EVENT = 'drusniel:natural-construction-details';

function dispatchAtButton(name, button) {
  const bounds = button.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent(name, {
    detail: {
      clientX: bounds.left + bounds.width / 2,
      clientY: Math.max(72, bounds.top - 12),
    },
  }));
}

class NaturalConstructionContextToolbar {
  constructor(root) {
    this.root = root;
    this.viewport = root.querySelector('[data-role="viewport"]');
    this.sourceDelete = root.querySelector('.sidebar [data-action="delete-construction"]');

    this.host = document.createElement('div');
    this.host.className = 'natural-wall-context-toolbar';
    this.host.hidden = true;
    this.host.innerHTML = `
      <span class="natural-wall-context-toolbar__label">Wall</span>
      <button type="button" class="natural-wall-context-action" data-natural-wall-style>
        <span class="natural-wall-context-action__glyph">◫</span><span>Style</span>
      </button>
      <button type="button" class="natural-wall-context-action" data-natural-wall-details>
        <span class="natural-wall-context-action__glyph">•••</span><span>Details</span>
      </button>
      <button
        type="button"
        class="natural-wall-context-action natural-wall-context-action--danger"
        data-action="delete-construction"
      >
        ${naturalEditorIcon('trash')}<span>Delete</span>
      </button>
    `;
    this.viewport.append(this.host);

    this.styleButton = this.host.querySelector('[data-natural-wall-style]');
    this.detailsButton = this.host.querySelector('[data-natural-wall-details]');
    this.styleButton.addEventListener('click', () => dispatchAtButton(OPEN_STYLE_EVENT, this.styleButton));
    this.detailsButton.addEventListener('click', () => dispatchAtButton(OPEN_DETAILS_EVENT, this.detailsButton));

    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(this.sourceDelete, {
      attributes: true,
      attributeFilter: ['disabled'],
    });
    this.sync();
  }

  sync() {
    this.host.hidden = this.sourceDelete.disabled;
  }
}

function installWhenReady() {
  const root = document.querySelector('#app');
  if (!root?.querySelector('.natural-toolbar')) return false;
  const sourceDelete = root.querySelector('.sidebar [data-action="delete-construction"]');
  if (!sourceDelete) return false;
  if (root.querySelector('.natural-wall-context-toolbar')) return true;
  new NaturalConstructionContextToolbar(root);
  return true;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
