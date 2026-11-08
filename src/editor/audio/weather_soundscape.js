/**
 * The weather sub-bus (storm plan §6): rain, storm wind and blizzard beds,
 * gust swells and thunder, through one gain and lowpass so shelter muffles
 * the weather and nothing else.
 *
 *   beds → bus gain → lowpass → ambient gain
 *
 * Nothing is built, loaded or played until the weather asks for it, so a clear
 * sky costs two idle nodes.
 */

import { BedSet, fadeGain } from './ambient_beds.js';
import { panToward } from './ambient_soundscape.js';
import { ShuffleBag } from './audio_variations.js';
import {
  GustTrigger, groundRainShare, OPEN_CUTOFF_HZ, shelterMuffle, stormBedWeights, thunderVoice,
} from './weather_audio_mix.js';
import { SPELL_SOUNDS } from '../vfx/audio/spellSoundBank.js';

const numbered = (stem, count) => Array.from(
  { length: count },
  (_, index) => `storm/${stem}-${String(index + 1).padStart(2, '0')}.mp3`,
);

/** See public/audio/cc0/CATALOG.md. */
const BEDS = Object.freeze({
  rainLight: 'ambient/rain-light-01.mp3',
  rainMedium: 'ambient/rain-medium-01.mp3',
  rainHeavy: 'ambient/rain-heavy-01.mp3',
  rainStorm: 'storm/rain-storm.mp3',
  rainRoof: 'storm/rain-roof.mp3',
  windStrong: 'storm/wind-strong.mp3',
  blizzard: 'storm/blizzard-howl.mp3',
});
const BED_VOLUME = Object.freeze({
  rainLight: 0.4, rainMedium: 0.45, rainHeavy: 0.5, rainStorm: 0.55, rainRoof: 0.5, windStrong: 0.45, blizzard: 0.5,
});
const THUNDER_NEAR = numbered('thunder-near', 4);
const THUNDER_FAR = numbered('thunder-far', 5);
const GUSTS = numbered('gust', 5);
const THUNDER_VOLUME = 0.9;
const MAX_THUNDER_VOICES = 3;
/** Longest thunder sample plus slack, before its nodes are released. */
const THUNDER_TAIL_SECONDS = 11;
const GUST_VOLUME = 0.5;
/** Stepping through a door is a sweep, not a cut. */
const SHELTER_EASE_SECONDS = 0.4;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class WeatherSoundscape {
  /**
   * @param {object} options
   * @param {import('./sample_bank.js').SampleBank} options.bank
   * @param {() => AudioContext | null} options.getContext
   * @param {() => AudioNode | null} options.getDestination the ambient gain
   */
  constructor({ bank, getContext, getDestination, random = Math.random }) {
    Object.assign(this, { bank, getContext, getDestination, random });
    this.bus = null;
    this.filter = null;
    this.beds = new BedSet(bank, BEDS, BED_VOLUME);
    this.roofed = 0;
    this.gusts = new GustTrigger();
    this.bags = { near: new ShuffleBag(THUNDER_NEAR, random), far: new ShuffleBag(THUNDER_FAR, random), gust: new ShuffleBag(GUSTS, random) };
    this.thunderVoices = 0;
    this.thunderLoading = false;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.enabled = true;
    this.mixWeights = {};
  }

  ensureBus() {
    if (this.bus) return this.bus;
    const context = this.getContext();
    const destination = this.getDestination();
    if (!context || !destination) return null;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = OPEN_CUTOFF_HZ;
    this.filter.connect(destination);
    this.bus = context.createGain();
    this.bus.connect(this.filter);
    return this.bus;
  }

  /**
   * @param {number} dt seconds
   * @param {object} state
   * @param {object} state.weights soundscapeWeights(...): the rain beds and `canopy`
   * @param {{ rain: number, snow: number, wind: number, lightning: number }} state.storm
   * @param {number} [state.roofed] 0..1 share of the listener under a roof
   * @param {number} [state.gust] 0..1 world wind gust at the listener
   * @param {{ x: number, z: number, yaw: number }} state.listener
   * @param {boolean} [state.enabled]
   * @param {boolean} [state.underwater] silences the storm beds too
   */
  update(dt, { weights, storm, roofed = 0, gust = 0, listener, enabled = true, underwater = false }) {
    if (!(dt > 0) || !this.ensureBus()) return;
    this.listener = listener;
    this.enabled = enabled;
    this.roofed += (roofed - this.roofed) * (1 - Math.exp(-dt * 3 / SHELTER_EASE_SECONDS));
    const muffle = shelterMuffle(this.roofed, weights.canopy ?? 0);
    if (Math.abs(this.filter.frequency.value - muffle.cutoff) > 1) this.filter.frequency.value = muffle.cutoff;
    fadeGain(this.bus.gain, muffle.gain, dt, SHELTER_EASE_SECONDS);

    const ground = groundRainShare(this.roofed);
    const mix = this.mixWeights;
    Object.assign(mix, underwater ? { rainStorm: 0, rainRoof: 0, windStrong: 0, blizzard: 0 } : stormBedWeights(storm, this.roofed));
    mix.rainLight = (weights.rainLight ?? 0) * ground;
    mix.rainMedium = (weights.rainMedium ?? 0) * ground;
    mix.rainHeavy = (weights.rainHeavy ?? 0) * ground;
    this.beds.update(mix, this.bus, dt);

    if (storm.lightning > 0 && !this.thunderLoading) {
      // Streamed on the first storm, never at startup.
      this.thunderLoading = true;
      for (const path of [...THUNDER_NEAR, ...THUNDER_FAR]) this.bank.load(path);
    }
    if (enabled && !underwater && storm.wind > 0.35 && this.gusts.update(gust, dt)) this.playGust(gust, storm.wind);
  }

  playGust(gust, wind) {
    const volume = GUST_VOLUME * gust * clamp((wind - 0.35) / 0.55, 0, 1) * (1 - 0.6 * this.roofed);
    this.bank.playVoice(this.bags.gust.next(), {
      destination: this.bus, volume, rate: 0.9 + this.random() * 0.2, pan: (this.random() * 2 - 1) * 0.6,
    });
  }

  /**
   * Thunder for a lightning strike (LightningScheduler event), delayed by its
   * distance, panned from its bearing and darkened with distance. Until the
   * samples arrive, the procedural spell thunder stands in.
   *
   * @param {{ bearing: number, distance: number }} strike bearing radians (x = cos, z = sin)
   */
  strike({ bearing, distance }) {
    const context = this.getContext();
    if (!context || !this.bus || !this.enabled || this.thunderVoices >= MAX_THUNDER_VOICES) return;
    const voice = thunderVoice(distance);
    const when = context.currentTime + voice.delay;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voice.cutoff;
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(panToward(this.listener, { x: Math.cos(bearing), z: Math.sin(bearing) }) * 0.8, -1, 1);
    const gain = context.createGain();
    gain.gain.value = voice.gain * THUNDER_VOLUME;
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.bus);
    const buffer = this.bank.get((voice.near ? this.bags.near : this.bags.far).next());
    if (buffer) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 0.92 + this.random() * 0.16;
      source.connect(filter);
      source.start(when);
    } else {
      SPELL_SOUNDS.thunder(context, filter, when);
    }
    this.thunderVoices += 1;
    const release = setTimeout(() => {
      gain.disconnect();
      this.thunderVoices -= 1;
    }, (voice.delay + THUNDER_TAIL_SECONDS) * 1000);
    release.unref?.(); // Node (tests): a pending release must not hold the process.
  }

  dispose() {
    this.beds.dispose();
    this.bus?.disconnect();
    this.filter?.disconnect();
  }
}
