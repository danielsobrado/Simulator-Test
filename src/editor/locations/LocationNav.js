/**
 * Where the player can stand inside a location.
 *
 * Walkable ground is a union of simple areas the generator declares as it lays
 * the place out — passages, floors, stairs, bridges — each with its own height.
 * Movement is accepted only if it ends on one, so walls need no collision
 * response and a bridge has edges without a railing collider. Several areas may
 * overlap in plan at different heights; the one at the walker's feet wins.
 */

const STEP_UP = 0.6;
const MAX_DROP = 1.3;
const UP = Object.freeze({ x: 0, y: 1, z: 0 });
const NO_CONTACTS = Object.freeze([]);

export class LocationNav {
  constructor() {
    this.areas = [];
    this.blockers = [];
    this.lastGround = 0;
  }

  /** A strip from `a` to `b` (floor points), `width` metres wide, sloping between them. */
  addSegment(a, b, width) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / length, uz = dz / length, half = width / 2;
    this.areas.push((x, z) => {
      const along = (x - a.x) * ux + (z - a.z) * uz;
      const clamped = Math.min(length, Math.max(0, along));
      if (Math.hypot((z - a.z) * ux - (x - a.x) * uz, along - clamped) > half) return NaN;
      return a.y + (b.y - a.y) * (clamped / length);
    });
  }

  /** A flat disc at `center.y`. */
  addDisc(center, radius) {
    this.areas.push((x, z) => (Math.hypot(x - center.x, z - center.z) <= radius ? center.y : NaN));
  }

  /** A flat rectangle at `center.y`, turned `yaw` about Y. */
  addRect(center, halfLength, halfWidth, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.areas.push((x, z) => {
      const dx = x - center.x, dz = z - center.z;
      return Math.abs(dx * c + dz * s) <= halfLength && Math.abs(dz * c - dx * s) <= halfWidth ? center.y : NaN;
    });
  }

  /**
   * Open ground that follows a height function: `heightAt(x, z)` wherever `contains(x, z)`.
   * For terrain under the sky, where no plane describes the floor.
   */
  addSurface(heightAt, contains) {
    this.areas.push((x, z) => (contains(x, z) ? heightAt(x, z) : NaN));
  }

  /** A standing obstacle: a disc the walker cannot enter while within its height band. */
  block(center, radius, height = 3) {
    this.blockers.push({ x: center.x, z: center.z, radius, bottom: center.y - 0.5, top: center.y + height });
  }

  /** The walkable surface under a point for feet at `footY`, or null off the walkable ground. */
  surfaceAt(x, z, footY) {
    let best = null;
    for (const area of this.areas) {
      const y = area(x, z);
      if (y === y && y <= footY + STEP_UP && (best === null || y > best)) best = y;
    }
    return best;
  }

  /** Ground height for the physics step; off the walkable ground it holds the last height. */
  heightAt(x, z, footY) {
    const surface = this.surfaceAt(x, z, Number.isFinite(footY) ? footY : Infinity);
    if (surface !== null) this.lastGround = surface;
    return this.lastGround;
  }

  #open(x, z, footY) {
    const surface = this.surfaceAt(x, z, footY);
    if (surface === null || footY - surface > MAX_DROP) return null;
    for (const blocker of this.blockers) {
      if (footY > blocker.bottom && footY < blocker.top
        && Math.hypot(x - blocker.x, z - blocker.z) < blocker.radius) return null;
    }
    return surface;
  }

  /** Horizontal move for `stepPlayerPhysics`: the whole step, else a slide along one axis, else none. */
  resolve({ start, displacement }) {
    const candidates = [
      [start.x + displacement.x, start.z + displacement.z],
      [start.x + displacement.x, start.z],
      [start.x, start.z + displacement.z],
    ];
    let x = start.x, z = start.z, support = null, blocked = true;
    for (let index = 0; index < candidates.length; index += 1) {
      const surface = this.#open(candidates[index][0], candidates[index][1], start.y);
      if (surface === null) continue;
      [x, z] = candidates[index];
      support = surface;
      blocked = index > 0;
      break;
    }
    if (support === null) support = this.heightAt(x, z, start.y);
    return {
      position: { x, y: start.y, z },
      ready: true,
      blocked,
      stepped: false,
      slopeConstrained: false,
      supportSourceId: 'location',
      supportHeight: support,
      supportNormal: UP,
      contacts: NO_CONTACTS,
      previousValidPosition: { x, y: support, z },
    };
  }
}
