import * as THREE from 'three';
import {
  MEADOW_MODE_VISUAL_AMOUNT,
  MEADOW_MODE_VISIBILITY_GAIN,
  MeadowWeatherSystem,
} from './meadow.js';
import {
  readSunbeamMoteRuntimeSettings,
  resolveSunbeamMoteVisualState,
  sanitizeSunbeamMoteRuntimeSettings,
} from './sunbeam_mote_runtime.js';
import { readActiveBiomeVisualState } from '../_clod_shims/biome_visual_state.js';
import {
  RainWeatherSystem,
  SandstormWeatherSystem,
  SnowWeatherSystem,
} from './rain.js';
import { StormLightningSystem } from './storm_ground.js';
import { WindWeatherSystem } from './wind.js';

const DEFAULT_SETTINGS = Object.freeze({
  weatherMode: 'off',
  weatherIntensity: 0.7,
  weatherWindX: -0.42,
  weatherWindZ: 0.18,
});

const VALID_WEATHER_MODES = new Set([
  'off',
  'meadow',
  'rain',
  'snow',
  'sandstorm',
  'storm',
  'wind',
]);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeWeatherSettings(value = {}) {
  const weatherMode = VALID_WEATHER_MODES.has(value.weatherMode)
    ? value.weatherMode
    : DEFAULT_SETTINGS.weatherMode;
  return Object.freeze({
    weatherMode,
    weatherIntensity: THREE.MathUtils.clamp(
      finiteNumber(value.weatherIntensity, DEFAULT_SETTINGS.weatherIntensity),
      0,
      1.6,
    ),
    weatherWindX: THREE.MathUtils.clamp(
      finiteNumber(value.weatherWindX, DEFAULT_SETTINGS.weatherWindX),
      -5,
      5,
    ),
    weatherWindZ: THREE.MathUtils.clamp(
      finiteNumber(value.weatherWindZ, DEFAULT_SETTINGS.weatherWindZ),
      -5,
      5,
    ),
  });
}

function cloneMoteSettings(settings) {
  return {
    ...settings,
    warmColorRgb: [...settings.warmColorRgb],
    coldColorRgb: [...settings.coldColorRgb],
  };
}

function resolveMeadowSettings(weatherSettings, moteSettings) {
  const motes = cloneMoteSettings(moteSettings);
  motes.enabled = motes.enabled || weatherSettings.weatherMode === 'meadow';
  return {
    enabled: true,
    intensity: weatherSettings.weatherIntensity,
    windX: weatherSettings.weatherWindX,
    windZ: weatherSettings.weatherWindZ,
    motes,
  };
}

function resolveMeadowEnvironment(
  weatherSettings,
  visual,
  cameraPosition,
  sunDirection,
) {
  const explicitMeadow = weatherSettings.weatherMode === 'meadow';
  return {
    cameraPosition,
    sunDirection,
    amount: explicitMeadow
      ? Math.max(MEADOW_MODE_VISUAL_AMOUNT, visual.amount)
      : visual.amount,
    coldBlend: visual.coldBlend,
    localMist: visual.localMist,
    visibilityGain: explicitMeadow ? MEADOW_MODE_VISIBILITY_GAIN : 1,
  };
}

function normalizeSunDirection(value, target) {
  if (value?.isVector3) {
    target.copy(value);
  } else if (Array.isArray(value) && value.length >= 3) {
    target.set(Number(value[0]), Number(value[1]), Number(value[2]));
  } else if (value && Number.isFinite(value.x) && Number.isFinite(value.y)
      && Number.isFinite(value.z)) {
    target.set(value.x, value.y, value.z);
  } else {
    target.set(0.35, 0.85, 0.25);
  }

  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)
      || !Number.isFinite(target.z) || target.lengthSq() < 1e-8) {
    target.set(0.35, 0.85, 0.25);
  }
  return target.normalize();
}

