import { resolvePerfQaDensityProfile } from './PerfQaDensityProfiles.js';
import {
  POST_PROCESSING_MEASURE_FRAMES,
  POST_PROCESSING_WARMUP_FRAMES,
  createPostProcessingRoutePhases,
  resolvePostProcessingCapture,
} from './PostProcessingQaCaptures.js';

const SCENARIOS = Object.freeze({
  move: {
    id: 'move',
    label: 'Forward move',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
  },
  'post-processing-capture': {
    id: 'post-processing-capture',
    label: 'Post-processing capture',
    keys: () => [],
    defaults: {
      warmupFrames: POST_PROCESSING_WARMUP_FRAMES,
      measureFrames: POST_PROCESSING_MEASURE_FRAMES,
      speed: 'walk',
    },
  },
  'post-processing-route': {
    id: 'post-processing-route',
    label: 'Post-processing movement route',
    keys: () => [],
    defaults: {
      warmupFrames: POST_PROCESSING_WARMUP_FRAMES,
      measureFrames: POST_PROCESSING_MEASURE_FRAMES,
      speed: 'run',
      multiPhase: true,
    },
  },
  strafe: {
    id: 'strafe',
    label: 'Strafe right',
    keys: ({ running }) => (running ? ['KeyD', 'ShiftLeft'] : ['KeyD']),
  },
  diagonal: {
    id: 'diagonal',
    label: 'Diagonal run',
    keys: ({ running }) => (running ? ['KeyW', 'KeyD', 'ShiftLeft'] : ['KeyW', 'KeyD']),
  },
  'chunk-cross': {
    id: 'chunk-cross',
    label: 'Cross chunk boundaries',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: { duration: 20, speed: 'run' },
  },
  'object-town': {
    id: 'object-town',
    label: 'Masonry town threshold sweep',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: { duration: 14, speed: 'run', warmup: 8 },
  },
  'construction-ring': {
    id: 'construction-ring',
    label: 'Dense construction wall corridor',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 14,
      speed: 'run',
      warmup: 10,
      spawn: { x: 0, z: -24 },
      yawDegrees: 0,
    },
  },
  'water-acceptance': {
    id: 'water-acceptance',
    label: 'Dry-to-deep water acceptance',
    // The external water runner drives enter/dive/surface/exit explicitly.
    keys: () => [],
    defaults: { duration: 24, speed: 'walk', warmup: 4 },
  },
  'collision-p0': {
    id: 'collision-p0',
    label: 'Collision P0 fixture baseline',
    keys: () => [],
    defaults: { duration: 1, speed: 'walk', warmup: 2 },
  },
  'collision-p1': {
    id: 'collision-p1',
    label: 'Collision P1 broadphase residency',
    keys: () => [],
    defaults: { duration: 3, speed: 'walk', warmup: 3 },
  },
  'collision-p2': {
    id: 'collision-p2',
    label: 'Collision P2 wall-stop motor',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 3,
      speed: 'run',
      warmup: 3,
      spawn: { x: 8, z: -14 },
      yawDegrees: 0,
    },
  },
  'collision-p3': {
    id: 'collision-p3',
    label: 'Collision P3 production tree trunk',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 3,
      speed: 'run',
      warmup: 5,
      spawn: { x: 0, z: 0 },
      yawDegrees: 0,
    },
  },
  'collision-p4': {
    id: 'collision-p4',
    label: 'Collision P4 production rock primitive',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 4,
      speed: 'run',
      warmup: 8,
      spawn: { x: 0, z: 0 },
      yawDegrees: 0,
    },
  },
  'collision-p5': {
    id: 'collision-p5',
    label: 'Collision P5 walkable rock BVH',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 6,
      speed: 'run',
      warmup: 10,
      spawn: { x: 0, z: 0 },
      yawDegrees: 0,
    },
  },
  'collision-p6': {
    id: 'collision-p6',
    label: 'Collision P6 placed object doorway',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 0.5,
      speed: 'walk',
      warmup: 8,
      spawn: { x: 0, z: 0 },
      yawDegrees: 0,
    },
  },
  'collision-p7': {
    id: 'collision-p7',
    label: 'Collision P7 construction wall',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 1.2,
      speed: 'run',
      warmup: 8,
      spawn: { x: 0, z: 0 },
      yawDegrees: 0,
    },
  },
  'collision-p8': {
    id: 'collision-p8',
    label: 'Collision P8 streaming and performance gate',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
    defaults: {
      duration: 12,
      speed: 'run',
      warmup: 10,
      spawn: { x: 0, z: 0 },
      yawDegrees: 0,
    },
  },
});

function readNumber(params, key, fallback) {
  if (!params.has(key)) return fallback;
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function readBoolean(params, key, fallback) {
  if (!params.has(key)) return fallback;
  const raw = params.get(key);
  if (raw === '' || raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return fallback;
}

export function listQaScenarios() {
  return Object.values(SCENARIOS).map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
  }));
}

