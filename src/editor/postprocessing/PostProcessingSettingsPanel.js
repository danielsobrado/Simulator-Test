function nestedPatch(path, value) {
  const parts = path.split('.');
  const result = {};
  let current = result;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] = {};
    current = current[parts[index]];
  }
  current[parts.at(-1)] = value;
  return result;
}

function controlValue(control) {
  if (control.type === 'checkbox') return control.checked;
  if (control.tagName === 'SELECT') return control.value;
  return Number(control.value);
}

function range(label, path, min, max, step, precision = 2) {
  return `
    <label class="settings-range">
      <span>${label}</span>
      <output data-post-output="${path}">—</output>
      <input type="range" min="${min}" max="${max}" step="${step}"
        data-post-setting="${path}" data-precision="${precision}" />
    </label>
  `;
}

function toggle(label, path) {
  return `
    <label class="settings-toggle">
      <span>${label}</span>
      <input type="checkbox" data-post-setting="${path}" />
    </label>
  `;
}

function select(label, path, options) {
  return `
    <label class="settings-select">
      <span>${label}</span>
      <select data-post-setting="${path}">
        ${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}
      </select>
    </label>
  `;
}

function panelMarkup() {
  return `
    <details class="settings-group" data-post-processing-panel open>
      <summary>Post-processing</summary>
      <p class="settings-hint">Every effect is optional. God-ray technique remains in the section below.</p>
      ${toggle('Enable post-processing', 'enabled')}
      ${select('Quality preset', 'preset', [
        ['off', 'Off'], ['low', 'Low'], ['balanced', 'Balanced'],
        ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom'],
      ])}

      <h4>Anti-aliasing</h4>
      ${toggle('Temporal anti-aliasing', 'antiAliasing.enabled')}
      ${range('Motion rejection', 'antiAliasing.maxVelocityPixels', 8, 256, 1, 0)}
      ${toggle('Subpixel correction', 'antiAliasing.subpixelCorrection')}

      <h4>Bloom</h4>
      ${toggle('Bloom', 'bloom.enabled')}
      ${range('Intensity', 'bloom.intensity', 0, 1.5, 0.01)}
      ${range('Radius', 'bloom.radius', 0, 1, 0.01)}
      ${range('Threshold', 'bloom.threshold', 0.25, 8, 0.05)}
      ${range('Soft knee', 'bloom.softKnee', 0.001, 1, 0.01, 3)}

      <h4>Tone mapping</h4>
      ${toggle('Tone mapping', 'toneMapping.enabled')}
      ${select('Curve', 'toneMapping.mode', [
        ['agx', 'AgX'], ['aces', 'ACES'], ['neutral', 'Neutral'], ['none', 'None'],
      ])}
      ${range('Exposure', 'toneMapping.exposure', 0.25, 2.5, 0.01)}
      ${range('Contrast', 'toneMapping.contrast', 0.8, 1.2, 0.01)}
      ${range('Saturation', 'toneMapping.saturation', 0.8, 1.2, 0.01)}

      <h4>Sharpening</h4>
      ${toggle('Contrast-adaptive sharpening', 'sharpen.enabled')}
      ${range('Amount', 'sharpen.amount', 0, 0.8, 0.01)}

      <h4>Reflections</h4>
      ${toggle('Screen-space reflections', 'ssr.enabled')}
      ${select('SSR quality', 'ssr.quality', [
        ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'],
      ])}
      ${range('SSR intensity', 'ssr.intensity', 0, 1, 0.01)}
      ${range('Maximum distance', 'ssr.maxDistance', 10, 200, 1, 0)}
      ${range('Thickness', 'ssr.thickness', 0.05, 2, 0.05, 2)}
      ${range('Roughness cutoff', 'ssr.roughnessCutoff', 0, 0.8, 0.01)}

      <h4>Depth of field</h4>
      ${toggle('Depth of field', 'depthOfField.enabled')}
      ${range('Focus distance', 'depthOfField.focusDistance', 0.5, 2000, 0.5, 1)}
      ${range('Focal range', 'depthOfField.focalLength', 1, 1000, 1, 0)}
      ${range('Blur amount', 'depthOfField.bokehScale', 0, 8, 0.1, 1)}

      <h4>Lens effects</h4>
      ${toggle('Vignette', 'vignette.enabled')}
      ${range('Vignette intensity', 'vignette.intensity', 0, 0.5, 0.01)}
      ${toggle('Film grain', 'grain.enabled')}
      ${range('Grain intensity', 'grain.intensity', 0, 0.05, 0.001, 3)}

      <h4>Diagnostics</h4>
      ${toggle('Debug output', 'diagnostics.enabled')}
      ${select('Debug view', 'diagnostics.debugView', [
        ['final', 'Final'], ['hdr', 'HDR'], ['depth', 'Depth'], ['normal', 'Normal'],
        ['velocity', 'Velocity'], ['metalrough', 'Metalness / roughness'],
        ['bloom', 'Bloom'], ['ssr', 'SSR'], ['taa', 'TAA'],
      ])}
      <div class="settings-actions">
        <button class="action-button" type="button" data-post-action="reset-history">Reset history</button>
        <button class="action-button" type="button" data-post-action="reset">Reset settings</button>
      </div>
    </details>
  `;
}

function readPath(settings, path) {
  return path.split('.').reduce((current, key) => current?.[key], settings);
}

export function mountPostProcessingSettings(root, controller) {
  if (!root || !controller || root.querySelector('[data-post-processing-panel]')) return null;
  root.insertAdjacentHTML('beforeend', panelMarkup());
  const panel = root.querySelector('[data-post-processing-panel]');
  const controls = [...panel.querySelectorAll('[data-post-setting]')];
  let pendingFrame = 0;
  let pendingPath = null;
  let pendingValue = null;

  const flushPending = () => {
    pendingFrame = 0;
    if (pendingPath === null) return;
    controller.setSettings(nestedPatch(pendingPath, pendingValue));
    pendingPath = null;
    pendingValue = null;
  };

  const sync = (settings) => {
    for (const control of controls) {
      const value = readPath(settings, control.dataset.postSetting);
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
      const output = panel.querySelector(`[data-post-output="${control.dataset.postSetting}"]`);
      if (output) output.value = Number(value).toFixed(Number(control.dataset.precision ?? 2));
    }
  };

  panel.addEventListener('input', (event) => {
    const control = event.target.closest('[data-post-setting]');
    if (!control) return;
    if (control.dataset.postSetting === 'preset') {
      if (pendingFrame) {
        cancelAnimationFrame(pendingFrame);
        flushPending();
      }
      if (control.value !== 'custom') controller.applyPreset(control.value);
      return;
    }
    const value = controlValue(control);
    if (control.type === 'range') {
      pendingPath = control.dataset.postSetting;
      pendingValue = value;
      if (!pendingFrame) pendingFrame = requestAnimationFrame(flushPending);
      return;
    }
    controller.setSettings(nestedPatch(control.dataset.postSetting, value));
  });

  panel.addEventListener('click', (event) => {
    const action = event.target.closest('[data-post-action]')?.dataset.postAction;
    if (!action) return;
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      pendingPath = null;
      pendingValue = null;
    }
    if (action === 'reset') controller.reset();
    if (action === 'reset-history') controller.invalidate('manual');
  });

  const unsubscribe = controller.subscribe(sync);
  sync(controller.getSettings());
  return () => {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    unsubscribe();
    panel.remove();
  };
}
