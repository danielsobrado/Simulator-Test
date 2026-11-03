import { formatDistance } from '../../map/minimapBurgMarkers.js';
import { COMPASS_POINTS, relativeBearing } from './hudBearing.js';
import { HUD_PHASE } from './hudState.js';

/** Degrees either side of straight ahead that the ribbon shows. */
const FIELD_DEGREES = 90;
/** A place this close to straight ahead is named above the ribbon. */
const FOCUS_DEGREES = 12;
const HEADING_EPSILON = 0.002;
const PLACE_REFRESH_MS = 500;

function createMark(className, label = '') {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = label;
  return element;
}

/**
 * The compass ribbon across the top of the walking HUD: the cardinal points and
 * the nearest settlements, slid along by the camera yaw. Places come from the
 * minimap source and are re-read a couple of times a second; worlds without
 * Azgaar burgs show the points alone.
 */
export class HudCompass {
  /**
   * @param {object} [source]
   * @param {() => { x: number, z: number } | null} [source.getFocusPoint] fractional cell
   * @param {(point: { x: number, z: number }) => Array<{
   *   id: number, name: string, capital: boolean, color: string,
   *   worldDx: number, worldDz: number, metres: number,
   * }>} [source.getPlaces]
   */
  constructor({ getFocusPoint = () => null, getPlaces = () => [] } = {}) {
    this.getFocusPoint = getFocusPoint;
    this.getPlaces = getPlaces;
    this.heading = Number.NaN;
    this.nextPlacesAt = 0;
    this.placesSignature = '';
    this.placeMarks = [];
    this.focusText = '';

    this.element = document.createElement('div');
    this.element.className = 'hud-compass';
    this.element.hidden = true;
    this.element.setAttribute('aria-hidden', 'true');
    this.focus = createMark('hud-compass__focus');
    this.track = createMark('hud-compass__track');
    this.element.append(this.focus, this.track, createMark('hud-compass__pointer'));
    this.pointMarks = COMPASS_POINTS.map((point) => {
      const element = createMark(`hud-compass__point${point.label ? '' : ' is-tick'}`, point.label);
      if (point.label.length === 1) element.classList.add('is-cardinal');
      return { ...point, element };
    });
    this.track.append(...this.pointMarks.map(({ element }) => element));
  }

  render(phase) {
    this.element.hidden = phase !== HUD_PHASE.walking;
    if (this.element.hidden) this.heading = Number.NaN;
  }

  update(heading, nowMs) {
    if (!Number.isFinite(heading)) return;
    const placesChanged = nowMs >= this.nextPlacesAt && this.refreshPlaces(nowMs);
    if (!placesChanged && Math.abs(heading - this.heading) < HEADING_EPSILON) return;
    this.heading = heading;
    for (const mark of this.pointMarks) placeMark(mark, heading);

    let focused = null;
    let focusedBearing = FOCUS_DEGREES;
    for (const mark of this.placeMarks) {
      const bearing = Math.abs(placeMark(mark, heading));
      if (bearing < focusedBearing) {
        focused = mark;
        focusedBearing = bearing;
      }
    }
    // Burg names come from the imported map, so they are set as text.
    const text = focused ? `${focused.name} · ${formatDistance(focused.metres)}` : '';
    if (text === this.focusText) return;
    this.focusText = text;
    this.focus.textContent = text;
  }

  /** Returns whether anything changed, so a stationary camera still redraws it. */
  refreshPlaces(nowMs) {
    this.nextPlacesAt = nowMs + PLACE_REFRESH_MS;
    const point = this.getFocusPoint();
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
    const places = this.getPlaces(point);
    const signature = places.map(({ id }) => id).join();
    if (signature !== this.placesSignature) {
      this.placesSignature = signature;
      for (const { element } of this.placeMarks) element.remove();
      this.placeMarks = places.map((place) => {
        const element = createMark('hud-compass__place');
        element.classList.toggle('is-capital', place.capital);
        element.style.setProperty('--place-color', place.color);
        this.track.append(element);
        return { ...place, element };
      });
      return true;
    }
    this.placeMarks.forEach((mark, index) => Object.assign(mark, places[index]));
    return places.length > 0;
  }

  dispose() {
    this.element.remove();
  }
}

function placeMark(mark, heading) {
  const bearing = relativeBearing(mark.worldDx, mark.worldDz, heading);
  const visible = Math.abs(bearing) <= FIELD_DEGREES;
  // Inherit when shown: an explicit 'visible' outlived the HUD's capture-hide.
  mark.element.style.visibility = visible ? '' : 'hidden';
  if (visible) mark.element.style.setProperty('--mark-at', (bearing / FIELD_DEGREES).toFixed(4));
  return bearing;
}
