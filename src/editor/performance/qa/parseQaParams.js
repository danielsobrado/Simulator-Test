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
      duration: 6,
      speed: 'run',
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

  return Object.freeze({
    enabled: true,
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    spawn: Object.freeze({
      x: readNumber(params, 'x', defaults.spawn?.x ?? 0),
      z: readNumber(params, 'z', defaults.spawn?.z ?? 0),
    }),
    yawDegrees: readNumber(params, 'yaw', defaults.yawDegrees ?? 0),
    pitchDegrees: readNumber(params, 'pitch', defaults.pitchDegrees ?? 0),
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
