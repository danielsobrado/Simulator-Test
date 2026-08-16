function invalidCalendarConfig(field) {
  return Object.assign(new Error(`invalid_calendar_config:${field}`), {
    code: 'invalid_calendar_config',
    field,
  });
}

function invalidSchedulerValue(field) {
  return Object.assign(new Error(`invalid_scheduler_value:${field}`), {
    code: 'invalid_scheduler_value',
    field,
  });
}

function assertPositiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidCalendarConfig(field);
}

function assertNonNegativeSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidCalendarConfig(field);
}

function assertDerivedTickCount(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidCalendarConfig(field);
}

function assertTick(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw Object.assign(new Error(code), { code });
  }
}

function assertSchedulerTick(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidSchedulerValue(field);
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw invalidSchedulerValue(field);
}

export function createCalendarConfig(partial = {}) {
  const config = {
    ticksPerHour: partial.ticksPerHour ?? 60,
    hoursPerDay: partial.hoursPerDay ?? 24,
    daysPerWeek: partial.daysPerWeek ?? 7,
    daysPerMonth: partial.daysPerMonth ?? 30,
    monthsPerYear: partial.monthsPerYear ?? 12,
    initialYear: partial.initialYear ?? 1,
    initialMonth: partial.initialMonth ?? 1,
    initialDay: partial.initialDay ?? 1,
    initialHour: partial.initialHour ?? 8,
  };

  for (const field of [
    'ticksPerHour',
    'hoursPerDay',
    'daysPerWeek',
    'daysPerMonth',
    'monthsPerYear',
    'initialYear',
    'initialMonth',
    'initialDay',
  ]) {
    assertPositiveSafeInteger(config[field], field);
  }
  assertNonNegativeSafeInteger(config.initialHour, 'initialHour');

  if (config.initialMonth > config.monthsPerYear) throw invalidCalendarConfig('initialMonth');
  if (config.initialDay > config.daysPerMonth) throw invalidCalendarConfig('initialDay');
  if (config.initialHour >= config.hoursPerDay) throw invalidCalendarConfig('initialHour');

  const dayTicks = config.ticksPerHour * config.hoursPerDay;
  const weekTicks = dayTicks * config.daysPerWeek;
  const monthTicks = dayTicks * config.daysPerMonth;
  const yearTicks = monthTicks * config.monthsPerYear;
  assertDerivedTickCount(dayTicks, 'ticksPerDay');
  assertDerivedTickCount(weekTicks, 'ticksPerWeek');
  assertDerivedTickCount(monthTicks, 'ticksPerMonth');
  assertDerivedTickCount(yearTicks, 'ticksPerYear');

  return config;
}

export function ticksPerDay(config) {
  return config.ticksPerHour * config.hoursPerDay;
}

export function ticksPerWeek(config) {
  return ticksPerDay(config) * config.daysPerWeek;
}

export function ticksPerMonth(config) {
  return ticksPerDay(config) * config.daysPerMonth;
}

export function ticksPerYear(config) {
  return ticksPerMonth(config) * config.monthsPerYear;
}

export function calendarFromTick(tick, config) {
  assertTick(tick, 'invalid_tick');
  const tph = config.ticksPerHour;
  const hpd = config.hoursPerDay;
  const dpm = config.daysPerMonth;
  const mpy = config.monthsPerYear;
  const ticksPerDayValue = tph * hpd;
  const ticksPerMonthValue = ticksPerDayValue * dpm;
  const ticksPerYearValue = ticksPerMonthValue * mpy;
  const initialTickOffset = (
    ((config.initialMonth - 1) * ticksPerMonthValue)
    + ((config.initialDay - 1) * ticksPerDayValue)
    + (config.initialHour * tph)
  );

  const absoluteTick = initialTickOffset + tick;
  if (!Number.isSafeInteger(absoluteTick)) {
    throw Object.assign(new Error('tick_overflow'), { code: 'tick_overflow' });
  }

  let remaining = absoluteTick;
  const yearOffset = Math.floor(remaining / ticksPerYearValue);
  remaining -= yearOffset * ticksPerYearValue;
  const monthOffset = Math.floor(remaining / ticksPerMonthValue);
  remaining -= monthOffset * ticksPerMonthValue;
  const dayOffset = Math.floor(remaining / ticksPerDayValue);
  remaining -= dayOffset * ticksPerDayValue;
  const hour = Math.floor(remaining / tph);
  const minute = remaining % tph;
  const year = config.initialYear + yearOffset;
  if (!Number.isSafeInteger(year)) {
    throw Object.assign(new Error('tick_overflow'), { code: 'tick_overflow' });
  }

  return {
    tick,
    year,
    month: monthOffset + 1,
    day: dayOffset + 1,
    hour,
    minute,
  };
}

