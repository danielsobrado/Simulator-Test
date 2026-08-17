import './NaturalEditorRecommendations.css';
import { OBJECT_CATALOG } from '../objectCatalog.js';

const HOVER_EVENT = 'drusniel:natural-editor-hover';
const MAX_RECOMMENDATIONS = 6;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function activeCategory(root) {
  return root.querySelector('[data-role="object-categories"] .chip.is-active')?.dataset.objectCategory
    ?? 'all';
}

function recommendationScore(definition, category) {
  let score = 0;
  if (category !== 'all' && definition.category === category) score += 100;
  if (definition.category === 'nature') score += 8;
  if (definition.footprint.width * definition.footprint.depth <= 4) score += 3;
  return score;
}

function recommendationsFor(tileId, category) {
  if (!Number.isInteger(tileId)) return [];
  return OBJECT_CATALOG
    .filter((definition) => definition.allowedTileIds.includes(tileId))
    .filter((definition) => category === 'all' || definition.category === category)
    .map((definition, index) => ({ definition, index }))
    .sort((a, b) => (
      recommendationScore(b.definition, category) - recommendationScore(a.definition, category)
      || a.index - b.index
    ))
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ definition }) => definition);
}

class NaturalEditorRecommendations {
  constructor(root) {
    this.root = root;
    this.objectPanel = root.querySelector('[data-panel="object"]');
    this.objectSearch = root.querySelector('[data-role="object-search"]');
    this.categories = root.querySelector('[data-role="object-categories"]');
    this.objectPalette = root.querySelector('[data-role="object-palette"]');
    this.tileId = null;

    this.host = document.createElement('section');
    this.host.className = 'natural-recommendations';
    this.host.hidden = true;
    this.host.innerHTML = '<span class="natural-recommendations__label">Recommended here</span><div></div>';
    const quickPicks = this.objectPanel?.querySelector('.natural-quick-picks');
    (quickPicks ?? this.objectPalette)?.before(this.host);

    window.addEventListener(HOVER_EVENT, (event) => {
      this.tileId = event.detail?.tileId ?? null;
      this.render();
    });
    this.categories?.addEventListener('click', () => queueMicrotask(() => this.render()));
    this.objectSearch?.addEventListener('input', () => this.render());
    this.host.addEventListener('click', (event) => this.select(event));
  }

  render() {
    if (!this.host) return;
    if (this.objectSearch?.value.trim()) {
      this.host.hidden = true;
      return;
    }
    const category = activeCategory(this.root);
    const definitions = recommendationsFor(this.tileId, category);
    this.host.hidden = definitions.length === 0;
    this.host.querySelector('div').innerHTML = definitions.map((definition) => `
      <button
        type="button"
        data-natural-recommendation="${escapeHtml(definition.key)}"
        data-natural-recommendation-category="${escapeHtml(definition.category)}"
        title="Fits this terrain"
      >
        <span class="natural-recommendations__icon" style="--object-color:${escapeHtml(definition.color)}">${escapeHtml(definition.icon)}</span>
        <span>${escapeHtml(definition.label)}</span>
      </button>
    `).join('');
  }

  select(event) {
    const button = event.target.closest('[data-natural-recommendation]');
    if (!button) return;
    const category = button.dataset.naturalRecommendationCategory;
    const chip = this.categories?.querySelector(`[data-object-category="${CSS.escape(category)}"]`)
      ?? this.categories?.querySelector('[data-object-category="all"]');
    if (chip && !chip.classList.contains('is-active')) chip.click();
    if (this.objectSearch) {
      this.objectSearch.value = '';
      this.objectSearch.dispatchEvent(new Event('input', { bubbles: true }));
    }
    queueMicrotask(() => {
      this.objectPalette
        ?.querySelector(`[data-object-key="${CSS.escape(button.dataset.naturalRecommendation)}"]`)
        ?.click();
    });
  }
}

function installWhenReady() {
  const root = document.querySelector('#app');
  if (!root?.querySelector('[data-panel="object"] .natural-quick-picks')) return false;
  if (root.querySelector('.natural-recommendations')) return true;
  new NaturalEditorRecommendations(root);
  return true;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
