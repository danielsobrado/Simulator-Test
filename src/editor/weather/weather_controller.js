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
import { StormState, stormTargetForSettings } from './storm/StormState.js';

const DEFAULT_SETTINGS = Object.freeze({
  weatherMode: 'off',
  weatherIntensity: 0.7,
  weatherWindX: -0.42,
  weatherWindZ: 0.18,
});

const VALID_WEATHER_MODES = new Set([
  'off',
  'overcast',
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
    rain: deps.effects?.rain,
  });
  const snowWeather = new SnowWeatherSystem({
    scene: deps.scene,
    isWebGpu,
    seed: 0x51eaf00d,
    snowfall: deps.effects?.snowfall,
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
  // Rain, snow and lightning follow the eased storm channels, not the mode:
  // changing the weather builds or breaks over a minute or two (StormState).
  const storm = new StormState();
  const stormOverride = deps.stormOverride ?? null;
  const applied = { rain: -1, snow: -1, lightning: -1 };
  const changed = (key, value) => {
    if (Math.abs(applied[key] - value) < 1e-3 && (value > 0) === (applied[key] > 0)) return false;
    applied[key] = value;
    return true;
  };
  const applyStormChannels = (frame) => {
    const wind = { windX: settings.weatherWindX, windZ: settings.weatherWindZ };
    if (changed('rain', frame.rain)) rainWeather.applySettings({ enabled: frame.rain > 0, intensity: frame.rain, ...wind });
    if (changed('snow', frame.snow)) snowWeather.applySettings({ enabled: frame.snow > 0, intensity: frame.snow, ...wind });
    const lightning = frame.lightning * frame.gain;
    if (changed('lightning', lightning)) stormWeather.applySettings({ enabled: lightning > 1e-3, intensity: lightning });
  };
  const currentSandstormSettings = () => ({
    enabled: settings.weatherMode === 'sandstorm',
    intensity: settings.weatherIntensity,
    windX: settings.weatherWindX,
    windZ: settings.weatherWindZ,
  });
  /** @param {{ snap?: boolean }} [options] snap: jump straight to the new weather (QA, captures). */
  const applySettings = ({ snap = false } = {}) => {
    if (disposed) return false;
    settings = sanitizeWeatherSettings({
      ...DEFAULT_SETTINGS,
      ...(deps.getSettings?.() ?? settings),
    });
    meadowWeather.applySettings(currentMeadowSettings());
    windWeather.applySettings(currentWindSettings());
    sandstormWeather.applySettings(currentSandstormSettings());
    storm.setTarget(stormOverride
      ? { ...stormTargetForSettings({ weatherMode: 'storm', weatherIntensity: stormOverride.storm }), kind: stormOverride.kind }
      : stormTargetForSettings(settings));
    if (snap || stormOverride?.snap) applyStormChannels(storm.snap());
    return true;
  };
  // The page opens on the saved weather, not on a storm building from clear.
  applySettings({ snap: true });

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
    /**
     * Light snowfall over snow country (0..1) whatever the weather, unless the
     * weather is already rain, a storm or a sandstorm.
     */
    setRegionalSnow(amount) {
      if (disposed) return;
      // shortcut: snow country alone decides rain vs snow; add the snow-line
      // height term of the storm plan §2.3 when storms reach high valleys.
      storm.setSnowShare(THREE.MathUtils.smoothstep(amount, 0.15, 0.6));
      const wet = storm.frame.rain > 0.02 || settings.weatherMode === 'sandstorm';
      snowWeather.setRegionalSnow(wet ? 0 : amount);
    },
    /** This frame's storm channels (StormState.frame); read-only. */
    get storm() {
      return storm.frame;
    },
    update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter) {
      if (disposed) return;
      if (deps.getCamera) sandstormWeather.camera = deps.getCamera();
      applyStormChannels(storm.step(deltaSeconds));
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
      snowWeather.update(deltaSeconds, elapsedSeconds, cameraPosition, deps.getOrigin?.());
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