export function createWorldClock(calendarConfig, initialTick = 0) {
  const config = createCalendarConfig(calendarConfig);
  assertTick(initialTick, 'invalid_tick');
  let tick = initialTick;
  let paused = false;
  let speed = 1;

  return {
    getTick: () => tick,
    isPaused: () => paused,
    getSpeed: () => speed,
    getCalendar: () => calendarFromTick(tick, config),
    getConfig: () => ({ ...config }),
    pause() { paused = true; },
    resume() { paused = false; },
    setSpeed(next) {
      if (!Number.isFinite(next) || next < 0) throw new Error('invalid_speed');
      speed = next;
    },
    setTick(next) {
      assertTick(next, 'invalid_tick');
      tick = next;
    },
    advance(ticks = 1) {
      if (paused) return tick;
      assertTick(ticks, 'invalid_advance');
      const next = tick + ticks;
      if (!Number.isSafeInteger(next)) {
        throw Object.assign(new Error('tick_overflow'), { code: 'tick_overflow' });
      }
      tick = next;
      return tick;
    },
  };
}

export const CADENCES = Object.freeze({
  tick: 'tick',
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
});

export function createScheduler(clock) {
  const jobs = new Map();
  const systems = new Map();
  let jobSeq = 0;

  function validateJob(job, { requireCreatedAtTick = false } = {}) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw invalidSchedulerValue('job');
    }
    assertNonEmptyString(job.id, 'job.id');
    assertNonEmptyString(job.type, 'job.type');
    assertSchedulerTick(job.dueTick, 'job.dueTick');
    if (!Number.isFinite(job.priority)) throw invalidSchedulerValue('job.priority');
    if (requireCreatedAtTick) assertSchedulerTick(job.createdAtTick, 'job.createdAtTick');
    if (job.cancelledAtTick != null) assertSchedulerTick(job.cancelledAtTick, 'job.cancelledAtTick');
    if (!Number.isSafeInteger(job.schemaVersion) || job.schemaVersion < 1) {
      throw invalidSchedulerValue('job.schemaVersion');
    }
  }

  function sortJobs(list) {
    return [...list].sort((a, b) => (
      a.dueTick - b.dueTick
      || a.priority - b.priority
      || a.type.localeCompare(b.type)
      || String(a.ownerEntityId).localeCompare(String(b.ownerEntityId))
      || a.id.localeCompare(b.id)
    ));
  }

  return {
    registerSystem(system) {
      if (!system || typeof system !== 'object' || Array.isArray(system)) {
        throw invalidSchedulerValue('system');
      }
      assertNonEmptyString(system.id, 'system.id');
      assertNonEmptyString(system.cadence, 'system.cadence');
      if (systems.has(system.id)) throw new Error(`duplicate_system:${system.id}`);
      systems.set(system.id, structuredClone(system));
    },
    scheduleJob(job) {
      const id = job?.id ?? `job:${jobSeq}`;
      const record = {
        id,
        type: job?.type,
        dueTick: job?.dueTick,
        priority: job?.priority ?? 100,
        ownerEntityId: job?.ownerEntityId ?? null,
        payload: structuredClone(job?.payload ?? {}),
        recurrence: structuredClone(job?.recurrence ?? null),
        createdAtTick: clock.getTick(),
        cancelledAtTick: null,
        schemaVersion: job?.schemaVersion ?? 1,
      };
      validateJob(record, { requireCreatedAtTick: true });
      if (jobs.has(id)) throw Object.assign(new Error(`duplicate_job:${id}`), { code: 'duplicate_job' });
      jobSeq += 1;
      jobs.set(id, record);
      return structuredClone(record);
    },
    cancelJob(id, tick = clock.getTick()) {
      assertSchedulerTick(tick, 'cancelledAtTick');
      const job = jobs.get(id);
      if (!job) return false;
      job.cancelledAtTick = tick;
      return true;
    },
    listDueJobs(atTick = clock.getTick()) {
      assertSchedulerTick(atTick, 'atTick');
      return sortJobs([...jobs.values()].filter(
        (job) => job.cancelledAtTick == null && job.dueTick <= atTick,
      )).map((job) => structuredClone(job));
    },
    listSystems() {
      return [...systems.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((system) => structuredClone(system));
    },
    systemsForCadence(cadence) {
      return this.listSystems().filter((system) => system.cadence === cadence);
    },
    serialize() {
      return {
        jobSeq,
        jobs: sortJobs([...jobs.values()]).map((job) => structuredClone(job)),
        systemIds: this.listSystems().map((system) => system.id),
      };
    },
    restore(snapshot) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw invalidSchedulerValue('snapshot');
      }
      const nextJobSeq = snapshot.jobSeq ?? 0;
      if (!Number.isSafeInteger(nextJobSeq) || nextJobSeq < 0) {
        throw invalidSchedulerValue('jobSeq');
      }
      if (!Array.isArray(snapshot.jobs ?? [])) throw invalidSchedulerValue('jobs');
      const restoredJobs = new Map();
      for (const job of snapshot.jobs ?? []) {
        validateJob(job, { requireCreatedAtTick: true });
        if (restoredJobs.has(job.id)) throw invalidSchedulerValue('duplicateJobId');
        restoredJobs.set(job.id, structuredClone(job));
      }
      jobs.clear();
      for (const [id, job] of restoredJobs) jobs.set(id, job);
      jobSeq = nextJobSeq;
    },
  };
}

