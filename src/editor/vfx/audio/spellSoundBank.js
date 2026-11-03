import { bell, crackle, noise, tone } from './synthLayers.js';

/**
 * Procedural spell sounds, one function per cue: `(ctx, out, when, opts)`.
 * `opts.size` scales weight; `opts.duration` lengthens sustained cues.
 */
export const SPELL_SOUNDS = Object.freeze({
  explosion(ctx, out, when, { size = 1 } = {}) {
    const weight = Math.min(1.6, size);
    tone(ctx, out, when, { type: 'sine', freq: 95 / weight, freqEnd: 28, gain: 0.9 * weight, attack: 0.005, decay: 1.6 * weight });
    noise(ctx, out, when, { filter: 'lowpass', freq: 3500, freqEnd: 180, gain: 0.85, attack: 0.004, decay: 1.4 * weight });
    noise(ctx, out, when, { filter: 'highpass', freq: 2500, gain: 0.35, attack: 0.001, decay: 0.12 });
    noise(ctx, out, when + 0.15, { filter: 'lowpass', freq: 400, freqEnd: 90, gain: 0.45 * weight, attack: 0.3, decay: 3.5, tremolo: 9 });
    crackle(ctx, out, when + 0.1, { duration: 2.5, density: 26, freq: 2400, gain: 0.18 });
  },
  'cast-fire'(ctx, out, when) {
    noise(ctx, out, when, { filter: 'bandpass', freq: 400, freqEnd: 1800, q: 1.2, gain: 0.5, attack: 0.05, decay: 0.5 });
    noise(ctx, out, when, { filter: 'lowpass', freq: 600, gain: 0.35, attack: 0.08, hold: 0.6, decay: 0.6, tremolo: 14 });
  },
  'cast-meteor'(ctx, out, when) {
    tone(ctx, out, when + 0.3, { type: 'sawtooth', freq: 1800, freqEnd: 260, gain: 0.08, attack: 0.3, decay: 1.6, lowpass: 2600 });
    noise(ctx, out, when + 0.2, { filter: 'bandpass', freq: 2200, freqEnd: 300, q: 2, gain: 0.35, attack: 0.6, decay: 1.4 });
  },
  'fire-wall'(ctx, out, when, { duration = 8 } = {}) {
    noise(ctx, out, when, { filter: 'bandpass', freq: 300, freqEnd: 1600, q: 1, gain: 0.6, attack: 0.05, decay: 0.6 });
    noise(ctx, out, when + 0.1, { filter: 'lowpass', freq: 700, gain: 0.45, attack: 0.4, hold: duration - 1.5, decay: 1.2, tremolo: 7 });
    crackle(ctx, out, when + 0.2, { duration: duration - 0.5, density: 28, freq: 2600, gain: 0.16 });
  },
  lightning(ctx, out, when) {
    noise(ctx, out, when, { filter: 'highpass', freq: 1500, gain: 0.9, attack: 0.001, decay: 0.18 });
    crackle(ctx, out, when, { duration: 0.35, density: 120, freq: 4500, gain: 0.35, decay: 0.015 });
    noise(ctx, out, when + 0.05, { filter: 'lowpass', freq: 900, freqEnd: 80, gain: 0.8, attack: 0.02, decay: 2.8, tremolo: 6 });
    tone(ctx, out, when, { type: 'sine', freq: 70, freqEnd: 32, gain: 0.5, attack: 0.01, decay: 1.6 });
  },
  thunder(ctx, out, when) {
    tone(ctx, out, when, { type: 'sine', freq: 120, freqEnd: 30, gain: 1, attack: 0.002, decay: 1.2 });
    noise(ctx, out, when, { filter: 'lowpass', freq: 5000, freqEnd: 150, gain: 0.9, attack: 0.002, decay: 1.1 });
    noise(ctx, out, when + 0.1, { filter: 'lowpass', freq: 500, freqEnd: 60, gain: 0.5, attack: 0.15, decay: 2.6, tremolo: 5 });
    crackle(ctx, out, when, { duration: 0.6, density: 60, freq: 5000, gain: 0.2, decay: 0.012 });
  },
  frost(ctx, out, when, { duration = 1 } = {}) {
    noise(ctx, out, when, { filter: 'highpass', freq: 3000, freqEnd: 1200, gain: 0.55, attack: 0.03, hold: duration * 0.6, decay: 0.8 });
    noise(ctx, out, when, { filter: 'bandpass', freq: 700, freqEnd: 300, q: 0.8, gain: 0.45, attack: 0.03, hold: duration * 0.5, decay: 0.7 });
    crackle(ctx, out, when + 0.05, { duration: duration + 0.6, density: 45, freq: 6000, gain: 0.12, decay: 0.02 });
    bell(ctx, out, when, { freq: 1800, gain: 0.06, decay: 1.6, spread: 0.4 });
  },
  hail(ctx, out, when, { duration = 3 } = {}) {
    noise(ctx, out, when, { filter: 'lowpass', freq: 300, gain: 0.35, attack: 0.8, hold: duration - 1.5, decay: 1, tremolo: 0.7 });
    crackle(ctx, out, when + 0.45, { duration: duration - 0.6, density: 90, freq: 2500, q: 2, gain: 0.3, decay: 0.04 });
  },
  'cast-water'(ctx, out, when) {
    tone(ctx, out, when, { type: 'sine', freq: 260, freqEnd: 620, gain: 0.22, attack: 0.04, decay: 0.45 });
    noise(ctx, out, when, { filter: 'bandpass', freq: 600, freqEnd: 1400, q: 1.5, gain: 0.22, attack: 0.08, decay: 0.5, tremolo: 9 });
  },
  splash(ctx, out, when, { size = 1 } = {}) {
    tone(ctx, out, when, { type: 'sine', freq: 180, freqEnd: 60, gain: 0.45 * size, attack: 0.004, decay: 0.35 });
    noise(ctx, out, when, { filter: 'lowpass', freq: 2600, freqEnd: 500, gain: 0.6, attack: 0.004, decay: 0.9 * size });
    crackle(ctx, out, when + 0.15, { duration: 1.2, density: 30, freq: 1800, q: 3, gain: 0.12, decay: 0.05 });
  },
  rain(ctx, out, when, { duration = 6 } = {}) {
    noise(ctx, out, when, { filter: 'bandpass', freq: 2200, q: 0.7, gain: 0.3, attack: 1, hold: duration - 2, decay: 1.2 });
    crackle(ctx, out, when + 0.6, { duration: duration - 0.8, density: 60, freq: 3000, q: 2, gain: 0.1, decay: 0.03 });
  },
  'cast-acid'(ctx, out, when) {
    tone(ctx, out, when, { type: 'sine', freq: 520, freqEnd: 140, gain: 0.35, attack: 0.01, decay: 0.25 });
    noise(ctx, out, when, { filter: 'bandpass', freq: 900, q: 2, gain: 0.2, attack: 0.02, decay: 0.3 });
  },
  acid(ctx, out, when, { duration = 4 } = {}) {
    tone(ctx, out, when, { type: 'sine', freq: 300, freqEnd: 70, gain: 0.45, attack: 0.005, decay: 0.3 });
    noise(ctx, out, when, { filter: 'highpass', freq: 3500, gain: 0.45, attack: 0.02, hold: 0.4, decay: duration, tremolo: 11 });
    crackle(ctx, out, when + 0.1, { duration, density: 18, freq: 900, q: 6, gain: 0.12, decay: 0.06 });
  },
  'cast-arcane'(ctx, out, when) {
    [0, 0.13, 0.26].forEach((offset, index) => {
      tone(ctx, out, when + offset, { type: 'triangle', freq: 880 * (1 + index * 0.26), freqEnd: 1700, gain: 0.12, attack: 0.01, decay: 0.35 });
    });
  },
  'missile-hit'(ctx, out, when) {
    tone(ctx, out, when, { type: 'square', freq: 1400, freqEnd: 120, gain: 0.12, attack: 0.002, decay: 0.22, lowpass: 3000 });
    noise(ctx, out, when, { filter: 'bandpass', freq: 2500, q: 1.5, gain: 0.35, attack: 0.002, decay: 0.2 });
  },
  'shatter-charge'(ctx, out, when) {
    tone(ctx, out, when, { type: 'sine', freq: 600, freqEnd: 2600, gain: 0.15, attack: 0.15, decay: 0.08 });
    noise(ctx, out, when, { filter: 'highpass', freq: 1500, freqEnd: 6000, gain: 0.2, attack: 0.2, decay: 0.05 });
  },
  shatter(ctx, out, when) {
    noise(ctx, out, when, { filter: 'highpass', freq: 2000, gain: 0.8, attack: 0.001, decay: 0.35 });
    tone(ctx, out, when, { type: 'sine', freq: 140, freqEnd: 40, gain: 0.55, attack: 0.003, decay: 0.7 });
    for (let index = 0; index < 9; index += 1) {
      bell(ctx, out, when + Math.random() * 0.5, { freq: 1600 + Math.random() * 3000, gain: 0.08, decay: 0.9 });
    }
    crackle(ctx, out, when + 0.05, { duration: 1.2, density: 50, freq: 7000, gain: 0.15, decay: 0.02 });
  },
  necrotic(ctx, out, when, { duration = 2 } = {}) {
    tone(ctx, out, when, { type: 'sawtooth', freq: 55, freqEnd: 82, gain: 0.18, attack: duration * 0.6, decay: 0.6, lowpass: 400 });
    tone(ctx, out, when, { type: 'sawtooth', freq: 58, freqEnd: 87, gain: 0.14, attack: duration * 0.6, decay: 0.6, lowpass: 400, detune: 18 });
    noise(ctx, out, when, { filter: 'bandpass', freq: 200, freqEnd: 1400, q: 3, gain: 0.35, attack: duration * 0.55, decay: 0.3 });
  },
  'necrotic-burst'(ctx, out, when) {
    tone(ctx, out, when, { type: 'sine', freq: 90, freqEnd: 30, gain: 0.7, attack: 0.005, decay: 1.2 });
    noise(ctx, out, when, { filter: 'lowpass', freq: 1200, freqEnd: 100, gain: 0.5, attack: 0.005, decay: 1.4, tremolo: 12 });
  },
  heal(ctx, out, when, { duration = 2 } = {}) {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, index) => {
      bell(ctx, out, when + index * 0.12, { freq, gain: 0.09, decay: 1.8, partials: [1, 2, 3.01] });
    });
    tone(ctx, out, when, { type: 'triangle', freq: 261.6, gain: 0.08, attack: 0.5, hold: duration - 1, decay: 1, lowpass: 1500 });
    tone(ctx, out, when, { type: 'triangle', freq: 392, gain: 0.06, attack: 0.6, hold: duration - 1, decay: 1, lowpass: 1500 });
  },
  whoosh(ctx, out, when, { duration = 8 } = {}) {
    noise(ctx, out, when, { filter: 'bandpass', freq: 250, freqEnd: 1200, q: 0.8, gain: 0.55, attack: 0.15, decay: 1.2 });
    noise(ctx, out, when + 0.4, { filter: 'lowpass', freq: 350, gain: 0.18, attack: 1, hold: duration - 3, decay: 2, tremolo: 0.3 });
  },
  stink(ctx, out, when, { duration = 8 } = {}) {
    SPELL_SOUNDS.whoosh(ctx, out, when, { duration });
    crackle(ctx, out, when + 0.5, { duration: duration - 2, density: 8, freq: 220, q: 8, gain: 0.25, decay: 0.12 });
    tone(ctx, out, when + 0.5, { type: 'sawtooth', freq: 190, gain: 0.015, attack: 1, hold: duration - 3, decay: 1.5, lowpass: 600 });
  },
  moonbeam(ctx, out, when, { duration = 6 } = {}) {
    noise(ctx, out, when, { filter: 'highpass', freq: 5000, freqEnd: 2000, gain: 0.4, attack: 0.002, decay: 0.6 });
    [329.6, 493.9, 659.3].forEach((freq, index) => {
      tone(ctx, out, when, { type: 'sine', freq, gain: 0.07, attack: 0.6 + index * 0.2, hold: duration - 2, decay: 1.4 });
    });
    bell(ctx, out, when, { freq: 1318.5, gain: 0.07, decay: 2.4 });
  },
  sunbeam(ctx, out, when) {
    noise(ctx, out, when, { filter: 'bandpass', freq: 1200, freqEnd: 4000, q: 1, gain: 0.45, attack: 0.03, hold: 0.6, decay: 0.6 });
    [440, 554.4, 659.3, 880].forEach((freq) => {
      tone(ctx, out, when, { type: 'sawtooth', freq, gain: 0.03, attack: 0.05, hold: 0.7, decay: 0.8, lowpass: 2500 });
    });
  },
});
