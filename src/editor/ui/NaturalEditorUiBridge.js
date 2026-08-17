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
  const worldMenuHelp = root.querySelector('.natural-world-menu p');
  if (worldMenuHelp) {
    worldMenuHelp.textContent = 'Save, restore or start fresh. Appearance, imports and creator tools live in Settings.';
  }
  return true;
}

if (!installStateBridge()) {
  const observer = new MutationObserver(() => {
    if (installStateBridge()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
