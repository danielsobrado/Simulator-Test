import * as THREE from 'three';
import { MEADOW_MODE_VISUAL_AMOUNT, MeadowWeatherSystem } from './meadow.js';
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

/**
 * Walk-mode weather overlay. Does not own sky lighting — StylizedSkyView remains
 * the sole lighting authority; these systems only add precipitation/wind VFX.
 */
export function createWeatherController(deps) {
  const getSettings = () => ({ ...DEFAULT_SETTINGS, ...(deps.getSettings?.() ?? {}) });
  let sunbeamMotes = readSunbeamMoteRuntimeSettings(getSettings().weatherMode === 'meadow');
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

  const currentMeadowSettings = () => {
    const settings = getSettings();
    return resolveMeadowSettings(settings, sunbeamMotes);
  };
  const currentWindSettings = () => {
    const settings = getSettings();
    return {
      enabled: settings.weatherMode === 'wind',
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
    };
  };
  const currentRainSettings = () => {
    const settings = getSettings();
    return {
      enabled: settings.weatherMode === 'rain',
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
    };
  };
  const currentSnowSettings = () => {
    const settings = getSettings();
    return {
      enabled: settings.weatherMode === 'snow',
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
    };
  };
  const currentSandstormSettings = () => {
    const settings = getSettings();
    return {
      enabled: settings.weatherMode === 'sandstorm',
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
    };
  };
  const currentStormSettings = () => {
    const settings = getSettings();
    return {
      enabled: settings.weatherMode === 'storm',
      intensity: settings.weatherIntensity,
    };
  };

  const applySettings = () => {
    meadowWeather.applySettings(currentMeadowSettings());
    windWeather.applySettings(currentWindSettings());
    rainWeather.applySettings(currentRainSettings());
    snowWeather.applySettings(currentSnowSettings());
    sandstormWeather.applySettings(currentSandstormSettings());
    stormWeather.applySettings(currentStormSettings());
  };
  applySettings();

  return {
    applySettings,
    setSunbeamMoteSettings(next) {
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
    },
    update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter) {
      if (deps.getCamera) {
        sandstormWeather.camera = deps.getCamera();
      }
      const visual = resolveSunbeamMoteVisualState(readActiveBiomeVisualState());
      const sunDirection = normalizeSunDirection(deps.getSunDirection?.());
      meadowWeather.update(deltaSeconds, elapsedSeconds, effectCenter, {
        cameraPosition,
        sunDirection,
        amount: getSettings().weatherMode === 'meadow'
          ? Math.max(MEADOW_MODE_VISUAL_AMOUNT, visual.amount)
          : visual.amount,
        coldBlend: visual.coldBlend,
        localMist: visual.localMist,
      });
      windWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      rainWeather.update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter);
      snowWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      sandstormWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      stormWeather.update(deltaSeconds, elapsedSeconds, effectCenter);
    },
    dispose() {
      meadowWeather.dispose();
      windWeather.dispose();
      rainWeather.dispose();
      snowWeather.dispose();
      sandstormWeather.dispose();
      stormWeather.dispose();
    },
  };
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

function normalizeSunDirection(value) {
  const fallback = new THREE.Vector3(0.35, 0.85, 0.25);
  if (!value) return fallback;
  if (value.isVector3) return value.clone().normalize();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(value[0], value[1], value[2]).normalize();
  }
  if (Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z).normalize();
  }
  return fallback;
}

export {
  DEFAULT_SETTINGS as DEFAULT_WEATHER_SETTINGS,
  resolveMeadowSettings,
};
