const WEATHER_MODES = Object.freeze([
  'off',
  'meadow',
  'rain',
  'snow',
  'sandstorm',
  'storm',
  'wind',
]);

/**
 * Compact weather toggles for walk-mode. Settings live in editor.config.yaml
 * under `weather:` and can be overridden live via this panel.
 */
export function createWeatherUi({ root = document.body, settings, onChange } = {}) {
  const panel = document.createElement('div');
  panel.className = 'weather-panel';
  panel.setAttribute('aria-label', 'Weather');
  panel.innerHTML = `
    <div class="weather-panel-title">Weather</div>
    <label class="weather-panel-row">
      <span>Mode</span>
      <select data-weather="mode"></select>
    </label>
    <label class="weather-panel-row">
      <span>Intensity</span>
      <input data-weather="intensity" type="range" min="0" max="1.5" step="0.05" />
    </label>
    <label class="weather-panel-row">
      <span>Wind X</span>
      <input data-weather="windX" type="range" min="-3" max="3" step="0.05" />
    </label>
    <label class="weather-panel-row">
      <span>Wind Z</span>
      <input data-weather="windZ" type="range" min="-3" max="3" step="0.05" />
    </label>
  `;

  const modeSelect = panel.querySelector('[data-weather="mode"]');
  for (const mode of WEATHER_MODES) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    modeSelect.append(option);
  }
  const intensity = panel.querySelector('[data-weather="intensity"]');
  const windX = panel.querySelector('[data-weather="windX"]');
  const windZ = panel.querySelector('[data-weather="windZ"]');

  const sync = (next) => {
    modeSelect.value = next.weatherMode;
    intensity.value = String(next.weatherIntensity);
    windX.value = String(next.weatherWindX);
    windZ.value = String(next.weatherWindZ);
  };
  sync(settings);

  const emit = () => {
    onChange?.({
      weatherMode: modeSelect.value,
      weatherIntensity: Number(intensity.value),
      weatherWindX: Number(windX.value),
      weatherWindZ: Number(windZ.value),
    });
  };
  modeSelect.addEventListener('change', emit);
  intensity.addEventListener('input', emit);
  windX.addEventListener('input', emit);
  windZ.addEventListener('input', emit);

  root.append(panel);

  return {
    sync,
    dispose() {
      panel.remove();
    },
  };
}
