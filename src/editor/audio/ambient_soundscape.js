/**
 * Ambient sound from the CC0 bank (after grass-test's ambient system):
 *
 *   beds       looping wind (open and alpine), forest, wetland, jungle by
 *              day and night, surf, stream, lake and night crickets, each
 *              faded toward the weight the surroundings give it (rain and
 *              storm beds live on the weather sub-bus, weather_soundscape.js);
 *   calls      birds, crows, frogs, gulls, single waves, jungle calls and
 *              cicadas at random intervals around the listener, as many
 *              as the surroundings support, panned left and right;
 *   falls      a roar from the nearest waterfall, fading with distance and
 *              panned by the direction it lies in.
 *
 * Everything goes through one ambient gain, so the whole soundscape follows
 * the world volume and silences with audio.
 */

import { AmbientOneShots } from './ambient_one_shots.js';
import { BedSet, fadeGain } from './ambient_beds.js';

const numbered = (folder, stem, count) => Array.from(
  { length: count },
  (_, index) => `${folder}/${stem}-${String(index + 1).padStart(2, '0')}.mp3`,
);

/** Looping beds, by soundscape weight. See public/audio/cc0/CATALOG.md. */
const BEDS = Object.freeze({
  meadow: 'ambient/meadow-wind.mp3',
  alpine: 'ambient/alpine-wind.mp3',
  forest: 'ambient/forest-01.mp3',
  wetland: 'ambient/wetland-01.mp3',
  jungleDay: 'ambient/jungle-day.mp3',
  jungleNight: 'ambient/jungle-night.mp3',
  surf: 'ambient/sea-surf.mp3',
  stream: 'ambient/stream.mp3',
  lake: 'ambient/lake-01.mp3',
  nightCrickets: 'ambient/night-crickets.mp3',
});

const BED_VOLUME = Object.freeze({
  meadow: 0.3,
  alpine: 0.4,
  forest: 0.35,
  wetland: 0.35,
  jungleDay: 0.4,
  jungleNight: 0.38,
  surf: 0.5,
  stream: 0.35,
  lake: 0.35,
  nightCrickets: 0.25,
});

/**
 * Calls at random intervals around the listener. `bearing: 'sea'` pans a call
 * toward the sea rather than anywhere.
 */
const WILDLIFE = Object.freeze({
  birds: {
    samples: [...numbered('meadow', 'bird', 5), ...numbered('wildlife', 'bird-chirp', 4)],
    interval: [2.5, 7],
    volume: 0.22,
  },
  crows: { samples: ['meadow/crows-01.mp3', 'wildlife/crow-01.mp3', 'wildlife/crows-01.mp3'], interval: [14, 34], volume: 0.16 },
  crickets: { samples: numbered('wildlife', 'cricket', 2), interval: [3, 7], volume: 0.16 },
  frogs: { samples: [...numbered('jungle', 'frog', 3), 'wildlife/frog-01.mp3'], interval: [2, 6], volume: 0.2 },
  mosquitoes: { samples: ['wildlife/mosquito-01.mp3'], interval: [6, 14], volume: 0.14 },
  seagulls: { samples: numbered('beach', 'seagull', 6), interval: [4, 11], volume: 0.2, bearing: 'sea' },
  waves: { samples: numbered('beach', 'wave', 6), interval: [2.5, 6], volume: 0.3, bearing: 'sea' },
  jungleCalls: { samples: [...numbered('jungle', 'piha', 3), ...numbered('jungle', 'parrot', 4)], interval: [3, 9], volume: 0.22 },
  cicadas: { samples: numbered('jungle', 'cicada', 2), interval: [10, 22], volume: 0.14 },
});

const FALL_ROAR = 'ambient/lake-01.mp3';
const FALL_ROAR_RANGE = 220;

/** Stereo pan (-1 left … 1 right) of a canonical bearing for a listener's yaw. */
export function panToward(listener, bearing) {
  // Right of the listener: heading yaw faces (-sin, -cos).
  const rightX = Math.cos(listener.yaw);
  const rightZ = -Math.sin(listener.yaw);
  return bearing.x * rightX + bearing.z * rightZ;
}

