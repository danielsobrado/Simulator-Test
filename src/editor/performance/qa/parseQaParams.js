const SCENARIOS = Object.freeze({
  move: {
    id: 'move',
    label: 'Forward move',
    keys: ({ running }) => (running ? ['KeyW', 'ShiftLeft'] : ['KeyW']),
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
  'collision-p0': {
    id: 'collision-p0',
    label: 'Collision P0 fixture baseline',
    keys: () => [],
    defaults: { duration: 1, speed: 'walk', warmup: 2 },
  },
});

function readNumber(params, key, fallback) {
  if (!params.has(key)) {
    return fallback;
  }
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function readBoolean(params, key, fallback) {
  if (!params.has(key)) {
    return fallback;
  }
  const raw = params.get(key);
  if (raw === '' || raw === '1' || raw === 'true') {
    return true;
  }
  if (raw === '0' || raw === 'false') {
    return false;
  }
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
  if (qaRaw === null) {
    return null;
  }

  const scenarioId = qaRaw === '' || qaRaw === '1' || qaRaw === 'true'
    ? 'move'
    : qaRaw;
  const scenario = SCENARIOS[scenarioId] ?? SCENARIOS.move;
  const defaults = scenario.defaults ?? {};
  const speed = params.get('speed') === 'walk' ? 'walk' : (defaults.speed ?? 'run');
  const running = speed === 'run';

  return Object.freeze({
    enabled: true,
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    spawn: Object.freeze({
      x: readNumber(params, 'x', 0),
      z: readNumber(params, 'z', 0),
    }),
    yawDegrees: readNumber(params, 'yaw', 0),
    pitchDegrees: readNumber(params, 'pitch', 0),
    warmupSeconds: Math.max(0, readNumber(params, 'warmup', defaults.warmup ?? 2)),
    durationSeconds: Math.max(0.5, readNumber(params, 'duration', defaults.duration ?? 12)),
    speed,
    running,
    hitchMs: Math.max(1, readNumber(params, 'hitchMs', 1000 / 30)),
    autostart: readBoolean(params, 'autostart', true),
    download: readBoolean(params, 'download', true),
    keys: Object.freeze(scenario.keys({ running })),
    buildingCount: scenario.id === 'object-town'
      ? Math.max(1, Math.min(256, Math.floor(readNumber(params, 'buildings', 64))))
      : null,
  });
}

export function createMovementPlan(config) {
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