function applyWeatherMaterialPolicy(systems) {
  for (const system of systems) {
    system.group.traverse((object) => {
      const source = object.material;
      const materials = Array.isArray(source) ? source : source ? [source] : [];
      for (const material of materials) {
        material.toneMapped = false;
        if (material.transparent && material.side === THREE.DoubleSide) {
          material.forceSinglePass = true;
        }
      }
    });
  }
}

function installWarmupProbe(scene, precompile) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const material = new THREE.PointsMaterial({
    size: 0.001,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  material.colorWrite = false;
  material.toneMapped = false;

  const probe = new THREE.Points(geometry, material);
  probe.name = 'weather-shader-warmup-probe';
  probe.frustumCulled = false;
  probe.renderOrder = -1_000_000;
  let queued = false;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    probe.removeFromParent();
    geometry.dispose();
    material.dispose();
  };

  probe.onBeforeRender = (renderer, _scene, camera) => {
    if (queued || disposed) return;
    queued = true;
    probe.onBeforeRender = () => {};
    queueMicrotask(() => {
      if (!disposed) void precompile(renderer, camera);
    });
  };
  scene.add(probe);
  return dispose;
}

/**
 * Walk-mode weather overlay. StylizedSkyView remains the lighting authority;
 * this controller owns precipitation, airborne particles, wind and lightning.
 */