export function createFixedStepRunner({
  clock,
  scheduler,
  calendarConfig,
  onCadence = null,
}) {
  const config = createCalendarConfig(calendarConfig);
  const dayTicks = ticksPerDay(config);
  const hourTicks = config.ticksPerHour;
  const weekTicks = ticksPerWeek(config);
  const monthTicks = ticksPerMonth(config);
  const yearTicks = ticksPerYear(config);

  function emitCadence(fromTick, toTick) {
    const fired = [];
    for (let tick = fromTick + 1; tick <= toTick; tick += 1) {
      fired.push({ cadence: CADENCES.tick, tick });
      if (tick % hourTicks === 0) fired.push({ cadence: CADENCES.hour, tick });
      if (tick % dayTicks === 0) fired.push({ cadence: CADENCES.day, tick });
      if (tick % weekTicks === 0) fired.push({ cadence: CADENCES.week, tick });
      if (tick % monthTicks === 0) fired.push({ cadence: CADENCES.month, tick });
      if (tick % yearTicks === 0) fired.push({ cadence: CADENCES.year, tick });
    }
    return fired;
  }

  return {
    stepTicks(count, context) {
      if (clock.isPaused()) return { advanced: 0, cadenceEvents: [], dueJobs: [] };
      const from = clock.getTick();
      clock.advance(count);
      const to = clock.getTick();
      const cadenceEvents = emitCadence(from, to);
      if (onCadence) {
        try {
          for (const event of cadenceEvents) {
            clock.setTick(event.tick);
            onCadence(event, context);
          }
        } finally {
          clock.setTick(to);
        }
      }
      const dueJobs = scheduler.listDueJobs(to);
      return { advanced: to - from, cadenceEvents, dueJobs, tick: to };
    },
    stepOneTick(context) {
      return this.stepTicks(1, context);
    },
    stepOneHour(context) {
      return this.stepTicks(hourTicks, context);
    },
    stepOneDay(context) {
      return this.stepTicks(dayTicks, context);
    },
    runUntilTick(targetTick, context) {
      const from = clock.getTick();
      if (targetTick < from) throw new Error('invalid_run_until');
      return this.stepTicks(targetTick - from, context);
    },
  };
}