export function parseQaParams(search = '') {
  const params = new URLSearchParams(
    typeof search === 'string' && search.startsWith('?') ? search.slice(1) : search,
  );
  const qaRaw = params.get('qa');
  if (qaRaw === null) return null;

  const scenarioId = qaRaw === '' || qaRaw === '1' || qaRaw === 'true'
    ? 'move'
    : qaRaw;
  const scenario = SCENARIOS[scenarioId] ?? SCENARIOS.move;
  const defaults = scenario.defaults ?? {};
  const speed = params.get('speed') === 'walk' ? 'walk' : (defaults.speed ?? 'run');
  const running = speed === 'run';
  const captureId = params.get('ppCapture') || params.get('capture') || null;
  const capture = captureId ? resolvePostProcessingCapture(captureId) : null;
  const warmupFramesRaw = params.has('warmupFrames')
    ? readNumber(params, 'warmupFrames', defaults.warmupFrames ?? null)
    : (defaults.warmupFrames ?? null);
  const measureFramesRaw = params.has('measureFrames')
    ? readNumber(params, 'measureFrames', defaults.measureFrames ?? null)
    : (defaults.measureFrames ?? null);
  const useFrameBudget = Number.isFinite(warmupFramesRaw) && Number.isFinite(measureFramesRaw);
  const densityDefault = capture?.density ?? 'standard';

  const keys = capture?.keys
    ? Object.freeze([...capture.keys])
    : Object.freeze(scenario.keys({ running }));

  return Object.freeze({
    enabled: true,
    scenarioId: scenario.id,
    scenarioLabel: capture?.label ?? scenario.label,
    spawn: Object.freeze({
      x: readNumber(params, 'x', capture?.spawn?.x ?? defaults.spawn?.x ?? 0),
      z: readNumber(params, 'z', capture?.spawn?.z ?? defaults.spawn?.z ?? 0),
    }),
    yawDegrees: readNumber(
      params,
      'yaw',
      capture?.yawDegrees ?? defaults.yawDegrees ?? 0,
    ),
    pitchDegrees: readNumber(
      params,
      'pitch',
      capture?.pitchDegrees ?? defaults.pitchDegrees ?? 0,
    ),
    warmupSeconds: Math.max(0, readNumber(params, 'warmup', defaults.warmup ?? 2)),
    durationSeconds: Math.max(0.5, readNumber(params, 'duration', defaults.duration ?? 12)),
    warmupFrames: useFrameBudget ? Math.max(0, Math.floor(warmupFramesRaw)) : null,
    measureFrames: useFrameBudget ? Math.max(1, Math.floor(measureFramesRaw)) : null,
    useFrameBudget,
    multiPhase: Boolean(defaults.multiPhase),
    captureId: capture?.id ?? captureId,
    captureFixture: capture?.fixture ?? null,
    captureWeather: capture?.weather ?? params.get('weather') ?? null,
    captureNight: Boolean(capture?.night) || readBoolean(params, 'night', false),
    captureSpell: Boolean(capture?.spell) || readBoolean(params, 'spell', false),
    speed,
    running,
    hitchMs: Math.max(1, readNumber(params, 'hitchMs', 1000 / 30)),
    autostart: readBoolean(params, 'autostart', true),
    download: readBoolean(params, 'download', true),
    keys,
    buildingCount: scenario.id === 'object-town'
      ? Math.max(1, Math.min(256, Math.floor(readNumber(params, 'buildings', 64))))
      : null,
    densityProfile: resolvePerfQaDensityProfile(
      params.get('density') ?? densityDefault,
    ).id,
    floatingOriginThreshold: readNumber(params, 'originThreshold', 4096),
  });
}

export function createMovementPlan(config) {
  if (config.multiPhase && config.scenarioId === 'post-processing-route') {
    return Object.freeze({
      ...config,
      phases: createPostProcessingRoutePhases({
        floatingOriginThreshold: config.floatingOriginThreshold ?? 4096,
        warmupFrames: config.warmupFrames ?? POST_PROCESSING_WARMUP_FRAMES,
        measureFrames: config.measureFrames ?? POST_PROCESSING_MEASURE_FRAMES,
      }),
    });
  }

  if (config.useFrameBudget) {
    return Object.freeze({
      ...config,
      phases: Object.freeze([
        Object.freeze({
          id: 'warmup',
          label: 'Warmup (settle streaming)',
          durationFrames: config.warmupFrames,
          keys: Object.freeze([]),
          record: false,
        }),
        Object.freeze({
          id: 'measure',
          label: config.scenarioLabel,
          durationFrames: config.measureFrames,
          keys: config.keys,
          record: true,
        }),
      ]),
    });
  }

  return Object.freeze({
    ...config,
    phases: Object.freeze([
      Object.freeze({
        id: 'warmup',
        label: 'Warmup (settle streaming)',
        durationSeconds: config.warmupSeconds,
        keys: Object.freeze([]),
        record: false,
      }),
      Object.freeze({
        id: 'measure',
        label: config.scenarioLabel,
        durationSeconds: config.durationSeconds,
        keys: config.keys,
        record: true,
      }),
    ]),
  });
}