export function createWeatherController(deps) {
  let settings = sanitizeWeatherSettings({
    ...DEFAULT_SETTINGS,
    ...(deps.getSettings?.() ?? {}),
  });
  let sunbeamMotes = readSunbeamMoteRuntimeSettings(settings.weatherMode === 'meadow');
  let disposed = false;
  let disposeWarmupProbe = () => {};

  const isWebGpu = deps.isWebGpu !== false;
  const meadowWeather = new MeadowWeatherSystem({
    scene: deps.scene,
    isWebGpu,
    seed: 0x6d3a8f21,
  });
  const windWeather = new WindWeatherSystem({
    scene: deps.scene,
    camera: deps.camera,
    isWebGpu,
    seed: 0x71f14d11,
  });
  const rainWeather = new RainWeatherSystem({
    scene: deps.scene,
    isWebGpu,
    worldCells: deps.worldCells,
    seed: 0xdecafbad,
    samplers: deps.samplers,
  });
  const snowWeather = new SnowWeatherSystem({
    scene: deps.scene,
    isWebGpu,
    seed: 0x51eaf00d,
  });
  const sandstormWeather = new SandstormWeatherSystem({
    scene: deps.scene,
    camera: deps.camera,
    isWebGpu,
    seed: 0x5a4d570d,
  });
  const stormWeather = new StormLightningSystem({
    scene: deps.scene,
    isWebGpu,
    worldCells: deps.worldCells,
    seed: 0x57a4d0c7,
    samplers: deps.samplers,
  });
  const systems = Object.freeze([
    meadowWeather,
    windWeather,
    rainWeather,
    snowWeather,
    sandstormWeather,
    stormWeather,
  ]);
  const sunDirection = new THREE.Vector3(0.35, 0.85, 0.25).normalize();

  applyWeatherMaterialPolicy(systems);

  const currentMeadowSettings = () => resolveMeadowSettings(settings, sunbeamMotes);
  const currentWindSettings = () => ({
    enabled: settings.weatherMode === 'wind',
    intensity: settings.weatherIntensity,
    windX: settings.weatherWindX,
    windZ: settings.weatherWindZ,
  });
  const currentRainSettings = () => ({
    enabled: settings.weatherMode === 'rain',
    intensity: settings.weatherIntensity,
    windX: settings.weatherWindX,
    windZ: settings.weatherWindZ,
  });
  const currentSnowSettings = () => ({
    enabled: settings.weatherMode === 'snow',
    intensity: settings.weatherIntensity,
    windX: settings.weatherWindX,
    windZ: settings.weatherWindZ,
  });
  const currentSandstormSettings = () => ({
    enabled: settings.weatherMode === 'sandstorm',
    intensity: settings.weatherIntensity,
    windX: settings.weatherWindX,
    windZ: settings.weatherWindZ,
  });
  const currentStormSettings = () => ({
    enabled: settings.weatherMode === 'storm',
    intensity: settings.weatherIntensity,
  });

  const applySettings = () => {
    if (disposed) return false;
    settings = sanitizeWeatherSettings({
      ...DEFAULT_SETTINGS,
      ...(deps.getSettings?.() ?? settings),
    });
    meadowWeather.applySettings(currentMeadowSettings());
    windWeather.applySettings(currentWindSettings());
    rainWeather.applySettings(currentRainSettings());
    snowWeather.applySettings(currentSnowSettings());
    sandstormWeather.applySettings(currentSandstormSettings());
    stormWeather.applySettings(currentStormSettings());
    return true;
  };
  applySettings();

  const precompile = async (renderer, camera = deps.getCamera?.() ?? deps.camera) => {
    if (disposed || !renderer || !camera) return false;
    const compile = renderer.compileAsync ?? renderer.compile;
    if (typeof compile !== 'function') return false;

    const visibility = systems.map((system) => system.group.visible);
    let restored = false;
    const restoreVisibility = () => {
      if (restored) return;
      restored = true;
      systems.forEach((system, index) => {
        system.group.visible = visibility[index];
      });
    };

    try {
      for (const system of systems) system.group.visible = true;
      const compilation = compile.call(renderer, deps.scene, camera);
      restoreVisibility();
      await compilation;
      return true;
    } catch (error) {
      console.warn('[weather] Shader precompile failed; first activation may hitch.', error);
      return false;
    } finally {
      restoreVisibility();
      disposeWarmupProbe();
    }
  };

  disposeWarmupProbe = installWarmupProbe(deps.scene, precompile);

  return {
    applySettings,
    precompile,
    setSunbeamMoteSettings(next = {}) {
      if (disposed) return false;
      sunbeamMotes = sanitizeSunbeamMoteRuntimeSettings({
        ...sunbeamMotes,
        ...next,
        warmColorRgb: next.warmColorRgb
          ? [...next.warmColorRgb]
          : [...sunbeamMotes.warmColorRgb],
        coldColorRgb: next.coldColorRgb
          ? [...next.coldColorRgb]
          : [...sunbeamMotes.coldColorRgb],
      });
      meadowWeather.applySettings(currentMeadowSettings());
      return true;
    },
    update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter) {
      if (disposed) return;
      if (deps.getCamera) sandstormWeather.camera = deps.getCamera();
      const visual = resolveSunbeamMoteVisualState(readActiveBiomeVisualState());
      normalizeSunDirection(deps.getSunDirection?.(), sunDirection);
      meadowWeather.update(
        deltaSeconds,
        elapsedSeconds,
        effectCenter,
        resolveMeadowEnvironment(settings, visual, cameraPosition, sunDirection),
      );
      windWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      rainWeather.update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter);
      snowWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      sandstormWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      stormWeather.update(deltaSeconds, elapsedSeconds, effectCenter);
    },
    getStats() {
      return Object.freeze({
        mode: settings.weatherMode,
        meadow: meadowWeather.getStats(),
        wind: windWeather.getStats(),
        rain: rainWeather.getStats(),
        snow: snowWeather.getStats(),
        sandstorm: sandstormWeather.getStats(),
        storm: stormWeather.getStats(),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeWarmupProbe();
      for (const system of systems) system.dispose();
    },
  };
}

export {
  DEFAULT_SETTINGS as DEFAULT_WEATHER_SETTINGS,
  normalizeSunDirection,
  resolveMeadowEnvironment,
  resolveMeadowSettings,
  sanitizeWeatherSettings,
};
