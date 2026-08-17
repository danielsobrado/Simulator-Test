import './NaturalEditorUi.css';
import { naturalEditorIcon } from './NaturalEditorIcons.js';
import { NaturalEditorPreferences } from './NaturalEditorPreferences.js';
import { NATURAL_EDITOR_UI_CONFIG } from './NaturalEditorUiConfig.generated.js';

const INSTALL_MARK = 'naturalUiInstalled';
const PANEL_SELECTOR = '.sidebar [data-panel]';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buttonMarkup({ id, label, icon }) {
  return `
    <button
      class="natural-tool-button"
      type="button"
      data-natural-tool="${escapeHtml(id)}"
      aria-pressed="false"
      title="${escapeHtml(label)}"
    >
      <span class="natural-icon">${naturalEditorIcon(icon)}</span>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function actionButtonMarkup(action, icon = null) {
  return `
    <button class="natural-icon-button" type="button" data-action="${escapeHtml(action)}" title="${escapeHtml(action)}">
      ${icon ? naturalEditorIcon(icon) : ''}
    </button>
  `;
}

function hiddenTool(root, tool) {
  return root.querySelector(`.panel--tools [data-tool="${CSS.escape(tool)}"]`);
}

function clickHiddenTool(root, tool) {
  hiddenTool(root, tool)?.click();
}

function clickCategory(root, category) {
  const chip = root.querySelector(`[data-object-category="${CSS.escape(category)}"]`);
  if (chip) chip.click();
}

function isPanelVisible(panel) {
  return panel && !panel.hidden;
}

function dispatchDuplicateShortcut() {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'd',
    code: 'KeyD',
    ctrlKey: true,
    bubbles: true,
  }));
}

class NaturalEditorUi {
  constructor(root) {
    this.root = root;
    this.shell = root.querySelector('.editor-shell');
    this.sidebar = root.querySelector('.sidebar');
    this.viewport = root.querySelector('[data-role="viewport"]');
    this.objectPalette = root.querySelector('[data-role="object-palette"]');
    this.objectSearch = root.querySelector('[data-role="object-search"]');
    this.selectedObjectCard = root.querySelector('[data-role="selected-object"]');
    this.preferences = new NaturalEditorPreferences();
    this.activeTool = 'terrain';
    this.previousPrimaryTool = 'terrain';
    this.paletteRefreshQueued = false;
    this.worldMenuOpen = false;

    this.shell.dataset[INSTALL_MARK] = 'true';
    this.createChrome();
    this.createQuickPicks();
    this.bind();
    this.observe();
    this.refreshObjectPaletteEnhancements();
    this.syncFromPanels();
    this.showFirstRunHint();
  }

  createChrome() {
    this.chrome = document.createElement('div');
    this.chrome.className = 'natural-top-chrome';
    this.chrome.innerHTML = `
      <div class="natural-brand">
        <button class="natural-icon-button" type="button" data-natural-world-menu title="World menu" aria-expanded="false">
          ${naturalEditorIcon('menu')}
        </button>
        <div class="natural-brand__text">
          <strong>Drusniel World</strong>
          <span>Build directly in the world</span>
        </div>
      </div>
      <div class="natural-history-actions">
        ${actionButtonMarkup('undo', 'undo')}
        ${actionButtonMarkup('redo', 'redo')}
        <button class="natural-icon-button" type="button" data-natural-settings title="Settings">
          ${naturalEditorIcon('settings')}
        </button>
      </div>
    `;

    this.worldMenu = document.createElement('div');
    this.worldMenu.className = 'natural-world-menu';
    this.worldMenu.hidden = true;
    this.worldMenu.innerHTML = `
      <div class="natural-world-menu__head">
        <strong>World</strong>
        <button class="natural-icon-button natural-icon-button--small" type="button" data-natural-world-menu-close title="Close">
          ${naturalEditorIcon('close')}
        </button>
      </div>
      <div class="natural-world-menu__actions">
        ${NATURAL_EDITOR_UI_CONFIG.worldActions.map((action) => `
          <button class="natural-menu-action" type="button" data-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>
        `).join('')}
      </div>
      <p>Save, restore or reset edits. Appearance, imports and creator tools live in Settings.</p>
    `;

    this.toolbar = document.createElement('nav');
    this.toolbar.className = 'natural-toolbar';
    this.toolbar.setAttribute('aria-label', 'World tools');
    this.toolbar.innerHTML = NATURAL_EDITOR_UI_CONFIG.primaryTools.map(buttonMarkup).join('');

    this.buildStrip = document.createElement('div');
    this.buildStrip.className = 'natural-build-strip';
    this.buildStrip.hidden = true;
    this.buildStrip.innerHTML = NATURAL_EDITOR_UI_CONFIG.buildActions.map((action) => `
      <button
        class="natural-build-action"
        type="button"
        data-natural-build-action="${escapeHtml(action.id)}"
        title="${escapeHtml(action.label)}"
      >
        <span class="natural-icon">${naturalEditorIcon(action.icon)}</span>
        <span>${escapeHtml(action.label)}</span>
      </button>
    `).join('');

    this.contextToolbar = document.createElement('div');
    this.contextToolbar.className = 'natural-context-toolbar';
    this.contextToolbar.hidden = true;
    this.contextToolbar.innerHTML = `
      <span class="natural-context-toolbar__label">Object</span>
      <button class="natural-context-action" type="button" data-action="move-selected" title="Move">
        ${naturalEditorIcon('move')}<span>Move</span>
      </button>
      <button class="natural-context-action" type="button" data-action="rotate-selected" title="Rotate">
        ${naturalEditorIcon('rotate')}<span>Rotate</span>
      </button>
      <button class="natural-context-action" type="button" data-natural-duplicate title="Duplicate">
        ${naturalEditorIcon('duplicate')}<span>Duplicate</span>
      </button>
      <button class="natural-context-action natural-context-action--danger" type="button" data-action="delete-selected" title="Delete">
        ${naturalEditorIcon('trash')}<span>Delete</span>
      </button>
    `;

    this.drawerClose = document.createElement('button');
    this.drawerClose.className = 'natural-drawer-close natural-icon-button natural-icon-button--small';
    this.drawerClose.type = 'button';
    this.drawerClose.title = 'Hide panel';
    this.drawerClose.setAttribute('aria-label', 'Hide panel');
    this.drawerClose.innerHTML = naturalEditorIcon('close');
    this.sidebar.prepend(this.drawerClose);

    this.viewport.append(this.chrome, this.worldMenu, this.buildStrip, this.contextToolbar, this.toolbar);
  }

  createQuickPicks() {
    this.quickPicks = document.createElement('div');
    this.quickPicks.className = 'natural-quick-picks';
    this.objectPalette?.before(this.quickPicks);
  }

  bind() {
    this.toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-natural-tool]');
      if (button) this.activatePrimaryTool(button.dataset.naturalTool);
    });

    this.buildStrip.addEventListener('click', (event) => {
      const button = event.target.closest('[data-natural-build-action]');
      if (!button) return;
      this.activateBuildAction(button.dataset.naturalBuildAction);
    });

    this.chrome.querySelector('[data-natural-world-menu]').addEventListener('click', () => {
      this.setWorldMenuOpen(!this.worldMenuOpen);
    });
    this.worldMenu.querySelector('[data-natural-world-menu-close]').addEventListener('click', () => {
      this.setWorldMenuOpen(false);
    });
    this.chrome.querySelector('[data-natural-settings]').addEventListener('click', () => {
      this.previousPrimaryTool = this.activeTool || this.previousPrimaryTool;
      this.activeTool = null;
      this.sidebar.classList.remove('is-dismissed');
      clickHiddenTool(this.root, 'settings');
      this.syncToolbar();
    });

    this.drawerClose.addEventListener('click', () => {
      const visible = this.visiblePanel();
      if (visible?.dataset.panel === 'settings') {
        this.activatePrimaryTool(this.previousPrimaryTool || 'terrain');
        return;
      }
      this.sidebar.classList.add('is-dismissed');
    });

    this.contextToolbar.querySelector('[data-natural-duplicate]').addEventListener('click', () => {
      dispatchDuplicateShortcut();
    });

    this.objectPalette?.addEventListener('click', (event) => {
      const favorite = event.target.closest('[data-natural-favorite]');
      if (favorite) {
        event.preventDefault();
        event.stopPropagation();
        this.preferences.toggleFavorite(favorite.dataset.naturalFavorite);
        this.refreshObjectPaletteEnhancements();
        return;
      }
      const card = event.target.closest('[data-object-key]');
      if (!card) return;
      this.preferences.remember(card.dataset.objectKey);
      this.renderQuickPicks();
    }, true);

    this.quickPicks.addEventListener('click', (event) => {
      const button = event.target.closest('[data-natural-object-key]');
      if (!button) return;
      this.selectQuickPick(button.dataset.naturalObjectKey);
    });

    this.viewport.addEventListener('wheel', (event) => {
      if (!event.shiftKey || this.activeTool !== 'terrain') return;
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: event.deltaY > 0 ? ']' : '[',
        code: event.deltaY > 0 ? 'BracketRight' : 'BracketLeft',
        bubbles: true,
      }));
    }, { capture: true, passive: false });

    document.addEventListener('pointerdown', (event) => {
      if (this.worldMenuOpen && !event.target.closest('.natural-world-menu, [data-natural-world-menu]')) {
        this.setWorldMenuOpen(false);
      }
    });
  }

  observe() {
    this.panelObserver = new MutationObserver(() => this.syncFromPanels());
    for (const panel of this.root.querySelectorAll(PANEL_SELECTOR)) {
      this.panelObserver.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    }

    const selectedDelete = this.root.querySelector('.sidebar [data-action="delete-selected"]');
    if (selectedDelete) {
      this.selectionObserver = new MutationObserver(() => this.syncContextToolbar());
      this.selectionObserver.observe(selectedDelete, { attributes: true, attributeFilter: ['disabled'] });
    }
    if (this.selectedObjectCard) {
      this.selectedObjectObserver = new MutationObserver(() => this.syncContextToolbar());
      this.selectedObjectObserver.observe(this.selectedObjectCard, { childList: true, subtree: true });
    }

    if (this.objectPalette) {
      this.paletteObserver = new MutationObserver(() => this.queuePaletteRefresh());
      this.paletteObserver.observe(this.objectPalette, { childList: true, subtree: true });
    }
  }

  visiblePanel() {
    return [...this.root.querySelectorAll(PANEL_SELECTOR)].find(isPanelVisible) ?? null;
  }

  syncFromPanels() {
    const panel = this.visiblePanel();
    const panelName = panel?.dataset.panel ?? 'none';
    this.shell.dataset.naturalPanel = panelName;
    this.sidebar.classList.toggle('is-selection-context', panelName === 'select');
    this.sidebar.classList.toggle('is-settings-drawer', panelName === 'settings');
    if (panelName !== 'select') this.sidebar.classList.remove('is-dismissed');
    this.syncContextToolbar();
    this.syncToolbar();
  }

  syncToolbar() {
    for (const button of this.toolbar.querySelectorAll('[data-natural-tool]')) {
      const active = button.dataset.naturalTool === this.activeTool;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.buildStrip.hidden = this.activeTool !== 'build';
  }

  syncContextToolbar() {
    const sourceDelete = this.root.querySelector('.sidebar [data-action="delete-selected"]');
    const hasObjectSelection = sourceDelete ? !sourceDelete.disabled : false;
    this.contextToolbar.hidden = !hasObjectSelection;
    if (hasObjectSelection) this.sidebar.classList.add('is-selection-context');
    const label = this.selectedObjectCard?.querySelector('strong')?.textContent?.trim();
    this.contextToolbar.querySelector('.natural-context-toolbar__label').textContent = label || 'Object';
  }

  activatePrimaryTool(toolId) {
    const definition = NATURAL_EDITOR_UI_CONFIG.primaryTools.find(({ id }) => id === toolId);
    if (!definition) return;
    this.previousPrimaryTool = toolId;
    this.activeTool = toolId;
    this.sidebar.classList.remove('is-dismissed');
    this.setWorldMenuOpen(false);

    if (definition.controllerTool === 'object') {
      clickHiddenTool(this.root, 'object');
      queueMicrotask(() => clickCategory(this.root, definition.objectCategory ?? 'all'));
    } else {
      clickHiddenTool(this.root, definition.controllerTool);
    }
    this.syncToolbar();
  }

  activateBuildAction(actionId) {
    const action = NATURAL_EDITOR_UI_CONFIG.buildActions.find(({ id }) => id === actionId);
    if (!action) return;
    this.activeTool = 'build';
    this.sidebar.classList.remove('is-dismissed');
    if (action.action === 'workshop') {
      clickHiddenTool(this.root, 'workshop');
      return;
    }
    clickHiddenTool(this.root, action.controllerTool);
    if (action.objectCategory) queueMicrotask(() => clickCategory(this.root, action.objectCategory));
    this.syncToolbar();
  }

  setWorldMenuOpen(open) {
    this.worldMenuOpen = Boolean(open);
    this.worldMenu.hidden = !this.worldMenuOpen;
    this.chrome.querySelector('[data-natural-world-menu]').setAttribute(
      'aria-expanded',
      String(this.worldMenuOpen),
    );
  }

  queuePaletteRefresh() {
    if (this.paletteRefreshQueued) return;
    this.paletteRefreshQueued = true;
    queueMicrotask(() => {
      this.paletteRefreshQueued = false;
      this.refreshObjectPaletteEnhancements();
    });
  }

  ensureObjectCardWrapper(card) {
    if (card.parentElement?.classList.contains('natural-object-card-wrap')) return card.parentElement;
    const wrapper = document.createElement('div');
    wrapper.className = 'natural-object-card-wrap';
    card.before(wrapper);
    wrapper.append(card);
    return wrapper;
  }

  refreshObjectPaletteEnhancements() {
    if (!this.objectPalette) return;
    for (const card of this.objectPalette.querySelectorAll('.object-card[data-object-key]')) {
      const key = card.dataset.objectKey;
      const wrapper = this.ensureObjectCardWrapper(card);
      let favorite = wrapper.querySelector(':scope > [data-natural-favorite]');
      if (!favorite) {
        favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'natural-favorite-toggle';
        favorite.dataset.naturalFavorite = key;
        favorite.innerHTML = naturalEditorIcon('star');
        wrapper.append(favorite);
      }
      const active = this.preferences.isFavorite(key);
      favorite.classList.toggle('is-active', active);
      favorite.setAttribute('aria-label', active ? 'Remove from favorites' : 'Add to favorites');
      favorite.title = active ? 'Remove from favorites' : 'Add to favorites';
    }
    this.renderQuickPicks();
  }

  cardInfo(key) {
    const card = this.objectPalette?.querySelector(`.object-card[data-object-key="${CSS.escape(key)}"]`);
    if (!card) return null;
    return {
      key,
      label: card.querySelector('.object-card__label')?.textContent?.trim() || key,
      icon: card.querySelector('.object-card__icon')?.textContent?.trim() || '',
    };
  }

  renderQuickPicks() {
    if (!this.quickPicks) return;
    const groups = [
      { label: 'Favorites', keys: this.preferences.favoriteKeys() },
      { label: 'Recent', keys: this.preferences.recentKeys() },
    ].map((group) => ({
      ...group,
      items: group.keys.map((key) => this.cardInfo(key)).filter(Boolean),
    })).filter(({ items }) => items.length > 0);

    if (groups.length === 0) {
      this.quickPicks.hidden = true;
      this.quickPicks.innerHTML = '';
      return;
    }
    this.quickPicks.hidden = false;
    this.quickPicks.innerHTML = groups.map(({ label, items }) => `
      <div class="natural-quick-group">
        <span>${escapeHtml(label)}</span>
        <div>
          ${items.map((item) => `
            <button
              type="button"
              data-natural-object-key="${escapeHtml(item.key)}"
              title="${escapeHtml(item.label)}"
            >
              <span>${escapeHtml(item.icon)}</span>${escapeHtml(item.label)}
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  selectQuickPick(key) {
    let card = this.objectPalette?.querySelector(`.object-card[data-object-key="${CSS.escape(key)}"]`);
    if (!card) {
      if (this.objectSearch) {
        this.objectSearch.value = '';
        this.objectSearch.dispatchEvent(new Event('input', { bubbles: true }));
      }
      clickCategory(this.root, 'all');
      card = this.objectPalette?.querySelector(`.object-card[data-object-key="${CSS.escape(key)}"]`);
    }
    card?.click();
  }

  showFirstRunHint() {
    const key = NATURAL_EDITOR_UI_CONFIG.storage.hintKey;
    try {
      if (globalThis.localStorage?.getItem(key)) return;
      globalThis.localStorage?.setItem(key, '1');
    } catch {
      // Storage is optional.
    }
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'natural-first-run-hint';
    hint.textContent = NATURAL_EDITOR_UI_CONFIG.hints.firstRun;
    hint.title = 'Dismiss';
    this.viewport.append(hint);
    const remove = () => hint.remove();
    hint.addEventListener('click', remove, { once: true });
    setTimeout(remove, NATURAL_EDITOR_UI_CONFIG.motion.hintDurationMs);
  }
}

function installWhenReady() {
  const root = document.querySelector('#app');
  const shell = root?.querySelector('.editor-shell');
  const sidebar = root?.querySelector('.sidebar');
  const viewport = root?.querySelector('[data-role="viewport"]');
  if (root && shell && sidebar && viewport && shell.dataset[INSTALL_MARK] !== 'true') {
    new NaturalEditorUi(root);
    return true;
  }
  return false;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
