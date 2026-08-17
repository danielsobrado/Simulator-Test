const DISMISS_AFTER_SELECTORS = Object.freeze([
  '[data-object-key]',
  '[data-tile-id]',
  '[data-natural-object-key]',
  '[data-natural-recommendation]',
]);
const BUILD_ACTIONS_WITHOUT_DRAWER = new Set(['wall', 'workshop']);

function scheduleDrawerState(sidebar, dismissed) {
  requestAnimationFrame(() => sidebar.classList.toggle('is-dismissed', dismissed));
}

function installDrawerBehavior() {
  const root = document.querySelector('#app');
  const sidebar = root?.querySelector('.sidebar');
  const toolbar = root?.querySelector('.natural-toolbar');
  if (!sidebar || !toolbar) return false;

  let toolbarPress = null;
  toolbar.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('[data-natural-tool]');
    if (!button) return;
    toolbarPress = {
      id: button.dataset.naturalTool,
      wasActive: button.classList.contains('is-active'),
      wasDismissed: sidebar.classList.contains('is-dismissed'),
    };
  });

  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-natural-tool]');
    if (!button) return;
    const press = toolbarPress?.id === button.dataset.naturalTool ? toolbarPress : null;
    toolbarPress = null;
    if (press?.wasActive) {
      scheduleDrawerState(sidebar, !press.wasDismissed);
      return;
    }
    if (button.dataset.naturalTool === 'build') scheduleDrawerState(sidebar, true);
  });

  root.addEventListener('click', (event) => {
    if (DISMISS_AFTER_SELECTORS.some((selector) => event.target.closest(selector))) {
      scheduleDrawerState(sidebar, true);
      return;
    }
    const buildAction = event.target.closest('[data-natural-build-action]');
    if (BUILD_ACTIONS_WITHOUT_DRAWER.has(buildAction?.dataset.naturalBuildAction)) {
      scheduleDrawerState(sidebar, true);
    }
  });

  const constructionDelete = root.querySelector('.sidebar [data-action="delete-construction"]');
  if (constructionDelete) {
    const hideForDirectSelection = () => {
      if (!constructionDelete.disabled) scheduleDrawerState(sidebar, true);
    };
    const observer = new MutationObserver(hideForDirectSelection);
    observer.observe(constructionDelete, { attributes: true, attributeFilter: ['disabled'] });
    hideForDirectSelection();
  }

  const terrainTool = toolbar.querySelector('[data-natural-tool="terrain"]');
  if (terrainTool?.classList.contains('is-active')) scheduleDrawerState(sidebar, true);
  return true;
}

if (!installDrawerBehavior()) {
  const observer = new MutationObserver(() => {
    if (installDrawerBehavior()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
