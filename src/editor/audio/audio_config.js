import { ALL_AUDIO_EVENTS } from './audio_event_id.js';
import audioEventsDefaults from './audio_events_defaults.json' with { type: 'json' };

const DEFAULT_EVENT_AUDIO = {
  'spell.air.cast': {
    enabled: true,
    volume: 0.28,
    cooldown_ms: 160,
    synth: 'smooth',
    pitch: 920,
    duration_ms: 1800,
  },
  'spell.earth.cast': {
    enabled: true,
    volume: 0.32,
    cooldown_ms: 180,
    synth: 'lower',
    pitch: 180,
    duration_ms: 1700,
  },
  'spell.lightning.cast': {
    enabled: true,
    volume: 0.36,
    cooldown_ms: 140,
    synth: 'warning',
    pitch: 1680,
    duration_ms: 1250,
  },
};

export function parseAudioConfig(source = audioEventsDefaults) {
  const parsed = typeof source === 'string'
    ? JSON.parse(source)
    : structuredClone(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid audio configuration');
  }
  if (!parsed.global || typeof parsed.global !== 'object') {
    throw new Error('Missing global audio configuration');
  }
  if (!parsed.events || typeof parsed.events !== 'object') {
    throw new Error('Missing events audio configuration');
  }
  parsed.events = { ...DEFAULT_EVENT_AUDIO, ...parsed.events };
  const requiredFields = [
    ['enabled', 'boolean'],
    ['volume', 'number'],
    ['cooldown_ms', 'number'],
    ['synth', 'string'],
    ['pitch', 'number'],
    ['duration_ms', 'number'],
  ];
  for (const eventId of ALL_AUDIO_EVENTS) {
    const entry = parsed.events[eventId];
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Missing audio config for event "${eventId}"`);
    }
    for (const [field, expectedType] of requiredFields) {
      if (typeof entry[field] !== expectedType) {
        throw new Error(
          `Event "${eventId}": field "${field}" should be ${expectedType}, got ${typeof entry[field]}`,
        );
      }
    }
  }
  return parsed;
}

export const defaultAudioConfig = parseAudioConfig();