export class AmbientSoundscape {
  /**
   * @param {object} options
   * @param {import('./sample_bank.js').SampleBank} options.bank
   * @param {() => AudioContext | null} options.getContext
   * @param {() => AudioNode | null} options.getDestination
   * @param {number} [options.volume]
   */
  constructor({ bank, getContext, getDestination, volume = 0.6, random = Math.random }) {
    this.bank = bank;
    this.getContext = getContext;
    this.getDestination = getDestination;
    this.volume = volume;
    this.random = random;
    this.bus = null;
    this.beds = new BedSet(bank, BEDS, BED_VOLUME);
    this.timers = new Map();
    this.wildlife = new AmbientOneShots({ bank, definitions: WILDLIFE, random });
    this.roar = null;
    this.roarPanner = null;
  }

  ensureBus() {
    if (this.bus) return this.bus;
    const context = this.getContext();
    const destination = this.getDestination();
    if (!context || !destination) return null;
    this.bus = context.createGain();
    this.bus.gain.value = this.volume;
    this.bus.connect(destination);
    return this.bus;
  }

  fade(gain, target, dt) {
    fadeGain(gain, target, dt);
  }

  updateBeds(weights, dt) {
    this.beds.update(weights, this.bus, dt);
  }

  /** @param {number | null} seaPan -1 left … 1 right, where the sea lies */
  updateWildlife(weights, dt, listener, seaPoints, enabled) {
    this.wildlife.update(weights, dt, listener, this.bus, seaPoints, enabled);
  }

  /**
   * @param {{ x: number, z: number, yaw: number }} listener canonical metres, heading
   * @param {{ x: number, z: number, drop: number } | null} fall nearest waterfall
   */
  updateFallRoar(listener, fall, dt) {
    if (!fall) {
      if (this.roar) this.fade(this.roar.gain.gain, 0, dt);
      return;
    }
    if (!this.roar) {
      if (!this.roarPanner) {
        this.roarPanner = this.getContext().createStereoPanner();
        this.roarPanner.connect(this.bus);
      }
      this.roar = this.bank.loop(FALL_ROAR, this.roarPanner);
      if (!this.roar) return;
      // Slower and deeper than the shoreline recording it is made from.
      this.roar.source.playbackRate.value = 0.55;
    }
    const dx = fall.x - listener.x;
    const dz = fall.z - listener.z;
    const distance = Math.hypot(dx, dz);
    const near = Math.max(0, 1 - distance / FALL_ROAR_RANGE);
    const loudness = Math.min(1, 0.35 + fall.drop / 25);
    this.fade(this.roar.gain.gain, near * near * loudness * 0.9, dt);
    const pan = distance > 1e-3 ? panToward(listener, { x: dx / distance, z: dz / distance }) : 0;
    this.roarPanner.pan.value = Math.max(-1, Math.min(1, pan * 0.8));
  }

  /**
   * @param {number} dt seconds
   * @param {object} state
   * @param {object} state.weights soundscapeWeights(...)
   * @param {{ x: number, z: number, yaw: number }} state.listener
   * @param {object | null} state.fall
   * @param {{ x: number, z: number } | null} [state.sea] unit bearing toward the sea
   * @param {boolean} [state.enabled] audio switched on
   */
  update(dt, { weights, listener, fall = null, seaPoints = [], enabled = true }) {
    if (!(dt > 0) || !this.ensureBus()) return;
    const step = Math.min(dt, 0.25);
    // Muting audio stops the synth; the loops fade out through the bus.
    this.fade(this.bus.gain, enabled ? this.volume : 0, step);
    this.updateBeds(weights, step);
    this.updateWildlife(weights, step, listener, seaPoints, enabled);
    this.updateFallRoar(listener, fall, step);
  }

  dispose() {
    this.wildlife.dispose();
    this.beds.dispose();
    if (this.roar) {
      try { this.roar.source.stop(); } catch { /* already stopped */ }
    }
    this.bus?.disconnect();
  }
}
