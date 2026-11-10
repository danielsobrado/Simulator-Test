/** Gods' End precipitation, scaled from its 5 m characters to human metres. */
const freezeLayer = (layer) => Object.freeze({ ...layer, counts: Object.freeze(layer.counts) });

/**
 * Per-level tables (storm plan §3.5) are five values, one per level: clear,
 * light, moderate, heavy, storm. `counts` are live instances per layer; each
 * field is allocated at its largest level and culls the rest (precipitationLayers.js).
 */
export const DEFAULT_WEATHER_EFFECTS = Object.freeze({
  rain: Object.freeze({
    windVariation: 0.6, turbulence: 0.29, opacity: 2, colorLinear: Object.freeze([0.78, 0.86, 1]),
    layers: Object.freeze([
      { area: 12, top: 8, bottom: -4, lengthMin: 0.5, lengthMax: 0.9, widthMin: 0.008, widthMax: 0.014, counts: [0, 600, 1500, 3000, 4500] },
      { area: 48, top: 36, bottom: -12, lengthMin: 0.29, lengthMax: 0.87, widthMin: 0.0069, widthMax: 0.0158, counts: [0, 2500, 6000, 10000, 14000] },
      { area: 110, top: 60, bottom: -12, lengthMin: 2, lengthMax: 4, widthMin: 0.03, widthMax: 0.05, counts: [0, 400, 1200, 2500, 4000] },
    ].map(freezeLayer)),
    levels: Object.freeze({
      fallSpeed: Object.freeze([12, 12, 14, 16, 18]),
      opacity: Object.freeze([0.8, 0.8, 1, 1, 1]),
      hardSplashes: Object.freeze([0, 60, 140, 220, 320]),
      waterSplashes: Object.freeze([0, 40, 80, 120, 180]),
    }),
  }),
  snowfall: Object.freeze({
    // Regional snow over snow country: 1 = the moderate level (≈ the former full 12 000 flakes).
    regionalIntensity: 1, regionalMinCoverage: 0.2, regionalFullCoverage: 0.7, regionalFadeRate: 1.2,
    top: 16.2, bottom: -3.6, speed: 1.224,
    swayRadius: 0.504, swayFrequency: 0.6, turbulence: 0.396,
    opacity: 0.95, color: '#dae6f6',
    // Shutter of the motion streak: a gale's flakes draw as dashes along the wind.
    streakSeconds: 0.04,
    layers: Object.freeze([
      { area: 46.8, sizeMin: 0.018, sizeMax: 0.0396, opacity: 0.75, speedScale: 0.8, nearFade: 1.44, softness: 0, brightness: 0.9, counts: [0, 2000, 6700, 12000, 14000] },
      { area: 16.56, sizeMin: 0.0324, sizeMax: 0.0792, opacity: 0.9, speedScale: 1, nearFade: 1.44, softness: 0, brightness: 1, counts: [0, 1500, 5200, 9000, 12000] },
      // Near-soft flakes wrap their 6.5 m box every 0.4 s in a gale: culled at storm (§3.4).
      { area: 6.48, sizeMin: 0.108, sizeMax: 0.198, opacity: 0.4, speedScale: 1.3, nearFade: 0.432, softness: 1, brightness: 0.75, counts: [0, 40, 144, 200, 0] },
      // The falling curtain: large soft flakes from ~25 m out, gathered into drifting sheets.
      { area: 140, sizeMin: 0.14, sizeMax: 0.3, opacity: 0.32, speedScale: 1, nearFade: 9, softness: 1, brightness: 0.95, sheets: 1, counts: [0, 0, 1500, 3500, 5500] },
    ].map(freezeLayer)),
    levels: Object.freeze({
      driftCap: Object.freeze([3, 3, 5, 9, 15]),
    }),
  }),
});

/** Most instances one precipitation field may allocate (the storm's). */
export const MAX_FIELD_INSTANCES = 32000;

function number(value, path, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}

function levels(values, path, min, max) {
  if (!Array.isArray(values) || values.length !== 5) throw new Error(`${path} must list five levels (clear … storm).`);
  values.forEach((value, index) => number(value, `${path}[${index}]`, min, max));
  return [...values];
}

function fieldLayers(source, path, check) {
  if (!Array.isArray(source) || !source.length || source.length > 8) throw new Error(`${path} must contain 1–8 populations.`);
  const layers = source.map((layer, index) => {
    const at = `${path}[${index}]`;
    check(layer, at);
    return { ...layer, counts: levels(layer.counts, `${at}.counts`, 0, MAX_FIELD_INSTANCES) };
  });
  const allocated = layers.reduce((sum, layer) => sum + Math.max(...layer.counts), 0);
  if (allocated < 1 || allocated > MAX_FIELD_INSTANCES) throw new Error(`${path} must allocate 1–${MAX_FIELD_INSTANCES} instances at its densest level.`);
  return layers;
}

