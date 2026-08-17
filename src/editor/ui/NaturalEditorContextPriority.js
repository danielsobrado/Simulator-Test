function installContextPriority() {
  const root = document.querySelector('#app');
  const buildStrip = root?.querySelector('.natural-build-strip');
  const buildTool = root?.querySelector('[data-natural-tool="build"]');
  const objectContext = root?.querySelector('.natural-context-toolbar');
  const wallContext = root?.querySelector('.natural-wall-context-toolbar');
  if (!buildStrip || !buildTool || !objectContext || !wallContext) return false;

  const sync = () => {
    const hasContext = !objectContext.hidden || !wallContext.hidden;
    const buildActive = buildTool.classList.contains('is-active');
    buildStrip.hidden = !buildActive || hasContext;
  };

  const observer = new MutationObserver(sync);
  observer.observe(buildTool, { attributes: true, attributeFilter: ['class'] });
  observer.observe(objectContext, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(wallContext, { attributes: true, attributeFilter: ['hidden'] });
  sync();
  return true;
}

if (!installContextPriority()) {
  const observer = new MutationObserver(() => {
    if (installContextPriority()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
