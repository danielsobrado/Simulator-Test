import './NaturalEditorProgressiveDisclosure.css';

const ADVANCED_WORLD_ACTIONS = Object.freeze([
  'export-scene-settings',
  'import-scene-settings',
]);

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

function moveWorldAppearanceTechnicalControls(appearanceGroup, advancedBody) {
  const technical = document.createElement('div');
  technical.className = 'settings-group natural-advanced-world-appearance';
  technical.innerHTML = '<h3>Appearance import & export</h3><p>Creator-only JSON and URL tools.</p>';

  const technicalGrid = document.createElement('div');
  technicalGrid.className = 'action-grid';
  for (const action of ADVANCED_WORLD_ACTIONS) {
    const button = appearanceGroup.querySelector(`[data-action="${action}"]`);
    if (button) technicalGrid.append(button);
  }
  if (technicalGrid.childElementCount > 0) technical.append(technicalGrid);

  const urlInput = appearanceGroup.querySelector('[data-role="scene-settings-url"]');
  const urlLabel = urlInput?.closest('label');
  if (urlLabel) technical.append(urlLabel);
  const urlLoad = appearanceGroup.querySelector('[data-action="load-scene-settings-url"]');
  if (urlLoad) technical.append(urlLoad);
  const fileInput = appearanceGroup.querySelector('[data-role="scene-settings-file-input"]');
  if (fileInput) technical.append(fileInput);

  if (technical.childElementCount > 2) advancedBody.prepend(technical);

  const heading = appearanceGroup.querySelector('h2');
  if (heading) heading.textContent = 'World appearance';
  const description = appearanceGroup.querySelector(':scope > p');
  if (description) {
    description.textContent = 'Choose a named look, or save the current appearance as a preset.';
  }
}

function collapseAdvancedSettings(root) {
  const panel = root.querySelector('[data-panel="settings"]');
  if (!panel || panel.querySelector('.natural-advanced-settings')) return;
  const sceneGroups = [...panel.querySelectorAll(':scope > .settings-group.scene-settings')];
  const appearanceGroup = sceneGroups[0];
  const advancedStart = sceneGroups[1];
  if (!appearanceGroup || !advancedStart) return;

  const details = document.createElement('details');
  details.className = 'natural-advanced-settings';
  const summary = document.createElement('summary');
  summary.innerHTML = '<strong>Creator, import & rendering</strong><span>Advanced</span>';
  const body = document.createElement('div');
  body.className = 'natural-advanced-settings__body';
  details.append(summary, body);

  let node = advancedStart;
  while (node) {
    const next = node.nextSibling;
    body.append(node);
    node = next;
  }
  moveWorldAppearanceTechnicalControls(appearanceGroup, body);
  panel.append(details);

  const intro = document.createElement('div');
  intro.className = 'natural-settings-intro';
  intro.innerHTML = '<strong>Settings</strong><span>Everyday appearance stays simple. Map imports, GLBs and render tuning are available only when you open Advanced.</span>';
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
