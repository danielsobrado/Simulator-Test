import {
  DEBUG_VIEWS,
  DEFAULT_POST_PROCESSING_SETTINGS,
  DOF_FOCUS_MODES,
  postProcessingSettingsToPlain,
  TONE_MAPPING_MODES,
} from '../../render/postprocessing/PostProcessingSettings.js';
import {
  applyPostProcessingPreset,
  applySsrQuality,
  listPostProcessingPresets,
  resolveSsrQuality,
} from '../../render/postprocessing/PostProcessingPresets.js';

const SECTIONS = Object.freeze([
  ['General', [
    ['Enabled', 'enabled', 'boolean'],
    ['Preset', 'preset', 'preset'],
    ['Render scale', 'renderScale', 'range', 0.67, 1, 0.01, 2],
  ]],
  ['Anti-aliasing', [
    ['Enabled', 'antiAliasing.enabled', 'boolean'],
    ['Mode', 'antiAliasing.mode', 'select', [['traa', 'TRAA'], ['traau', 'TRAAU']]],
    ['Jitter samples', 'antiAliasing.jitterSamples', 'range', 1, 16, 1, 0],
    ['History feedback', 'antiAliasing.feedback', 'range', 0.7, 0.97, 0.01, 2],
    ['Variance gamma', 'antiAliasing.varianceGamma', 'range', 0.75, 2.5, 0.05, 2],
    ['Depth rejection minimum (m)', 'antiAliasing.depthRejectionMinMeters', 'range', 0, 10, 0.01, 2],
    ['Depth rejection scale', 'antiAliasing.depthRejectionScale', 'range', 0, 1, 0.01, 2],
    ['Reactive strength', 'antiAliasing.reactiveStrength', 'range', 0, 1, 0.01, 2],
    ['Motion rejection (px)', 'antiAliasing.motionRejectionPixels', 'range', 1, 256, 1, 0],
    ['History clamp strength', 'antiAliasing.historyClampStrength', 'range', 0, 2, 0.05, 2],
  ]],
  ['Bloom', [
    ['Enabled', 'bloom.enabled', 'boolean'],
    ['Intensity', 'bloom.intensity', 'range', 0, 1.5, 0.01, 2],
    ['Threshold', 'bloom.threshold', 'range', 0.5, 8, 0.05, 2],
    ['Knee', 'bloom.knee', 'range', 0.05, 3, 0.05, 2],
    ['Levels', 'bloom.levels', 'range', 2, 6, 1, 0],
    ['Bloom boost', 'bloom.bloomBoost', 'range', 0, 8, 0.1, 1],
  ]],
  ['Tone mapping', [
    ['Enabled', 'toneMapping.enabled', 'boolean'],
    ['Mode', 'toneMapping.mode', 'select', TONE_MAPPING_MODES.map((value) => [value, value.toUpperCase()])],
    ['Exposure', 'toneMapping.exposure', 'range', 0.25, 2.5, 0.01, 2],
    ['Contrast', 'toneMapping.contrast', 'range', 0.8, 1.2, 0.01, 2],
    ['Saturation', 'toneMapping.saturation', 'range', 0.8, 1.2, 0.01, 2],
  ]],
  ['Sharpening', [
    ['Enabled', 'sharpen.enabled', 'boolean'],
    ['Amount', 'sharpen.amount', 'range', 0, 0.8, 0.01, 2],
  ]],
  ['Reflections', [
    ['Enabled', 'ssr.enabled', 'boolean'],
    ['Quality', 'ssr.quality', 'ssr-quality'],
    ['Resolution scale', 'ssr.resolutionScale', 'range', 0.25, 0.75, 0.05, 2],
    ['Maximum steps', 'ssr.maxSteps', 'range', 8, 64, 1, 0],
    ['Binary steps', 'ssr.binarySteps', 'range', 0, 8, 1, 0],
    ['Maximum distance (m)', 'ssr.maxDistanceMeters', 'range', 10, 200, 1, 0],
    ['Thickness (m)', 'ssr.thicknessMeters', 'range', 0.05, 2, 0.05, 2],
    ['Roughness cutoff', 'ssr.roughnessCutoff', 'range', 0, 0.8, 0.01, 2],
    ['Intensity', 'ssr.intensity', 'range', 0, 1, 0.01, 2],
    ['Temporal feedback', 'ssr.temporalFeedback', 'range', 0.7, 0.97, 0.01, 2],
    ['Edge fade', 'ssr.edgeFade', 'range', 0, 0.5, 0.01, 2],
  ]],
  ['Depth of field', [
    ['Enabled', 'depthOfField.enabled', 'boolean'],
    ['Focus mode', 'depthOfField.focusMode', 'select', DOF_FOCUS_MODES.map((value) => [value, value])],
    ['Manual focus (m)', 'depthOfField.manualFocusMeters', 'range', 0.5, 2000, 0.5, 1],
    ['Focus smoothing', 'depthOfField.focusSmoothing', 'range', 0, 32, 0.1, 1],
    ['Maximum CoC (px)', 'depthOfField.maxCoCPixels', 'range', 0, 8, 0.1, 1],
    ['Taps', 'depthOfField.taps', 'range', 4, 32, 1, 0],
    ['Near start ratio', 'depthOfField.nearStartRatio', 'range', 0, 1, 0.01, 2],
    ['Near full ratio', 'depthOfField.nearFullRatio', 'range', 0, 1, 0.01, 2],
    ['Far start (m)', 'depthOfField.farStartMeters', 'range', 1, 5000, 1, 0],
    ['Far full (m)', 'depthOfField.farFullMeters', 'range', 1, 10000, 1, 0],
  ]],
  ['Lens effects', [
    ['Vignette enabled', 'vignette.enabled', 'boolean'],
    ['Vignette intensity', 'vignette.intensity', 'range', 0, 0.5, 0.01, 2],
    ['Vignette inner radius', 'vignette.innerRadius', 'range', 0, 2, 0.01, 2],
    ['Vignette outer radius', 'vignette.outerRadius', 'range', 0, 2, 0.01, 2],
    ['Grain enabled', 'grain.enabled', 'boolean'],
    ['Grain intensity', 'grain.intensity', 'range', 0, 0.05, 0.001, 3],
  ]],
  ['Diagnostics', [
    ['Enabled', 'diagnostics.enabled', 'boolean'],
    ['Debug view', 'diagnostics.debugView', 'select', DEBUG_VIEWS.map((value) => [value, value])],
    ['Show GPU timings', 'diagnostics.showGpuTimings', 'boolean'],
  ]],
]);

