import './NaturalEditorProgressiveDisclosure.css';

function wrapConstructionPrecision(root) {
  const panel = root.querySelector('[data-panel="construction"]');
  if (!panel || panel.querySelector('.natural-precision-controls')) return;
  const fields = [...panel.querySelectorAll(':scope > label.panel-note')];
  if (fields.length === 0) return;

  const details = document.createElement('details');
  details.className = 'natural-precision-controls';
  const summary = document.createElement('summary');
  summary.textContent = 'Precision';
  const body = document.createElement('div');
  body.className = 'natural-precision-controls__body';
  details.append(summary, body);
  fields[0].before(details);
  body.append(...fields);
}

function collapseAdvancedSettings(root) {
  const panel = root.querySelector('[data-panel="settings"]');
  if (!panel || panel.querySelector('.natural-advanced-settings')) return;
  const sceneGroups = [...panel.querySelectorAll(':scope > .settings-group.scene-settings')];
  const advancedStart = sceneGroups[2];
  if (!advancedStart) return;

  const details = document.createElement('details');
  details.className = 'natural-advanced-settings';
  const summary = document.createElement('summary');
  summary.innerHTML = '<strong>Creator & rendering</strong><span>Advanced</span>';
  const body = document.createElement('div');
  body.className = 'natural-advanced-settings__body';
  details.append(summary, body);

  let node = advancedStart;
  while (node) {
    const next = node.nextSibling;
    body.append(node);
    node = next;
  }
  panel.append(details);

  const intro = document.createElement('div');
  intro.className = 'natural-settings-intro';
  intro.innerHTML = '<strong>World settings</strong><span>Everyday world and appearance controls stay visible. Technical creator controls are tucked away below.</span>';
  panel.prepend(intro);
}

function install(root) {
  wrapConstructionPrecision(root);
  collapseAdvancedSettings(root);
}

function installWhenReady() {
  const root = document.querySelector('#app');
  if (!root?.querySelector('.editor-shell')) return false;
  install(root);
  return true;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
