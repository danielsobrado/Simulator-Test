const TOOL_SHORTCUTS = Object.freeze({
  t: 'terrain',
  n: 'nature',
  b: 'build',
  c: 'build',
  o: 'decor',
  d: 'decor',
});

function isTypingTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable === true;
}

function naturalToolButton(id) {
  return document.querySelector(`[data-natural-tool="${id}"]`);
}

function installShortcutBridge() {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
    const tool = TOOL_SHORTCUTS[event.key.toLowerCase()];
    const button = tool ? naturalToolButton(tool) : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.click();
  }, true);
}

function mirrorButtonState(root, action) {
  const source = root.querySelector(`.sidebar [data-action="${action}"]`);
  if (!source) return null;
  const sync = () => {
    for (const target of root.querySelectorAll(`.natural-top-chrome [data-action="${action}"]`)) {
      target.disabled = source.disabled;
      target.setAttribute('aria-disabled', String(source.disabled));
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { attributes: true, attributeFilter: ['disabled'] });
  return observer;
}

function installStateBridge() {
  const root = document.querySelector('#app');
  if (!root?.querySelector('.natural-top-chrome')) return false;
  mirrorButtonState(root, 'undo');
  mirrorButtonState(root, 'redo');
  return true;
}

installShortcutBridge();

if (!installStateBridge()) {
  const observer = new MutationObserver(() => {
    if (installStateBridge()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
