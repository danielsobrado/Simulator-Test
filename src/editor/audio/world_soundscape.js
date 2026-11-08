import { Vector3 } from 'three';
import { WATER_KIND_OCEAN } from '../water/WaterConstants.js';

import { AmbientSoundscape } from './ambient_soundscape.js';
import { WeatherSoundscape } from './weather_soundscape.js';
import { roofedShare } from './settlement_shelter.js';
import { seaBearing, soundscapeWeights } from './soundscape_weights.js';
import { ringPoints, sampleTilesAround } from '../world/sampleTilesAround.js';

/** Rings the ground around the listener is sampled on, in metres. */
const SAMPLE_RINGS = Object.freeze([0, 10, 35, 80]);
const SAMPLE_DIRECTIONS = 8;
/** Water is heard from further off than the ground under you matters. */
const WATER_RINGS = Object.freeze([0, 30, 90, 200]);
/** The surroundings change slowly; resample them a few times a second. */
const RESAMPLE_SECONDS = 0.4;
const FALL_SEARCH_METERS = 400;

/**
 * Feeds the ambient soundscape from the running world: the tiles around the
 * camera, its height above the sea, the weather, the sun and the nearest river
 * fall. Everything world-specific is passed in as a getter, so this stays free
 * of the renderer and the stores it reads.
 */
export class WorldSoundscape {
  /**
   * @param {object} options
   * @param {import('./audio_bus.js').AudioBus} options.audioBus
   * @param {(cellX: number, cellZ: number) => number} options.getTile
   * @param {() => number} options.getTileSize
   * @param {() => number} options.getSeaLevel
   * @param {() => { x: number, z: number }} options.getOrigin floating origin
   * @param {() => { rain: number, wind: number, snow?: number, lightning?: number }} options.getWeather 0..1 each
   * @param {() => { collectCandidates: Function } | null} [options.getCollisionWorld]
   *   the settlement collision, for whether the listener stands under a roof
   * @param {() => number} [options.getGust] 0..1 world wind gust at the listener
   * @param {() => boolean} options.isNight
   * @param {(x: number, z: number) => number} [options.getWaterKind] canonical metres
   * @param {() => number} [options.getSnowCountry] 0..1
   * @param {() => boolean} options.isUnderwater
   * @param {() => { near: Function } | null} options.getFallSites
   */
  constructor({
    audioBus, getTile, getTileSize, getSeaLevel, getOrigin, getWeather,
    isNight, isUnderwater, getFallSites, getWaterKind = null, getSnowCountry = () => 0,
    getCollisionWorld = () => null, getGust = () => 0,
  }) {
    this.soundscape = new AmbientSoundscape({
      bank: audioBus.samples,
      getContext: () => audioBus.synthManager.ctx,
      getDestination: () => audioBus.synthManager.master,
    });
    this.weather = new WeatherSoundscape({
      bank: audioBus.samples,
      getContext: () => audioBus.synthManager.ctx,
      getDestination: () => this.soundscape.ensureBus(),
    });
    this.getCollisionWorld = getCollisionWorld;
    this.candidates = [];
    this.getGust = getGust;
    this.roofed = 0;
    this.underwater = false;
    this.audioBus = audioBus;
    this.getTile = getTile;
    this.getTileSize = getTileSize;
    this.getSeaLevel = getSeaLevel;
    this.getOrigin = getOrigin;
    this.getWeather = getWeather;
    this.isNight = isNight;
    this.getWaterKind = getWaterKind;
    this.getSnowCountry = getSnowCountry;
    this.sea = null;
    this.isUnderwater = isUnderwater;
    this.getFallSites = getFallSites;
    this.weights = null;
    this.fall = null;
    this.sinceSample = Infinity;
    this.lastSeconds = null;
    this.forward = new Vector3(0, 0, -1);
  }

  sampleTiles(x, z) {
    return sampleTilesAround({
      getTile: this.getTile,
      tileSize: this.getTileSize(),
      x,
      z,
      rings: SAMPLE_RINGS,
      directions: SAMPLE_DIRECTIONS,
    });
  }

  resample(x, y, z, yaw) {
    const weather = this.getWeather();
    const waterPoints = this.getWaterKind
      ? ringPoints({ x, z, rings: WATER_RINGS, directions: SAMPLE_DIRECTIONS })
      : [];
    const water = waterPoints.map((point) => this.getWaterKind(point.x, point.z));
    this.seaPoints = waterPoints.filter((point, index) => water[index] === WATER_KIND_OCEAN && (point.dx || point.dz))
      .map(point => ({ x: point.x, z: point.z, y: this.getSeaLevel() }));
    this.sea = seaBearing(waterPoints, water);
    this.weights = soundscapeWeights({
      tiles: this.sampleTiles(x, z),
      water,
      snowCountry: this.getSnowCountry(),
      heightAboveSea: y - this.getSeaLevel(),
      rain: weather.rain,
      wind: weather.wind,
      snow: weather.snow ?? 0,
      night: Boolean(this.isNight()),
      underwater: this.underwater = this.isUnderwater(),
    });
    // Shelter only matters while something falls or blows.
    const collision = weather.rain > 0 || weather.snow > 0 || weather.wind > 0.5 ? this.getCollisionWorld() : null;
    this.roofed = collision ? roofedShare(collision, { x, y, z, yaw }, this.candidates) : 0;
    this.fall = this.getFallSites()?.near(x, z, FALL_SEARCH_METERS, 1)[0] ?? null;
  }

  /**
   * @param {number} seconds frame time
   * @param {import('three').Camera} camera the listener
   */
  update(seconds, camera) {
    const dt = this.lastSeconds === null ? 0 : seconds - this.lastSeconds;
    this.lastSeconds = seconds;
    const origin = this.getOrigin();
    const x = camera.position.x + origin.x;
    const z = camera.position.z + origin.z;
    camera.getWorldDirection(this.forward);
    const yaw = Math.atan2(-this.forward.x, -this.forward.z);
    this.sinceSample += dt;
    if (this.sinceSample >= RESAMPLE_SECONDS || !this.weights) {
      this.sinceSample = 0;
      this.resample(x, camera.position.y, z, yaw);
    }
    const listener = { x, y: camera.position.y, z, yaw };
    const enabled = this.audioBus.synthManager.isEnabled();
    this.soundscape.update(dt, {
      weights: this.weights,
      listener,
      fall: this.fall,
      sea: this.sea,
      seaPoints: this.seaPoints,
      enabled,
    });
    const storm = this.getWeather();
    this.weather.update(dt, {
      weights: this.weights,
      storm,
      roofed: this.roofed,
      gust: storm.wind > 0.35 ? this.getGust() : 0,
      listener,
      enabled,
      underwater: this.underwater,
    });
  }

  /** Thunder for a LightningScheduler strike: `{ bearing, distance }`. */
  strike(event) {
    this.weather.strike(event);
  }

  dispose() {
    this.weather.dispose();
    this.soundscape.dispose();
  }
}
