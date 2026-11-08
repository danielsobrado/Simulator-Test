/** Gods' End precipitation, scaled from its 5 m characters to human metres. */
export const DEFAULT_WEATHER_EFFECTS = Object.freeze({
  rain: Object.freeze({
    count: 10000, area: 48, top: 36, bottom: -12, speed: -16.2,
    windVariation: 0.6, turbulence: 0.29, dropLength: 0.648,
    dropWidth: 0.0126, opacity: 2, colorLinear: Object.freeze([0.78, 0.86, 1]),
  }),
  snowfall: Object.freeze({
    regionalIntensity: 1, regionalMinCoverage: 0.2, regionalFullCoverage: 0.7, regionalFadeRate: 1.2,
    count: 12000, top: 16.2, bottom: -3.6, speed: 1.224,
    swayRadius: 0.504, swayFrequency: 0.6, turbulence: 0.396,
    opacity: 0.95, color: '#dae6f6',
    layers: Object.freeze([
      Object.freeze({ share: 0.56, area: 46.8, sizeMin: 0.018, sizeMax: 0.0396, opacity: 0.75, speedScale: 0.8, nearFade: 1.44, softness: 0, brightness: 0.9 }),
      Object.freeze({ share: 0.43, area: 16.56, sizeMin: 0.0324, sizeMax: 0.0792, opacity: 0.9, speedScale: 1, nearFade: 1.44, softness: 0, brightness: 1 }),
      Object.freeze({ share: 0.012, area: 6.48, sizeMin: 0.108, sizeMax: 0.198, opacity: 0.4, speedScale: 1.3, nearFade: 0.432, softness: 1, brightness: 0.75 }),
    ]),
  }),
});

function number(value, path, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}

function count(value, path) {
  number(value, path, 1, 20000);
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
}

export function resolveWeatherEffects(source = {}) {
  const rain = { ...DEFAULT_WEATHER_EFFECTS.rain, ...source.rain };
  const snowfall = { ...DEFAULT_WEATHER_EFFECTS.snowfall, ...source.snowfall };
  for (const [name, settings] of [['rain', rain], ['snowfall', snowfall]]) {
    const path = `weatherEffects.${name}`;
    count(settings.count, `${path}.count`);
    number(settings.top, `${path}.top`);
    number(settings.bottom, `${path}.bottom`);
    if (settings.top <= settings.bottom) throw new Error(`${path}.top must exceed bottom.`);
    number(settings.speed, `${path}.speed`);
    if (settings.speed === 0 || (name === 'snowfall' && settings.speed < 0)) {
      throw new Error(`${path}.speed must move precipitation downwards.`);
    }
    number(settings.turbulence, `${path}.turbulence`, 0, 10);
  }
  for (const key of ['area', 'dropLength', 'dropWidth']) number(rain[key], `weatherEffects.rain.${key}`, 1e-4, 200);
  number(rain.windVariation, 'weatherEffects.rain.windVariation', 0, 1);
  number(rain.opacity, 'weatherEffects.rain.opacity', 0, 4);
  if (!Array.isArray(rain.colorLinear) || rain.colorLinear.length !== 3) throw new Error('weatherEffects.rain.colorLinear must contain three channels.');
  rain.colorLinear.forEach(value => number(value, 'weatherEffects.rain.colorLinear', 0, 1));
  for (const key of ['swayRadius', 'swayFrequency']) number(snowfall[key], `weatherEffects.snowfall.${key}`, 0, 10);
  number(snowfall.opacity, 'weatherEffects.snowfall.opacity', 0, 1);
  for (const key of ['regionalIntensity', 'regionalMinCoverage', 'regionalFullCoverage']) {
    number(snowfall[key], `weatherEffects.snowfall.${key}`, 0, 1);
  }
  number(snowfall.regionalFadeRate, 'weatherEffects.snowfall.regionalFadeRate', 0.01, 20);
  if (snowfall.regionalFullCoverage <= snowfall.regionalMinCoverage) {
    throw new Error('weatherEffects.snowfall.regionalFullCoverage must exceed regionalMinCoverage.');
  }
  if (!/^#[0-9a-f]{6}$/i.test(snowfall.color)) throw new Error('weatherEffects.snowfall.color must be a hex colour.');
  if (!Array.isArray(snowfall.layers) || !snowfall.layers.length || snowfall.layers.length > 8) throw new Error('weatherEffects.snowfall.layers must contain 1–8 populations.');
  snowfall.layers = snowfall.layers.map((layer, index) => {
    const path = `weatherEffects.snowfall.layers[${index}]`;
    for (const key of ['share', 'area', 'sizeMin', 'sizeMax', 'speedScale']) number(layer[key], `${path}.${key}`, 1e-4, 200);
    if (layer.sizeMax < layer.sizeMin) throw new Error(`${path}.sizeMax must be at least sizeMin.`);
    for (const key of ['opacity', 'softness']) number(layer[key], `${path}.${key}`, 0, 1);
    number(layer.nearFade, `${path}.nearFade`, 0, 20);
    number(layer.brightness, `${path}.brightness`, 0, 2);
    return { ...layer };
  });
  return { rain, snowfall };
}