function readPath(settings, path) {
  return path.split('.').reduce((value, key) => value?.[key], settings);
}

function patchFor(path, value) {
  const keys = path.split('.');
  if (keys.length === 1) return { [path]: value };
  return { [keys[0]]: { [keys[1]]: value } };
}

function addOptions(select, options) {
  for (const [value, label] of options) select.add(new Option(label, value));
}

function createControl(definition, controls) {
  const [labelText, path, type, ...options] = definition;
  const label = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = labelText;
  label.append(caption);

  let control;
  if (type === 'boolean') {
    label.className = 'settings-toggle';
    control = document.createElement('input');
    control.type = 'checkbox';
  } else if (type === 'range') {
    label.className = 'settings-range';
    const output = document.createElement('output');
    control = document.createElement('input');
    control.type = 'range';
    [control.min, control.max, control.step] = options.slice(0, 3).map(String);
    control.dataset.precision = String(options[3]);
    control.output = output;
    label.append(output);
  } else {
    label.className = 'settings-select';
    control = document.createElement('select');
    if (type === 'preset') {
      addOptions(control, [
        ...listPostProcessingPresets().map(({ id, label: optionLabel }) => [id, optionLabel]),
        ['custom', 'Custom'],
      ]);
    } else if (type === 'ssr-quality') {
      addOptions(control, [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['custom', 'Custom']]);
    } else {
      addOptions(control, options[0]);
    }
  }
  control.dataset.postProcessingPath = path;
  control.dataset.controlType = type;
  label.append(control);
  controls.set(path, control);
  return label;
}

/**
 * Mounts the Phase 1 settings UI. The supplied store follows the
 * createPostProcessingSettings get/set/reset/subscribe contract.
 */
export function createPostProcessingSettingsPanel({
  root,
  store,
  defaults = DEFAULT_POST_PROCESSING_SETTINGS,
}) {
  if (!root || !store) throw new Error('Post-processing settings panel requires root and store.');
  const controls = new Map();
  const listeners = [];
  root.replaceChildren();
  root.classList.add('post-processing-settings');

  for (const [index, [title, definitions]] of SECTIONS.entries()) {
    const details = document.createElement('details');
    details.className = 'settings-group post-processing-settings__section';
    details.open = index === 0;
    const summary = document.createElement('summary');
    const heading = document.createElement('h3');
    heading.textContent = title;
    summary.append(heading);
    details.append(summary, ...definitions.map((definition) => createControl(definition, controls)));
    root.append(details);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'action-button action-button--wide';
  reset.textContent = 'Reset post-processing';
  root.append(reset);

  const sync = (settings = store.get()) => {
    for (const [path, control] of controls) {
      let value;
      if (path === 'ssr.quality') value = resolveSsrQuality(settings);
      else value = readPath(settings, path);
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
      if (control.output) {
        control.output.value = Number(value).toFixed(Number(control.dataset.precision));
      }
    }
    controls.get('renderScale').disabled = settings.antiAliasing.mode !== 'traau';
  };

  const update = (event) => {
    const control = event.currentTarget;
    const { postProcessingPath: path, controlType: type } = control.dataset;
    if (type === 'preset') {
      store.set(
        postProcessingSettingsToPlain(applyPostProcessingPreset(control.value, store.get())),
        { markCustom: false },
      );
      return;
    }
    if (type === 'ssr-quality') {
      if (control.value !== 'custom') {
        store.set(
          postProcessingSettingsToPlain(applySsrQuality(control.value, store.get())),
          { markCustom: false },
        );
      }
      return;
    }
    const value = control.type === 'checkbox'
      ? control.checked
      : control.tagName === 'SELECT'
        ? control.value
        : Number(control.value);
    if (control.output) {
      control.output.value = Number(value).toFixed(Number(control.dataset.precision));
    }
    store.set(patchFor(path, value), { coalesce: control.type === 'range' });
  };

  for (const control of controls.values()) {
    const eventName = control.type === 'range' ? 'input' : 'change';
    control.addEventListener(eventName, update);
    listeners.push([control, eventName, update]);
  }
  const resetSettings = () => {
    if (typeof store.reset === 'function') store.reset(defaults);
    else store.set(postProcessingSettingsToPlain(defaults), { markCustom: false });
  };
  reset.addEventListener('click', resetSettings);
  listeners.push([reset, 'click', resetSettings]);
  const unsubscribe = store.subscribe?.((settings) => sync(settings)) ?? (() => {});
  sync();

  return {
    sync,
    dispose() {
      unsubscribe();
      for (const [target, eventName, listener] of listeners) {
        target.removeEventListener(eventName, listener);
      }
      root.replaceChildren();
    },
  };
}
