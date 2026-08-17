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

if (!installStateBridge()) {
  const observer = new MutationObserver(() => {
    if (installStateBridge()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
