import * as THREE from 'three/webgpu';

/**
 * The light a town's ground throws back onto its walls.
 *
 * The sky's hemisphere light takes its ground colour from the look — meadow
 * green out in the country. Inside a town the ground is setts and trodden
 * earth, and green bounce turned every face out of the sun teal: stone,
 * render and timber alike, whichever renderer drew them. Toward a town's
 * centre the ground colour is drawn to warm earth instead.
 *
 * The look writes the hemisphere only when it changes, so this keeps the
 * look's own colour as its base and re-bases whenever it finds the light
 * holding a colour it did not write.
 */
export const TOWN_BOUNCE = Object.freeze(new THREE.Color('#7d6d58'));
/** How much of the town's ground replaces the look's, at the heart of a town. */
const STRENGTH = 0.85;
const luminance = (colour) => colour.r * 0.2126 + colour.g * 0.7152 + colour.b * 0.0722;
/** The daylight ground the town colour was tuned against (the highfield look's `#696b53`). */
const DAY_GROUND_LUMINANCE = luminance(new THREE.Color('#696b53'));
/** From the town's edge (in town radii) the bounce fades out over this far. */
const FADE = Object.freeze({ inner: 0.85, outer: 1.35 });

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * @param {?{ distance: number, radius: number }} town the nearest town to the viewer
 * @returns {number} 0 (country) .. STRENGTH (well inside a town)
 */
export function townBounceWeight(town) {
  if (!town || !(town.radius > 0)) return 0;
  return STRENGTH * (1 - smoothstep(FADE.inner, FADE.outer, town.distance / town.radius));
}

export class SettlementGroundBounce {
  /** @param {() => ?THREE.HemisphereLight} getLight */
  constructor(getLight) {
    this.getLight = getLight;
    this.base = new THREE.Color();
    this.written = new THREE.Color();
    this.target = new THREE.Color();
    this.light = null;
  }

  /** @param {?{ distance: number, radius: number }} town */
  update(town) {
    const light = this.getLight();
    if (!light) return;
    const ground = light.groundColor;
    if (light !== this.light || !ground.equals(this.written)) {
      this.light = light;
      this.base.copy(ground);
    }
    // The town changes the bounce's hue, not how much light there is: at the
    // look's own level, or a night street glows brown under a moon.
    const level = Math.min(1, luminance(this.base) / DAY_GROUND_LUMINANCE);
    this.target.copy(TOWN_BOUNCE).multiplyScalar(level);
    this.written.copy(this.base).lerp(this.target, townBounceWeight(town));
    ground.copy(this.written);
  }
}