export function resolveWeatherEffects(source = {}) {
  const rain = { ...DEFAULT_WEATHER_EFFECTS.rain, ...source.rain };
  const snowfall = { ...DEFAULT_WEATHER_EFFECTS.snowfall, ...source.snowfall };
  number(rain.turbulence, 'weatherEffects.rain.turbulence', 0, 10);
  number(rain.windVariation, 'weatherEffects.rain.windVariation', 0, 1);
  number(rain.opacity, 'weatherEffects.rain.opacity', 0, 4);
  if (!Array.isArray(rain.colorLinear) || rain.colorLinear.length !== 3) throw new Error('weatherEffects.rain.colorLinear must contain three channels.');
  rain.colorLinear.forEach(value => number(value, 'weatherEffects.rain.colorLinear', 0, 1));
  rain.layers = fieldLayers(rain.layers, 'weatherEffects.rain.layers', (layer, at) => {
    for (const key of ['area', 'lengthMin', 'lengthMax', 'widthMin', 'widthMax']) number(layer[key], `${at}.${key}`, 1e-4, 200);
    number(layer.top, `${at}.top`, -500, 500);
    number(layer.bottom, `${at}.bottom`, -500, 500);
    if (layer.top <= layer.bottom) throw new Error(`${at}.top must exceed bottom.`);
    if (layer.lengthMax < layer.lengthMin || layer.widthMax < layer.widthMin) throw new Error(`${at} max sizes must be at least their minimums.`);
  });
  const rainLevels = { ...DEFAULT_WEATHER_EFFECTS.rain.levels, ...source.rain?.levels };
  rain.levels = {
    fallSpeed: levels(rainLevels.fallSpeed, 'weatherEffects.rain.levels.fallSpeed', 0.5, 60),
    opacity: levels(rainLevels.opacity, 'weatherEffects.rain.levels.opacity', 0, 2),
    hardSplashes: levels(rainLevels.hardSplashes, 'weatherEffects.rain.levels.hardSplashes', 0, 2000),
    waterSplashes: levels(rainLevels.waterSplashes, 'weatherEffects.rain.levels.waterSplashes', 0, 2000),
  };

  const path = 'weatherEffects.snowfall';
  number(snowfall.top, `${path}.top`);
  number(snowfall.bottom, `${path}.bottom`);
  if (snowfall.top <= snowfall.bottom) throw new Error(`${path}.top must exceed bottom.`);
  number(snowfall.speed, `${path}.speed`);
  if (!(snowfall.speed > 0)) throw new Error(`${path}.speed must move precipitation downwards.`);
  number(snowfall.turbulence, `${path}.turbulence`, 0, 10);
  for (const key of ['swayRadius', 'swayFrequency']) number(snowfall[key], `${path}.${key}`, 0, 10);
  number(snowfall.opacity, `${path}.opacity`, 0, 1);
  for (const key of ['regionalIntensity', 'regionalMinCoverage', 'regionalFullCoverage']) number(snowfall[key], `${path}.${key}`, 0, 1);
  number(snowfall.regionalFadeRate, `${path}.regionalFadeRate`, 0.01, 20);
  if (snowfall.regionalFullCoverage <= snowfall.regionalMinCoverage) {
    throw new Error(`${path}.regionalFullCoverage must exceed regionalMinCoverage.`);
  }
  if (!/^#[0-9a-f]{6}$/i.test(snowfall.color)) throw new Error(`${path}.color must be a hex colour.`);
  number(snowfall.streakSeconds, `${path}.streakSeconds`, 0, 0.2);
  snowfall.layers = fieldLayers(snowfall.layers, `${path}.layers`, (layer, at) => {
    for (const key of ['area', 'sizeMin', 'sizeMax', 'speedScale']) number(layer[key], `${at}.${key}`, 1e-4, 200);
    if (layer.sizeMax < layer.sizeMin) throw new Error(`${at}.sizeMax must be at least sizeMin.`);
    for (const key of ['opacity', 'softness']) number(layer[key], `${at}.${key}`, 0, 1);
    number(layer.nearFade, `${at}.nearFade`, 0, 20);
    number(layer.brightness, `${at}.brightness`, 0, 2);
    if (layer.sheets !== undefined) number(layer.sheets, `${at}.sheets`, 0, 1);
  });
  const snowLevels = { ...DEFAULT_WEATHER_EFFECTS.snowfall.levels, ...source.snowfall?.levels };
  snowfall.levels = { driftCap: levels(snowLevels.driftCap, `${path}.levels.driftCap`, 0, 40) };
  return { rain, snowfall };
}
